/**
 * Worker-side training backend relay (Issue #4146).
 *
 * A pooled worker isolate has its own logger, so the `[training-backend]` line
 * and the `trainDir` warnings it reports would never reach the parent. The
 * worker entry point calls {@link installTrainDirRelay} before its message loop
 * starts: every reported message is then posted to the parent as a relayed log
 * message (`WorkerLogRelay.ts`), which the parent's `WorkerHandlerBase` writes
 * to its own logger.
 *
 * @module
 */

import { setTrainDirReporter } from "@architecture/training/TrainDirBackendReport.ts";
import { buildWorkerLogMessage } from "@workers/WorkerLogRelay.ts";

/**
 * Route every `trainDir` report through `post` to the parent. `post` is the
 * worker's own `postMessage`, passed in so the relay has no global dependency.
 */
export function installTrainDirRelay(post: (message: unknown) => void): void {
  setTrainDirReporter((level, message) => {
    post(buildWorkerLogMessage(level, message));
  });
}
