import { assert } from "@std/assert/assert";
import { blue, cyan, magenta, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import { ensureDirSync } from "@std/fs";
import { Costs } from "../Costs.ts";
import { Creature } from "../Creature.ts";
import { compactUnused } from "../compact/CompactUnused.ts";
import type { TrainOptions } from "../config/TrainOptions.ts";
import { createBackPropagationConfig } from "../propagate/BackPropagation.ts";
import { SparseConfig } from "../propagate/sparse/SparseConfig.ts";
import type { CreatureExport, CreatureTrace } from "./CreatureInterfaces.ts";
import { CreatureUtil } from "./CreatureUtils.ts";

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

function fp(percentage: number) {
  if (Math.abs(1 - percentage) < Number.EPSILON) {
    return yellow("100%");
  }

  return yellow((percentage * 100).toFixed(1) + "%");
}
interface TrainingResult {
  ID: string;
  iteration: number;
  error: number;
  trace: CreatureTrace;
  compact: CreatureExport | undefined;
}

function trainDirBinary(
  creature: Creature,
  binaryFiles: string[],
  options: TrainOptions,
): TrainingResult {
  const backPropConfig = createBackPropagationConfig(options);

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
  if (options.log) {
    console.info(
      `Training ${blue(ID)} with ${binaryFiles.length} binary file${
        binaryFiles.length > 1 ? "s" : ""
      }, target error: ${yellow(targetError.toString())}, iterations: ${
        yellow(iterations.toString())
      }, sample rate: ${fp(trainingSampleRate)}, sparse: ${
        fp(backPropConfig.sparseRatio)
      }, propagation: ${
        backPropConfig.useDerivativePropagation
          ? cyan("clear")
          : magenta("foggy")
      } glasses`,
    );
  }
  const valuesCount = creature.input + creature.output;
  const BYTES_PER_RECORD = valuesCount * 4; // Each float is 4 bytes
  const SSD_OPTIMAL_READ_SIZE = 128 * 1024; // 128 KB
  const BATCH_SIZE = Math.max(
    1,
    Math.floor(SSD_OPTIMAL_READ_SIZE / BYTES_PER_RECORD),
  );
  const BYTES_PER_BATCH = BYTES_PER_RECORD * BATCH_SIZE;

  // Shared buffers for batch processing
  const batchBuffer = new Uint8Array(BYTES_PER_BATCH);
  const batchArray = new Float32Array(batchBuffer.buffer);

  const indxMap = new Map<string, Set<number>>();

  // Training loop
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

  const sparseConfig = new SparseConfig(bestCreatureJSON, backPropConfig);

  while (true) {
    iteration++;
    const startTS = Date.now();
    let lastTS = startTS;

    const iterationConfig = createBackPropagationConfig({
      ...backPropConfig,
      generations: backPropConfig.generations + iteration,
    });

    let counter = 0;
    let totalRecords = 0;
    let errorSum = 0;

    let trainingStopped = false;
    for (let fileIndx = binaryFiles.length; !trainingStopped && fileIndx--;) {
      const fn = binaryFiles[fileIndx];

      const file = Deno.openSync(fn, { read: true });

      try {
        let recordSet = indxMap.get(fn);
        const stat = file.statSync();
        const fileRecords = stat.size / BYTES_PER_RECORD;

        if (!recordSet) {
          totalRecords += fileRecords;
          if (fileIndx === 0) {
            knownSampleCount = totalRecords;
          }
          const len = Math.ceil(fileRecords * trainingSampleRate);
          const tmpIndexes = Int32Array.from(
            { length: fileRecords },
            (_, i) => i,
          ); // Create an array of indices

          if (!options.disableRandomSamples && !options.feedbackLoop) {
            CreatureUtil.shuffle(tmpIndexes);
          }
          const indices = tmpIndexes.slice(0, len);

          recordSet = new Set(indices);
          indxMap.set(fn, recordSet);
        }

        let batchStart = 0;
        while (true) {
          const remainingRecords = fileRecords - batchStart;
          if (remainingRecords <= 0) break;

          const batchSize = Math.min(BATCH_SIZE, remainingRecords);
          const bytesRead = file.readSync(
            batchBuffer.subarray(0, batchSize * BYTES_PER_RECORD),
          );
          if (bytesRead === null) break;
          assert(bytesRead > 0, "Invalid number of bytes read");

          const recordsRead = Math.floor(bytesRead / BYTES_PER_RECORD);
          for (let j = 0; j < recordsRead; j++) {
            const recordIndex = batchStart + j;
            if (!recordSet.has(recordIndex)) continue;

            const offset = j * valuesCount;
            const observations = batchArray.subarray(
              offset,
              offset + creature.input,
            );

            const output = creature.activateAndTrace(
              observations,
              options.feedbackLoop ?? false,
              sparseConfig,
            );

            const targets = batchArray.subarray(
              offset + creature.input,
              offset + valuesCount,
            );

            const sampleError = cost.calculate(
              targets,
              new Float32Array(output),
            );
            assert(Number.isFinite(sampleError), "Sample error is not finite");
            errorSum += sampleError;
            counter++;
            if (Number.isFinite(errorSum) === false) {
              console.warn(
                `Training ${
                  blue(ID)
                } stopped as errorSum is not finite: ${errorSum} sampleError: ${sampleError} counter: ${counter} record.output: ${targets} output: ${output}`,
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
            creature.propagate(targets, iterationConfig, sparseConfig);

            const now = Date.now();
            const diff = now - lastTS;

            if (diff > 60_000) {
              lastTS = now;
              const totalTime = now - startTS;
              console.log(
                `Training ${blue(ID)} samples`,
                yellow(counter.toLocaleString("en-AU")),
                `${
                  knownSampleCount > 0
                    ? "of " + yellow(knownSampleCount.toLocaleString("en-AU")) +
                      " " +
                      yellow(
                        (counter / knownSampleCount * 100).toFixed(1) + "%",
                      )
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
          if (trainingStopped) break;
          batchStart += batchSize;
        }
      } finally {
        file.close();
      }
    }

    const error = errorSum / counter;

    if (counter === 0) {
      throw new Error(
        `Training ${blue(ID)} stopped as no samples were processed`,
      );
    }

    if (bestError !== undefined && bestError < error) {
      trainingFailures++;
      if (trainingStopped === false) {
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
      lastTraceJSON = creature.traceJSON();
      if (bestError === undefined || bestError > error) {
        bestTraceJSON = lastTraceJSON;
      }
      bestCreatureJSON = creature.exportJSON();
      bestError = error;

      creature.applyLearnings(iterationConfig, sparseConfig);
      creature.clearState();
    }

    if (timedOut || bestError <= targetError || iteration >= iterations) {
      if (iterations > 1) {
        creature.loadFrom(bestCreatureJSON, false); // If not called via the worker.
      }
      bestTraceJSON.neurons.forEach((n) => {
        if (!sparseConfig.traceNeeded(n.uuid)) {
          delete (n as { trace?: unknown }).trace;
        }
      });
      bestTraceJSON.synapses.forEach((s) => {
        if (!sparseConfig.traceNeeded(s.toUUID)) {
          delete (s as { trace?: unknown }).trace;
        }
      });

      let compact = compactUnused(bestTraceJSON, iterationConfig.plankConstant);
      if (!compact) {
        compact = Creature.fromJSON(bestTraceJSON).compact();
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
