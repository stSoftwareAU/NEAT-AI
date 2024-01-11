import { blue } from "https://deno.land/std@0.211.0/fmt/colors.ts";
import { Costs } from "../Costs.ts";
import { TrainOptions } from "../config/TrainOptions.ts";
import { BackPropagationConfig } from "./BackPropagation.ts";
import { Network } from "./Network.ts";
import { NetworkUtil } from "./NetworkUtils.ts";
import { yellow } from "https://deno.land/std@0.211.0/fmt/colors.ts";
import { format } from "https://deno.land/std@0.211.0/fmt/duration.ts";
import { addTag } from "../tags/TagsInterface.ts";
import { DataRecordInterface, makeDataDir } from "./DataSet.ts";
import { ensureDirSync } from "https://deno.land/std@0.211.0/fs/ensure_dir.ts";

export const cacheDataFile = {
  fn: "",
  json: {},
};

export function dataFiles(dataDir: string) {
  const files: string[] = [];

  if (cacheDataFile.fn.startsWith(dataDir)) {
    files.push(
      cacheDataFile.fn.substring(cacheDataFile.fn.lastIndexOf("/") + 1),
    );
  } else {
    cacheDataFile.fn = "NOT-CACHED";
    for (const dirEntry of Deno.readDirSync(dataDir)) {
      if (dirEntry.isFile && dirEntry.name.endsWith(".json")) {
        files.push(dirEntry.name);
      }
    }

    files.sort();
  }

  return files;
}

/**
 * Train the given set to this network
 */
