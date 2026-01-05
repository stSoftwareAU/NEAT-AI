/**
 * Squash improvement scanning for Intelligent Design.
 *
 * This module provides utilities for scanning neurons and finding better
 * squash (activation) functions to improve creature scores.
 *
 * @module
 */

import { assert } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";
import type { NeatOptions } from "../config/NeatOptions.ts";
import { Creature } from "../Creature.ts";
import { alternativeSquashes } from "./AlternativeSquashes.ts";
import type { BestNeuronSquash } from "./BestNeuronSquash.ts";
import { safeWriteText, safeWriteTextSync } from "./SafeWrite.ts";
import { WorkerHandler } from "./workers/WorkerHandler.ts";

function remainingTimeMs(deadlineMs: number): number {
  return Math.max(0, deadlineMs - Date.now());
}

async function waitForAllSettledOrTimeout(
  tasks: Set<Promise<unknown>>,
  deadlineMs: number,
): Promise<boolean> {
  if (tasks.size === 0) return false;

  const remainingMs = remainingTimeMs(deadlineMs);
  if (remainingMs === 0) return true;

  let timeoutID: number | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutID = setTimeout(() => resolve("timeout"), remainingMs);
  });

  const settled = Promise.allSettled(Array.from(tasks)).then(() =>
    "settled" as const
  );

  const result = await Promise.race([settled, timeout]);

  if (timeoutID !== undefined) {
    clearTimeout(timeoutID);
  }

  return result === "timeout";
}

/**
 * Options for squash improvement scanning.
 */
export interface ImproveSquashOptions {
  /** The creature export to improve */
  creature: CreatureExport;
  /** The target squash function to try substituting */
  targetSquash: string;
  /** Directory to write improved creatures to */
  outputDir: string;
  /** Directory containing scoring data */
  dataDir: string;
  /** The current best score of the creature */
  bestScore: number;
  /** NEAT options for scoring (can include customCost) */
  options?: NeatOptions;
  /** Maximum number of improvements to find before stopping (default: 12) */
  maxImprovements?: number;
  /** Maximum pending tasks per worker (default: auto-calculated) */
  maxPending?: number;
  /** Timeout in milliseconds (default: 60 minutes) */
  timeoutMs?: number;
  /** Epsilon for score comparison (default: 1e-8) */
  epsilon?: number;
  /** Callback for progress updates */
  onProgress?: (completed: number, total: number) => void;

  /**
   * Optional override for the alternative squashes list.
   *
   * This is primarily intended for deterministic tests and specialised runners.
   */
  alternativeSquashes?: readonly string[];

  /**
   * Optional override for CPU worker count.
   *
   * This is primarily intended for deterministic tests and specialised runners.
   */
  cpuCount?: number;

  /**
   * Optional worker factory.
   *
   * This is primarily intended for tests (to avoid spawning actual workers).
   */
  createWorker?: () => Pick<WorkerHandler, "score" | "terminate">;

  /**
   * Optional file writer overrides.
   *
   * By default, Intelligent Design uses `safeWriteText` / `safeWriteTextSync` to
   * guarantee atomic writes (write temp file then rename). Overrides are mainly
   * intended for tests.
   */
  writeText?: (filePath: string, content: string) => Promise<void>;
  writeTextSync?: (filePath: string, content: string) => void;
  remove?: (path: string) => Promise<void>;
  removeSync?: (path: string) => void;
}

/**
 * Result from a squash improvement scan.
 */
