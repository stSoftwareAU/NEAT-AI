import { blue, yellow } from "https://deno.land/std@0.221.0/fmt/colors.ts";
import { format } from "https://deno.land/std@0.221.0/fmt/duration.ts";
import { ensureDirSync } from "https://deno.land/std@0.221.0/fs/ensure_dir.ts";
import { Costs } from "../Costs.ts";
import { Creature } from "../Creature.ts";
import { TrainOptions } from "../config/TrainOptions.ts";
import { BackPropagationConfig } from "./BackPropagation.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import { DataRecordInterface, makeDataDir } from "./DataSet.ts";
import { compactUnused } from "../compact/CompactUnused.ts";

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
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
) {
  // Read the options
  const targetError =
    options.targetError !== undefined && Number.isFinite(options.targetError)
      ? Math.max(options.targetError, 0.000_001)
      : 0.05;
  const cost = Costs.find(options.cost ? options.cost : "MSE");

  const iterations = Math.max(options.iterations ? options.iterations : 2, 1);

  const trainingSampleRate = Math.min(
    1,
    Math.max(0, options.trainingSampleRate ?? Math.max(Math.random(), 0.3)),
  );

  const indxMap = new Map<string, Int32Array>();
  const files: string[] = dataFiles(dataDir).map((fn) => dataDir + "/" + fn);
  const cached = files.length == 1;
  if (!cached) {
    cacheDataFile.fn = "";
    cacheDataFile.json = {};
  }

  // Randomize the list of files
  if (!options.disableRandomSamples) {
    for (let i = files.length; i--;) {
      const j = Math.round(Math.random() * i);
      [files[i], files[j]] = [files[j], files[i]];
    }
  }

  // Loops the training process
  let iteration = 0;

  let timedOut = false;
  let timeoutTS = 0;
  if (options.trainingTimeOutMinutes ?? 0 > 0) {
    timeoutTS = Date.now() + (options.trainingTimeOutMinutes ?? 0) * 60 * 1000;
  }
  const uuid = await CreatureUtil.makeUUID(creature);

  const ID = uuid.substring(Math.max(0, uuid.length - 8));
  let bestError: number | undefined = undefined;
  let trainingFailures = 0;
  let bestCreatureJSON = creature.exportJSON();
  let bestTraceJSON = creature.traceJSON();
  let lastTraceJSON = bestTraceJSON;
  let knownSampleCount = -1;

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

      let indices = indxMap.get(fn);

      if (!indices) {
        const tmpIndexes = Int32Array.from(
          { length: json.length },
          (_, i) => i,
        ); // Create an array of indices

        if (!options.disableRandomSamples) {
          CreatureUtil.shuffle(tmpIndexes);
        }
        indices = tmpIndexes.slice(0, len);

        if (len != json.length) {
          /* No need to cache what we wont use */
          indxMap.set(fn, indices);
        }
      }

      // Iterate over the shuffled indices
      for (let i = len; i--;) {
        const indx = indices[i];
        const data = json[indx];

        const output = creature.activateAndTrace(data.input);

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
        creature.propagate(data.output, config);

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

          if (timeoutTS && now > timeoutTS) {
            timedOut = true;
            console.log(
              `Training ${blue(ID)} timed out after ${
                yellow(format(totalTime, { ignoreZero: true }))
              }`,
            );
            trainingStopped = true;
            break;
          }
        }
      }
    }

    const error = errorSum / counter;

    if (bestError !== undefined && bestError < error) {
      trainingFailures++;
      if (trainingStopped == false) {
        console.warn(
          `Training ${blue(ID)} made the error: ${
            yellow(bestError.toFixed(3))
          }, worse: ${yellow(error.toFixed(3))}, target: ${
            yellow(targetError.toString())
          }, failed: ${yellow(trainingFailures.toString())} out of ${
            yellow(iteration.toString())
          } iterations`,
        );
      }
      if (options.traceStore) {
        ensureDirSync(options.traceStore);
        Deno.writeTextFileSync(
          `.trace/${trainingFailures}_fail.json`,
          JSON.stringify(creature.exportJSON(), null, 2),
        );
      }
      creature.loadFrom(bestCreatureJSON, false);
      lastTraceJSON = bestTraceJSON;
    } else {
      if (bestError !== undefined && bestError > error) {
        bestTraceJSON = lastTraceJSON;
      }

      lastTraceJSON = creature.traceJSON();
      bestCreatureJSON = creature.exportJSON();
      bestError = error;
      knownSampleCount = counter;

      await creature.applyLearnings(config);
      creature.clearState();
    }

    if (timedOut || bestError <= targetError || iteration >= iterations) {
      if (iterations > 1) {
        creature.loadFrom(bestCreatureJSON, false); // If not called via the worker.
      }

      let compact = await compactUnused(lastTraceJSON, config.plankConstant);
      if (!compact) {
        compact = Creature.fromJSON(lastTraceJSON).compact();
      }

      return {
        ID: ID,
        iteration: iteration,
        error: bestError,
        trace: bestTraceJSON,
        compact: compact ? compact.exportJSON() : undefined,
      };
    }
  }
}

/**
 * Train the given set to this network
 */
export async function train(
  network: Creature,
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