export async function trainDir(
  network: Network,
  dataDir: string,
  options: TrainOptions,
) {
  // Read the options
  const targetError =
    options.targetError !== undefined && Number.isFinite(options.targetError)
      ? options.targetError
      : 0.05;
  const cost = Costs.find(options.cost ? options.cost : "MSE");

  const iterations = Math.max(options.iterations ? options.iterations : 2, 1);

  const trainingSampleRate = Math.min(
    1,
    Math.max(0, options.trainingSampleRate ?? Math.max(Math.random(), 0.3)),
  );

  const indxMap = new Map<string, number[]>();
  const files: string[] = dataFiles(dataDir).map((fn) => dataDir + "/" + fn);
  const cached = files.length == 1;
  if (!cached) {
    cacheDataFile.fn = "";
    cacheDataFile.json = {};
  }

  // Randomize the list of files
  if (!options.disableRandomSamples) {
    for (let i = files.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [files[i], files[j]] = [files[j], files[i]];
    }
  }

  // Loops the training process
  let iteration = 0;

  const uuid = await NetworkUtil.makeUUID(network);

  const ID = uuid.substring(Math.max(0, uuid.length - 8));
  let bestError: number | undefined = undefined;
  let trainingFailures = 0;
  let bestCreatureJSON = network.exportJSON();
  let bestTraceJSON = network.traceJSON();
  let lastTraceJSON = bestTraceJSON;
  let knownSampleCount = -1;
  // @TODO need to apply Stochastic Gradient Descent
  const EMPTY = { input: [], output: [] };
  while (true) {
    iteration++;
    const startTS = Date.now();
    let lastTS = startTS;
    const config = new BackPropagationConfig(options);
    if (options.generations !== undefined) {
      config.generations = options.generations + iteration;
    }

    let counter = 0;
    let errorSum = 0;

    let trainingStopped = false;
    for (let j = files.length; !trainingStopped && j--;) {
      const fn = files[j];
      const json = cacheDataFile.fn == fn
        ? cacheDataFile.json
        : JSON.parse(Deno.readTextFileSync(fn));

      if (cached) {
        cacheDataFile.fn = fn;
        cacheDataFile.json = json;
      }

      if (json.length == 0) {
        throw new Error("Set size must be positive");
      }
      const len = Math.min(
        json.length,
        Math.max(1000, Math.floor(json.length * trainingSampleRate)),
      );

      let tmpIndices = indxMap.get(fn);

      if (!tmpIndices) {
        tmpIndices = Array.from({ length: len }, (_, i) => i); // Create an array of indices

        if (!options.disableRandomSamples) {
          // Fisher-Yates shuffle algorithm
          for (let i = tmpIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tmpIndices[i], tmpIndices[j]] = [tmpIndices[j], tmpIndices[i]];
          }
        }

        if (len != json.length) {
          tmpIndices.length = len; /* No need to cache what we wont use */
          indxMap.set(fn, tmpIndices);
        }
      }

      const indices = tmpIndices;

      // Iterate over the shuffled indices
      for (let i = len; i--;) {
        const indx = indices[i];
        const data = json[indx];

        if (!cached) {
          /* Not cached so we can release memory as we go */
          json[indx] = EMPTY;
        }

        const output = network.activate(data.input);

        const sampleError = cost.calculate(data.output, output);
        errorSum += sampleError;
        counter++;
        if (Number.isFinite(errorSum) == false) {
          console.warn(
            `Training ${
              blue(ID)
            } stopped as errorSum is not finite: ${errorSum} sampleError: ${sampleError} counter: ${counter} data.output: ${data.output} output: ${output}`,
          );
          trainingStopped = true;
          break;
        } else if (bestError !== undefined && counter < knownSampleCount) {
          const bestPossibleError = errorSum / knownSampleCount;
          if (bestPossibleError > bestError) {
            console.warn(
              `Training ${blue(ID)} stopped as 'best possible' error ${
                yellow(bestPossibleError.toFixed(3))
              } > 'best' error ${yellow(bestError.toFixed(3))} at counter ${
                yellow(counter.toFixed(0))
              } of ${yellow(knownSampleCount.toFixed(0))}`,
            );
            trainingStopped = true;
            break;
          }
        }
        network.propagate(data.output, config);

        const now = Date.now();
        const diff = now - lastTS;

        if (diff > 60_000) {
          lastTS = now;
          const totalTime = now - startTS;
          console.log(
            `Training ${blue(ID)} samples`,
            counter,
            `${
              knownSampleCount > 0
                ? "of " + yellow(knownSampleCount.toLocaleString()) + " "
                : ""
            }${
              trainingSampleRate < 1
                ? "( rate " +
                  yellow((trainingSampleRate * 100).toFixed(1) + "% )")
                : ""
            }`,
            "error",
            yellow((errorSum / counter).toFixed(3)),
            "time average:",
            yellow(
              format(totalTime / counter, { ignoreZero: true }),
            ),
            "total:",
            yellow(
              format(totalTime, { ignoreZero: true }),
            ),
          );
        }
      }
    }

    const error = errorSum / counter;

    if (bestError !== undefined && bestError < error) {
      trainingFailures++;
      if (trainingStopped == false) {
        console.warn(
          `Training ${blue(ID)} made the error ${
            yellow(bestError.toFixed(3))
          } worse ${yellow(error.toFixed(3))} failed ${
            yellow(trainingFailures.toString())
          } out of ${yellow(iteration.toString())} iterations`,
        );
      }
      if (options.traceStore) {
        ensureDirSync(options.traceStore);
        Deno.writeTextFileSync(
          `.trace/${trainingFailures}_fail.json`,
          JSON.stringify(network.exportJSON(), null, 2),
        );
      }
      network.loadFrom(bestCreatureJSON, false);
      lastTraceJSON = bestTraceJSON;
    } else {
      if (bestError === undefined) {
        addTag(network, "untrained-error", error.toString());
      }
      if (bestError !== undefined && bestError > error) {
        bestTraceJSON = lastTraceJSON;
      }

      lastTraceJSON = network.traceJSON();
      bestCreatureJSON = network.exportJSON();
      bestError = error;
      knownSampleCount = counter;

      network.applyLearnings(config);
      network.clearState();
    }

    if (bestError <= targetError || iteration >= iterations) {
      network.loadFrom(bestCreatureJSON, false);
      return {
        ID: ID,
        iteration: iteration,
        error: bestError,
        trace: bestTraceJSON,
      };
    }
  }
}

/**
 * Train the given set to this network
 */
export async function train(
  network: Network,
  dataSet: DataRecordInterface[],
  options: TrainOptions,
) {
  if (
    dataSet[0].input.length !== network.input ||
    dataSet[0].output.length !== network.output
  ) {
    throw new Error(
      "Dataset input/output size should be same as network input/output size!",
    );
  }

  const dataSetDir = makeDataDir(dataSet);

  const result = await trainDir(network, dataSetDir, options);

  await Deno.remove(dataSetDir, { recursive: true });

  return result;
}