export interface ImproveSquashResult {
  /** Map of neuron UUID to best squash info */
  improvements: Map<string, BestNeuronSquash>;
  /**
   * Number of successful scoring operations.
   *
   * This counts only worker responses that included a `score` payload.
   * Failed worker responses (where `error` is set and `score` is undefined) are
   * not included.
   */
  tested: number;
  /**
   * Number of scoring operations attempted (successful + failed).
   *
   * This includes primary scans and alternative squash follow-ups.
   */
  attempted: number;
  /** Number of failed scoring operations (worker response returned `error` or no score). */
  failed: number;
  /**
   * Sample of worker failures encountered during the scan (capped).
   *
   * This exists to avoid silent failure when scoring cannot run (e.g. missing
   * data files, invalid dataset, or `scoreDir()` throws).
   */
  errors: Array<{
    /** Neuron UUID being evaluated (when available). */
    uuid?: string;
    /** Squash being evaluated (when available). */
    squash?: string;
    /** Whether this was a primary target-squash test or an alternative follow-up. */
    stage: "target" | "alternative";
    /** Error message. */
    message: string;
    /** Error name (when available). */
    name?: string;
  }>;
  /** Number of neurons that showed improvement */
  improved: number;
  /** Total time taken in milliseconds */
  duration: number;
  /** Whether the scan was terminated early due to timeout */
  timedOut: boolean;
}

/**
 * Creates a modified creature with a neuron's squash function changed.
 *
 * @param neuronUUID - The UUID of the neuron to modify
 * @param creatureExport - The creature export to modify
 * @param nextSquash - The new squash function to apply
 * @returns Object containing the modified creature and the previous squash
 */
export function makeModifiedCreatureWithPrevious(
  neuronUUID: string,
  creatureExport: CreatureExport,
  nextSquash: string,
): { creature: Creature; previousSquash: string } {
  // Important: operate on a deep clone of the supplied export rather than
  // round-tripping through `Creature.fromJSON(...).exportJSON()`.
  //
  // The round-trip can normalise/upgrade JSON (or reorder/omit fields) which
  // makes UUID-based lookups brittle in callers that hold UUIDs from the
  // original export (e.g. tests and Intelligent Design improvement maps).
  const tmpJson: CreatureExport = typeof structuredClone === "function"
    ? structuredClone(creatureExport)
    : JSON.parse(JSON.stringify(creatureExport));

  const neuronData = tmpJson.neurons.find((n: NeuronExport) =>
    n.uuid === neuronUUID
  );
  assert(neuronData, "Neuron not found in the creature JSON");
  const previousSquash = neuronData.squash;
  assert(previousSquash, "Previous squash should be defined");

  if (neuronData.squash === nextSquash) {
    console.warn(
      `${neuronData.uuid} Squash should be different from ${nextSquash}`,
    );
  }

  neuronData.squash = nextSquash;
  addTag(
    neuronData,
    "intelligentDesign",
    `${previousSquash} -> ${nextSquash}`,
  );

  return {
    creature: Creature.fromJSON(tmpJson),
    previousSquash,
  };
}

/**
 * Shuffles an array in place using Fisher-Yates algorithm.
 *
 * @param array - The array to shuffle
 * @returns The shuffled array
 */
export function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Scans neurons and finds better squash functions to improve the creature's score.
 *
 * This function:
 * 1. Gets all hidden neurons that don't already have the target squash
 * 2. Shuffles them for random exploration
 * 3. Tries replacing each neuron's squash with the target squash
 * 4. For neurons that improve, also tries alternative squashes
 * 5. Returns the best improvements found
 *
 * @param options - Configuration options for the scan
 * @returns Promise resolving to the scan result
 */
