import { blue, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import { ensureDirSync } from "@std/fs";
import { Costs } from "../Costs.ts";
import { Creature } from "../Creature.ts";
import { compactUnused } from "../compact/CompactUnused.ts";
import type { TrainOptions } from "../config/TrainOptions.ts";
import { createBackPropagationConfig } from "../propagate/BackPropagation.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import { type DataRecordInterface, makeDataDir } from "./DataSet.ts";
import { assert } from "@std/assert/assert";

export function dataFiles(dataDir: string, options: TrainOptions = {}) {
  const binaryFiles: string[] = [];

  for (const dirEntry of Deno.readDirSync(dataDir)) {
    if (dirEntry.isFile) {
      const fn = dirEntry.name;
      if (fn.endsWith(".bin")) {
        binaryFiles.push(`${dataDir}/${fn}`);
      }
    }
  }

  const files = binaryFiles;

  if (!options.disableRandomSamples) {
    for (let i = files.length; i--;) {
      const j = Math.round(Math.random() * i);
      [files[i], files[j]] = [files[j], files[i]];
    }
  } else {
    files.sort();
  }

  return {
    files: binaryFiles,
  };
}

/**
 * Train the given set to this network
 */
export function trainDir(
  creature: Creature,
  dataDir: string,
  options: TrainOptions,
) {
  const dataResult = dataFiles(dataDir, options);

  assert(
    dataResult.files.length > 0,
    "No binary files found in the data directory",
  );

  return trainDirBinary(creature, dataResult.files, options);
}

function trainDirBinary(
  creature: Creature,
  binaryFiles: string[],
  options: TrainOptions,
) {
  const cost = Costs.find(options.cost ?? "MSE");

  const targetError =
    options.targetError !== undefined && Number.isFinite(options.targetError)
      ? Math.max(options.targetError, 0.000_001)
      : 0.05;

  const iterations = Math.max(options.iterations ? options.iterations : 2, 1);

  const trainingSampleRate = Math.min(
    1,
    Math.max(0.0001, options.trainingSampleRate ?? 1),
  );
  const uuid = CreatureUtil.makeUUID(creature);

  const ID = uuid.substring(Math.max(0, uuid.length - 8));
  console.info(
    `Training ${blue(ID)} with ${binaryFiles.length} binary file${
      binaryFiles.length > 1 ? "s" : ""
    }, target error: ${yellow(targetError.toString())}, iterations: ${
      yellow(iterations.toString())
    }, training sample rate: ${yellow(trainingSampleRate.toString())}`,
  );
  const valuesCount = creature.input + creature.output;
  const BYTES_PER_RECORD = valuesCount * 4; // Each float is 4 bytes

  const array = new Float32Array(valuesCount);
  const uint8Array = new Uint8Array(array.buffer);

  function readNextRecord(file: Deno.FsFile) {
    const bytesRead = file.readSync(uint8Array);
    if (bytesRead === null || bytesRead === 0) {
      return null;
    }
    assert(bytesRead === BYTES_PER_RECORD);

    const observations: number[] = Array.from(array.slice(0, creature.input));
    const outputs: number[] = Array.from(array.slice(creature.input));

    return {
      observations: observations,
      outputs: outputs,
    };
  }

  const indxMap = new Map<string, Set<number>>();

  // Loops the training process
  let iteration = 0;

  let timedOut = false;
  let timeoutTS = 0;
  const trainingTimeOutMinutes = options.trainingTimeOutMinutes ?? 0;
  if (trainingTimeOutMinutes > 0) {
    timeoutTS = Date.now() + trainingTimeOutMinutes * 60 * 1000;
  }

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
    const generations = options.generations !== undefined
      ? options.generations + iteration
      : undefined;
    const iterationConfig = createBackPropagationConfig({
      ...options,
      generations: generations,
    });

    let counter = 0;
    let errorSum = 0;

    let trainingStopped = false;
    for (let j = binaryFiles.length; !trainingStopped && j--;) {
      const fn = binaryFiles[j];

      const file = Deno.openSync(fn, { read: true });

      try {
        let recordSet = indxMap.get(fn);

        if (!recordSet) {
          const stat = file.statSync();
          const records = stat.size / BYTES_PER_RECORD;

          const len = Math.floor(records * trainingSampleRate);
          const tmpIndexes = Int32Array.from(
            { length: records },
            (_, i) => i,
          ); // Create an array of indices

          if (!options.disableRandomSamples) {
            CreatureUtil.shuffle(tmpIndexes);
          }
          const indices = tmpIndexes.slice(0, len);

          recordSet = new Set(indices);
          indxMap.set(fn, recordSet);
        }

        for (let indx = 0; true; indx++) {
          const record = readNextRecord(file);
          if (record === null) break;

          if (!recordSet.has(indx)) {
            continue;
          }

          const output = creature.activateAndTrace(record.observations);

          const sampleError = cost.calculate(record.outputs, output);
          errorSum += sampleError;
          counter++;
          if (Number.isFinite(errorSum) == false) {
            console.warn(
              `Training ${
                blue(ID)
              } stopped as errorSum is not finite: ${errorSum} sampleError: ${sampleError} counter: ${counter} record.output: ${record.outputs} output: ${output}`,
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
          creature.propagate(record.outputs, iterationConfig);

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
      } finally {
        file.close();
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
        const failedDir = `${options.traceStore}/failed`;
        ensureDirSync(failedDir);
        CreatureUtil.makeUUID(creature);
        Deno.writeTextFileSync(
          `${failedDir}/${creature.uuid}.json`,
          JSON.stringify(creature.traceJSON(), null, 2),
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

      creature.applyLearnings(iterationConfig);
      creature.clearState();
    }

    if (timedOut || bestError <= targetError || iteration >= iterations) {
      if (iterations > 1) {
        creature.loadFrom(bestCreatureJSON, false); // If not called via the worker.
      }

      let compact = compactUnused(lastTraceJSON, iterationConfig.plankConstant);
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
export function train(
  creature: Creature,
  dataSet: DataRecordInterface[],
  options: TrainOptions,
) {
  assert(dataSet.length > 0, "No data set provided");
  assert(dataSet[0].input.length > 0, "No input data in the data set");
  assert(dataSet[0].output.length > 0, "No output data in the data set");

  const dataSetDir = makeDataDir(dataSet);
  try {
    const result = trainDir(creature, dataSetDir, options);
    return result;
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
}
