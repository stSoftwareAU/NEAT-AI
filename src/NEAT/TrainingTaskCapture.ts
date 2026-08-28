/**
 * TrainingTaskCapture.ts - persist the creature behind an in-flight training
 * task so a task that never returns can be reproduced offline (GRQ #4490).
 *
 * A training task whose worker promise never settles is force-abandoned by the
 * stuck-task watchdog: it returns nothing, throws nothing, and the only trace
 * is the watchdog line naming the last 8 characters of each creature uuid.
 * Consumers (GRQ) then tried to resolve those ids against the saved population
 * on disk and matched 6 of 61 — by the time the run ends the population has
 * moved on several generations, and a creature handed to a task mid-generation
 * need never have been written under that uuid at all.
 *
 * Only the scheduler holds the exact creature it dispatched, so the capture
 * belongs here: write the export before the task is dispatched, delete it when
 * the task settles. What survives is exactly the set of tasks that never
 * returned — no uuid lookup, no dependence on the saved population.
 *
 * Off by default and zero-cost when off. Set
 * `NEAT_AI_TRAINING_TASK_CAPTURE_DIR` to the directory the captures should
 * land in; the environment read is permission-safe, so a run without
 * `--allow-env` simply captures nothing.
 *
 * A capture is a diagnostic, never a training decision: an unwritable
 * directory is reported once, loudly, and the task is dispatched regardless.
 */

import { ensureDirSync } from "@std/fs";
import type { Creature } from "@creature";
import { getLogger } from "@utils/Logger.ts";

/** Environment variable naming the directory in-flight captures land in. */
export const TRAINING_TASK_CAPTURE_DIR_ENV =
  "NEAT_AI_TRAINING_TASK_CAPTURE_DIR";

/** Prefix of every capture file, so a shared directory stays readable. */
const CAPTURE_PREFIX = "training-task-";

/** Whether the "capture failed" warning has already been logged this run. */
let captureFaultReported = false;

/**
 * The task id the watchdog logs for a creature: the last 8 characters of its
 * uuid. Capture files are keyed by it so a consumer reading the watchdog line
 * needs no uuid lookup to find the creature.
 *
 * @param uuid full creature uuid
 */
export function trainingTaskId(uuid: string): string {
  return uuid.substring(Math.max(0, uuid.length - 8));
}

/**
 * The configured capture directory, or `undefined` when capture is off.
 *
 * The read is permission-safe: a run without `--allow-env` captures nothing
 * rather than failing.
 */
export function trainingTaskCaptureDir(): string | undefined {
  try {
    const dir = Deno.env.get(TRAINING_TASK_CAPTURE_DIR_ENV);
    if (dir === undefined || dir.trim() === "") return undefined;
    return dir.trim();
  } catch {
    return undefined;
  }
}

/**
 * Path of the capture file for one task.
 *
 * @param dir capture directory
 * @param uuid full creature uuid
 */
export function trainingTaskCapturePath(dir: string, uuid: string): string {
  return `${dir}/${CAPTURE_PREFIX}${trainingTaskId(uuid)}.json`;
}

/**
 * Write the creature a training task is about to be handed, keyed by task id.
 *
 * Called immediately before dispatch, so the file exists for the whole window
 * in which the task can hang. No-op when capture is not configured.
 *
 * @param uuid full creature uuid
 * @param creature the exact creature being dispatched
 */
export function beginTrainingTaskCapture(
  uuid: string,
  creature: Creature,
): void {
  const dir = trainingTaskCaptureDir();
  if (dir === undefined) return;
  const path = trainingTaskCapturePath(dir, uuid);
  try {
    ensureDirSync(dir);
    // Compact, exactly as the checkpoint writer persists a creature, so the
    // capture is a loadable creature export and nothing more.
    Deno.writeTextFileSync(path, JSON.stringify(creature.exportJSON()));
  } catch (err) {
    reportCaptureFault(
      `could not write ${path}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/**
 * Delete the capture for a task that settled — it returned a result (or a
 * failure), so it is not a hang and its creature is not evidence.
 *
 * No-op when capture is not configured or the file is already gone.
 *
 * @param uuid full creature uuid
 */
export function endTrainingTaskCapture(uuid: string): void {
  const dir = trainingTaskCaptureDir();
  if (dir === undefined) return;
  const path = trainingTaskCapturePath(dir, uuid);
  try {
    Deno.removeSync(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return;
    reportCaptureFault(
      `could not remove ${path}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/**
 * Report the first capture fault of the run. Loud once, then quiet: a broken
 * capture directory would otherwise emit a line per training dispatch and
 * drown the run it is meant to explain.
 */
function reportCaptureFault(detail: string): void {
  if (captureFaultReported) return;
  captureFaultReported = true;
  getLogger().warn(
    `[Neat] Training-task capture failed — a hung task cannot be reproduced ` +
      `offline from this run (${detail}). Training continues (GRQ #4490).`,
  );
}

/** Test seam: forget that a fault was reported. */
export function resetTrainingTaskCaptureFaultReporting(): void {
  captureFaultReported = false;
}
