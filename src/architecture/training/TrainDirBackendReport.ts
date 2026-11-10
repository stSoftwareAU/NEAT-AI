/**
 * Per-task training backend report (Issue #4146).
 *
 * A hung native `trainDir` task used to leave no trace in the parent's log of
 * which backend ran or whether a deadline was sent: the worker's own
 * `getLogger()` lines go to the worker isolate's console, not the parent's
 * logger. This module gives each training task one `[training-backend]` line,
 * written before the blocking native call:
 *
 * ```text
 * [training-backend] task=<ID> backend=<ffi|cli|wasm> deadlineSent=<yes|no> capability=<version|none>
 * ```
 *
 * Two `[training-phase]` lines follow it per native (`ffi` / `cli`) task:
 *
 * - `native-returned` is written as soon as the blocking native call returns,
 *   before the response is parsed or packaged. `timedOut=unknown` means the
 *   response has not been read yet (CLI) or the engine did not report it
 *   (legacy FFI). A native call that throws writes no phase line: the task
 *   fails with its error.
 * - `finalised` is written when packaging and compaction finish.
 *
 * Triage: a backend line with no `native-returned` line means the native call
 * had not returned, or it threw (the task's error says which). A
 * `native-returned` line with no `finalised` line means the task hung after the
 * native call returned: in parsing, packaging or finalisation.
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

/** A lifecycle point a training task reached after its native call (Issue #4146). */
export type TrainDirPhase = "native-returned" | "finalised";

/** What a training task reports when it reaches a phase. */
export interface TrainDirPhaseInfo {
  phase: TrainDirPhase;
  /** `undefined` when the outcome is not known yet, rendered `unknown`. */
  timedOut: boolean | undefined;
  /** now - deadline in whole ms (negative = before the deadline); undefined when the task has no deadline */
  msFromDeadline: number | undefined;
}

/** Build the one-line `[training-phase]` report for a task. */
export function formatTrainDirPhaseLine(
  ID: string,
  info: TrainDirPhaseInfo,
): string {
  const timedOut = info.timedOut === undefined
    ? "unknown"
    : info.timedOut
    ? "yes"
    : "no";
  const msFromDeadline = info.msFromDeadline === undefined
    ? "none"
    : String(info.msFromDeadline);
  return `[training-phase] task=${ID} phase=${info.phase} timedOut=${timedOut} msFromDeadline=${msFromDeadline}`;
}

/** Report a task's phase at info level through the reporter hook. */
export function reportTrainDirPhase(
  ID: string,
  info: TrainDirPhaseInfo,
): void {
  reportTrainDirMessage("info", formatTrainDirPhaseLine(ID, info));
}
