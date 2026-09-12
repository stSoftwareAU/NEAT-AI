/**
 * @module
 *
 * Schedule-time capture of the creature handed to each training task
 * (Issue #4022, GRQ #4490 / #4794).
 *
 * When a training task hangs, the only creature that reproduces the hang is
 * the one the worker was handed mid-generation — which need never be written
 * to the saved population under that uuid, so a lookup there almost never
 * matches. While `NEAT_AI_TRAINING_TASK_CAPTURE_DIR` is set, the scheduler
 * writes the creature as dispatched to `<dir>/training-task-<id>.json` and
 * removes the file when the task settles; whatever survives a run is exactly
 * the hung set. `<id>` is the last eight characters of the creature UUID —
 * the id the stuck-task watchdog prints.
 *
 * A diagnostic never changes training: a capture that cannot be written or
 * removed is logged and ignored.
 */

import { join } from "@std/path";
import { getLogger } from "@utils/Logger.ts";

/** Environment variable naming the capture directory; unset = off. */
export const TRAINING_TASK_CAPTURE_DIR_ENV =
  "NEAT_AI_TRAINING_TASK_CAPTURE_DIR";

/** Length of the UUID suffix used as the task id in log lines and file names. */
const TASK_ID_SUFFIX = 8;

/**
 * The capture directory, or `undefined` when the capture is not armed (the
 * variable is unset or empty, or the environment cannot be read).
 */
export function trainingTaskCaptureDir(
  env: (name: string) => string | undefined = readEnv,
): string | undefined {
  const dir = env(TRAINING_TASK_CAPTURE_DIR_ENV);
  return dir !== undefined && dir !== "" ? dir : undefined;
}

function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** The id the watchdog prints for a task: the UUID's last eight characters. */
export function trainingTaskId(uuid: string): string {
  return uuid.substring(Math.max(0, uuid.length - TASK_ID_SUFFIX));
}

/** Where the capture for `uuid` lives inside `dir`. Pure. */
export function trainingTaskCapturePath(dir: string, uuid: string): string {
  return join(dir, `training-task-${trainingTaskId(uuid)}.json`);
}

/**
 * Write the dispatched creature for `uuid` into `dir`.
 *
 * Resolves to the file written, or `undefined` when the write failed (logged,
 * never thrown — the task is already on its way to the worker).
 */
export async function writeTrainingTaskCapture(
  dir: string,
  uuid: string,
  creatureJSON: unknown,
): Promise<string | undefined> {
  const path = trainingTaskCapturePath(dir, uuid);
  try {
    await Deno.writeTextFile(path, JSON.stringify(creatureJSON));
    return path;
  } catch (error) {
    getLogger().warn(
      `[training-capture] cannot write ${path}: ${
        error instanceof Error ? error.message : String(error)
      } — a hang on task ${
        trainingTaskId(uuid)
      } will not be reproducible offline (#4022)`,
    );
    return undefined;
  }
}

/**
 * Remove the capture written for a task that has settled. A file that is
 * already gone is not an error; anything else is logged and ignored.
 */
export async function removeTrainingTaskCapture(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    getLogger().warn(
      `[training-capture] cannot remove ${path}: ${
        error instanceof Error ? error.message : String(error)
      } — it will be reported as a hung task it is not (#4022)`,
    );
  }
}