export async function scanForSquashImprovements(
  options: ImproveSquashOptions,
): Promise<ImproveSquashResult> {
  const {
    creature,
    targetSquash,
    outputDir,
    dataDir,
    bestScore,
    options: neatOptions = {},
    maxImprovements = 12,
    timeoutMs = 60 * 60 * 1000,
    epsilon = 1e-8,
    onProgress,
    alternativeSquashes: alternativeSquashesOverride,
    cpuCount,
    createWorker,
    writeText,
    writeTextSync,
    remove,
    removeSync,
  } = options;

  const start = Date.now();
  const deadlineMs = start + timeoutMs;

  // Get neurons to test
  const neuronList: NeuronExport[] = creature.neurons.filter(
    (n: NeuronExport) => n.type === "hidden" && n.squash !== targetSquash,
  );

  shuffle(neuronList);

  const altSquashes = alternativeSquashesOverride ?? alternativeSquashes;
  const CPU_COUNT = cpuCount ?? (navigator.hardwareConcurrency || 4);
  const makeWorker = createWorker ?? (() => new WorkerHandler());
  const writeTextFile = writeText ?? safeWriteText;
  const writeTextFileSync = writeTextSync ?? safeWriteTextSync;
  const removeFile = remove ?? (removeSync
    ? (path: string) => {
      removeSync(path);
      return Promise.resolve();
    }
    : (path: string) => Deno.remove(path));

  const workers: Array<Pick<WorkerHandler, "score" | "terminate">> = Array.from(
    { length: CPU_COUNT },
    () => makeWorker(),
  );

  const maxPending = options.maxPending ??
    Math.min(maxImprovements, CPU_COUNT) * 2;

  let taskCount = 0;
  let attempted = 0;
  let tested = 0;
  let failed = 0;
  let completedPrimary = 0;
  const primaryTotal = neuronList.length;
  const errorSamples: ImproveSquashResult["errors"] = [];
  const maxErrorSamples = 25;

  const bestNeuronSquashMap = new Map<string, BestNeuronSquash>();
  const workerTasksSet = new Set<Promise<unknown>>();
  const alternativeTaskSet = new Set<Promise<void>>();

  let lastThrottleTime = 0;
  let timedOut = false;
  let firstError: unknown | undefined;

  try {
    for (const neuron of neuronList) {
      // Check timeout
      const now = Date.now();
      if (now - start > timeoutMs) {
        console.warn(`Timeout after: ${now - start}ms`);
        timedOut = true;
        break;
      }

      // Check if we've found enough improvements
      if (bestNeuronSquashMap.size >= maxImprovements) break;

      // Throttle if too many pending tasks.
      //
      // Important: `Promise.race(...)` can throw if a task rejects (e.g. file write
      // failure). We still must terminate worker threads in that case, hence the
      // `try/finally` wrapper around the whole scan.
      while (
        workerTasksSet.size + alternativeTaskSet.size >= maxPending &&
        bestNeuronSquashMap.size < maxImprovements
      ) {
        const pendingCount = workerTasksSet.size + alternativeTaskSet.size;
        const throttleNow = Date.now();

        if (throttleNow - lastThrottleTime > 60_000) {
          console.log(
            `Throttling: waiting for tasks to complete... pending: ${pendingCount}, max: ${maxPending}, found: ${bestNeuronSquashMap.size}`,
          );
          lastThrottleTime = throttleNow;
        }

        if (workerTasksSet.size > 0) {
          // deno-lint-ignore no-await-in-loop -- Intentional throttling: wait for one task to complete before adding more
          await Promise.race(workerTasksSet);
        } else {
          // deno-lint-ignore no-await-in-loop -- Intentional throttling: wait for one task to complete before adding more
          await Promise.race(alternativeTaskSet);
        }
      }

      // Skip if neuron already has target squash
      if (targetSquash === neuron.squash) {
        console.log(
          `Neuron ${
            neuron.uuid?.slice(-8)
          } already has squash ${targetSquash}, skipping.`,
        );
        continue;
      }

      const p = (async () => {
        if (bestNeuronSquashMap.size >= maxImprovements) return;

        const neuronUUID = neuron.uuid;
        assert(neuronUUID, "Neuron UUID should be defined");

        const { creature: modifiedCreature, previousSquash } =
          makeModifiedCreatureWithPrevious(
            neuronUUID,
            creature,
            targetSquash,
          );

        const worker = workers[taskCount % CPU_COUNT];
        taskCount++;

        const res = await worker.score(
          modifiedCreature,
          neuronUUID,
          dataDir,
          neatOptions,
        );
        attempted++;
        completedPrimary++;

        if (onProgress) {
          onProgress(completedPrimary, primaryTotal);
        }

        if (res?.score) {
          tested++;
          if (res.score.score - bestScore > epsilon) {
            const shortId = res.score.uuid.slice(-8);
            const lastMessage =
              `Neuron ${shortId} ${previousSquash} -> ${targetSquash}, score: ${
                res.score.score.toPrecision(6)
              } improved by ${(res.score.score - bestScore).toPrecision(3)}`;
            console.log(lastMessage);

            const path = `${outputDir}/${targetSquash}_${shortId}.json`;

            await writeTextFile(path, res.score.creature);
            bestNeuronSquashMap.set(res.score.uuid, {
              squash: targetSquash,
              score: res.score.score,
              path: path,
              message: lastMessage,
            });

            // Try alternative squashes for this neuron
            for (const altSquash of altSquashes) {
              if (
                altSquash !== targetSquash &&
                altSquash !== neuron.squash &&
                alternativeTaskSet.size < 90
              ) {
                assert(res.score, "Score should be defined");
                assert(res.score.creature, "Creature should be defined");

                const altCreatureExport = Creature.fromJSON(
                  JSON.parse(res.score.creature),
                ).exportJSON();
                const { creature: altCreature } =
                  makeModifiedCreatureWithPrevious(
                    neuronUUID,
                    altCreatureExport,
                    altSquash,
                  );

                const altWorker = workers[taskCount % CPU_COUNT];
                taskCount++;

                const alternativeTask = altWorker.score(
                  altCreature,
                  neuronUUID,
                  dataDir,
                  neatOptions,
                ).then(async (alternativeRes) => {
                  attempted++;
                  if (alternativeRes?.score) {
                    tested++;
                    const currentNeuronBest = bestNeuronSquashMap.get(
                      neuronUUID,
                    );
                    assert(
                      currentNeuronBest,
                      "Current neuron best should be defined",
                    );

                    if (
                      alternativeRes.score.score - currentNeuronBest.score >
                        epsilon
                    ) {
                      const alternativeMessage =
                        `Neuron ${shortId} ${targetSquash} -> ${altSquash}, score: ${
                          alternativeRes.score.score.toPrecision(6)
                        } improved by ${
                          (alternativeRes.score.score - bestScore).toPrecision(
                            3,
                          )
                        }`;
                      console.log(alternativeMessage);

                      const altPath =
                        `${outputDir}/${altSquash}_${shortId}.json`;

                      writeTextFileSync(
                        altPath,
                        alternativeRes.score.creature,
                      );
                      bestNeuronSquashMap.set(alternativeRes.score.uuid, {
                        squash: altSquash,
                        score: alternativeRes.score.score,
                        path: altPath,
                        message: alternativeMessage,
                      });

                      // Remove the previous best file
                      await removeFile(currentNeuronBest.path);
                    }
                  } else {
                    failed++;
                    const err = (alternativeRes &&
                        typeof alternativeRes === "object" &&
                        "error" in alternativeRes)
                      ? (alternativeRes as {
                        error?: { message: string; name?: string };
                      }).error
                      : undefined;
                    if (errorSamples.length < maxErrorSamples) {
                      errorSamples.push({
                        uuid: neuronUUID,
                        squash: altSquash,
                        stage: "alternative",
                        message: err?.message ??
                          "Worker returned no score (alternative squash) and no error message",
                        name: err?.name,
                      });
                    }
                  }
                }).catch((error) => {
                  if (firstError === undefined) firstError = error;
                  throw error;
                });

                alternativeTaskSet.add(alternativeTask);
                alternativeTask.finally(() =>
                  alternativeTaskSet.delete(alternativeTask)
                ).catch(() => {
                  // Avoid unhandled rejections from the `finally()` chain when the task fails.
                });
              }
            }
          }
        } else {
          failed++;
          const err = (res && typeof res === "object" && "error" in res)
            ? (res as { error?: { message: string; name?: string } }).error
            : undefined;
          if (errorSamples.length < maxErrorSamples) {
            errorSamples.push({
              uuid: neuronUUID,
              squash: targetSquash,
              stage: "target",
              message: err?.message ??
                "Worker returned no score (target squash) and no error message",
              name: err?.name,
            });
          }
        }
      })().catch((error) => {
        if (firstError === undefined) firstError = error;
        throw error;
      });

      workerTasksSet.add(p);
      p.finally(() => workerTasksSet.delete(p)).catch(() => {
        // Avoid unhandled rejections from the `finally()` chain when the task fails.
      });
    }

    // Wait for all tasks to complete, but never block past the overall timeout.
    // This prevents a permanently hung scan if a worker task never settles.
    timedOut = timedOut ||
      (await waitForAllSettledOrTimeout(workerTasksSet, deadlineMs));
    timedOut = timedOut ||
      (await waitForAllSettledOrTimeout(alternativeTaskSet, deadlineMs));

    if (firstError !== undefined) {
      const err = firstError instanceof Error
        ? firstError
        : new Error(String(firstError));
      throw err;
    }

    return {
      improvements: bestNeuronSquashMap,
      tested,
      attempted,
      failed,
      errors: errorSamples,
      improved: bestNeuronSquashMap.size,
      duration: Date.now() - start,
      timedOut,
    };
  } finally {
    // Always terminate workers, even if the scan fails midway (e.g. file write
    // failure causes a task rejection that bubbles out during throttling).
    for (const worker of workers) {
      try {
        worker.terminate();
      } catch (error) {
        console.error("Failed to terminate Intelligent Design worker:", error);
      }
    }
  }
}

