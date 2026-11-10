/**
 * Per-task training backend report (Issue #4146).
 *
 * A hung native `trainDir` task used to leave no trace in the parent's log of
 * which backend ran or whether a deadline was sent: the worker's own
 * `getLogger()` lines go to the worker isolate's console, not the parent's
 * logger. This module gives each training task one line, written before the
 * blocking native call:
 *
 * ```text
 * [training-backend] task=<ID> backend=<ffi|cli|wasm> deadlineSent=<yes|no> capability=<version|none>
 * ```
 *
 * - `task` — the task's `setup.ID` (the 8-char creature id).
 * - `backend` — `ffi` (in-process `libneat_ai_backpropagation`), `cli`
 *   (spawned `neat_ai_backpropagation`), or `wasm` (the TypeScript / WASM loop,
 *   including the predictive-coding trainer).
 * - `deadlineSent` — `yes` when the request carried a deadline
 *   (`deadlineEpochMs` / `--deadline-epoch-ms`).
 * - `capability` — the version of the deadline capability the backend
 *   advertised, or `none` when it advertised none (or the run is `wasm`).
 *
 * Messages are routed through a reporter hook. In a pooled worker the
 * reporter is replaced by one that posts the message to the parent, whose
 * `WorkerHandlerBase` writes it to the parent's logger (see
 * `WorkerLogRelay.ts`). Everywhere else the default reporter calls
 * `getLogger()` at call time, so the line reaches the caller's logger
 * directly.
 *
 * @module
 */

import { getLogger } from "@utils/Logger.ts";

/** The backend that ran a training task. */
export type TrainDirBackend = "ffi" | "cli" | "wasm";

/** What a training task reports about its backend before the native call. */
export interface TrainDirBackendInfo {
  backend: TrainDirBackend;
  /** `true` when the request carried a deadline. */
  deadlineSent: boolean;
  /** `String(capability.version)` of the deadline capability, or `none`. */
  capability: string;
}

/** Severity of a reported message. */
export type TrainDirReportLevel = "info" | "warn";

/** Receives every reported message; see {@link setTrainDirReporter}. */
export type TrainDirReporter = (
  level: TrainDirReportLevel,
  message: string,
) => void;

let reporter: TrainDirReporter | undefined;

/**
 * Replace the reporter, or pass `undefined` to restore the default, which
 * writes to `getLogger()`. A pooled worker installs a reporter that posts to
 * its parent; tests install a capturing one and restore it in `finally`.
 */
export function setTrainDirReporter(
  next: TrainDirReporter | undefined,
): void {
  reporter = next;
}

/** Build the one-line `[training-backend]` report for a task. */
export function formatTrainDirBackendLine(
  ID: string,
  info: TrainDirBackendInfo,
): string {
  const deadlineSent = info.deadlineSent ? "yes" : "no";
  return `[training-backend] task=${ID} backend=${info.backend} deadlineSent=${deadlineSent} capability=${info.capability}`;
}

/** Report a `trainDir` message through the reporter hook. */
export function reportTrainDirMessage(
  level: TrainDirReportLevel,
  message: string,
): void {
  if (reporter !== undefined) {
    reporter(level, message);
    return;
  }
  getLogger()[level](message);
}

/**
 * Report which backend a training task is about to run, at info level, before
 * the blocking native call.
 */
export function reportTrainDirBackend(
  ID: string,
  info: TrainDirBackendInfo,
): void {
  reportTrainDirMessage("info", formatTrainDirBackendLine(ID, info));
}