/**
 * Combines multiple neuron improvements into a single creature and scores it.
 *
 * If the combined creature scores better than the best individual improvement,
 * returns the combined creature. Otherwise, returns the best individual.
 *
 * @param originalCreature - The original creature export
 * @param improvements - Map of neuron improvements
 * @param dataDir - Directory containing scoring data
 * @param bestScore - The original best score
 * @param options - NEAT options for scoring
 * @returns The best creature export with appropriate tags
 */
export function combineImprovements(
  originalCreature: CreatureExport,
  improvements: Map<string, BestNeuronSquash>,
  dataDir: string,
  bestScore: number,
  options: NeatOptions = {},
): { creature: CreatureExport; message: string } {
  if (improvements.size === 0) {
    return {
      creature: originalCreature,
      message: "No improvements found.",
    };
  }

  if (improvements.size === 1) {
    const improvement = improvements.values().next().value;
    assert(improvement, "Should have one improvement");
    const json = JSON.parse(Deno.readTextFileSync(improvement.path));
    return {
      creature: json,
      message: improvement.message,
    };
  }

  // Find the best individual improvement
  let bestIndividualScore = -Infinity;
  let bestIndividual: BestNeuronSquash | undefined;

  for (const improvement of improvements.values()) {
    if (improvement.score > bestIndividualScore) {
      bestIndividualScore = improvement.score;
      bestIndividual = improvement;
    }
  }

  // Try combining all improvements
  // As with `makeModifiedCreatureWithPrevious()`, avoid round-tripping through
  // `Creature.fromJSON(...).exportJSON()` before applying UUID-based edits.
  // Deep clone the export and apply changes directly, then score via fromJSON.
  const finalJson: CreatureExport = typeof structuredClone === "function"
    ? structuredClone(originalCreature)
    : JSON.parse(JSON.stringify(originalCreature));

  for (const [uuid, improvement] of improvements) {
    const neuron = finalJson.neurons.find((n: NeuronExport) => n.uuid === uuid);
    assert(neuron, "Neuron not found in the final JSON");
    const previousSquash = neuron.squash;
    neuron.squash = improvement.squash;
    addTag(
      neuron,
      "intelligentDesign",
      `${previousSquash} -> ${improvement.squash}`,
    );
  }

  const finalCreature = Creature.fromJSON(finalJson);
  finalCreature.fix();
  const result = finalCreature.scoreDir(dataDir, options);

  if (result.score > bestIndividualScore) {
    const message = `Combined ${improvements.size} neurons, score: ${
      result.score.toPrecision(6)
    } improved by ${(result.score - bestScore).toPrecision(3)}`;

    const exported = finalCreature.exportJSON();
    addTag(exported, "score", `${result.score}`);
    addTag(exported, "error", `${result.error}`);
    addTag(exported, "intelligentDesign", message);

    return {
      creature: exported,
      message,
    };
  }

  // Return the best individual improvement
  assert(bestIndividual, "Best individual should be defined");
  const json = JSON.parse(Deno.readTextFileSync(bestIndividual.path));
  const message =
    `Marriage failed, using best individual: ${bestIndividual.message}`;
  addTag(json, "intelligentDesign", message);

  return {
    creature: json,
    message,
  };
}
