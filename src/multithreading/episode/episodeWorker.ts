/**
 * episodeWorker.ts — Deno Worker entry point for parallel episode rollouts
 * (Issue #2612).
 *
 * Counterpart to `src/multithreading/workers/deno/worker.ts` but tailored for
 * RL rollouts: no dataset directory, no cost function, no WASM-cache wiring
 * — the worker only needs the adapter URL plus per-creature genome and seed
 * set (see {@link EpisodeWorkerProtocol}).
 *
 * The worker reuses the shared {@link setupWorkerMessageLoop} so init
 * timeout, dispatch, and error handling stay aligned with the
 * `WorkerHandlerBase` lifecycle.
 */

import { setSkipWasmAutoInit } from "@globalAccessors";
import { setupWorkerMessageLoop } from "@workers/workerEntryPoint.ts";
import { toError, toErrorMessage } from "@utils/ErrorSerialisation.ts";
import type {
  EpisodeRequest,
  EpisodeResponse,
} from "@creature/EpisodeWorkerProtocol.ts";

// RL rollouts use the same WASM activation path as the main thread; skipping
// module-evaluation auto-init avoids the slow cold-start every worker would
// otherwise pay. This MUST run before the processor is loaded — the
// processor statically imports `@creature` which would otherwise trigger
// the auto-init side effect.
setSkipWasmAutoInit(true);

const { EpisodeWorkerProcessor } = await import(
  "@creature/EpisodeWorkerProcessor.ts"
);
const processor = new EpisodeWorkerProcessor();

setupWorkerMessageLoop<EpisodeRequest, EpisodeResponse>(
  processor,
  (data, error, durationMs) => {
    const err = toError(error);
    const errorPayload = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    if ("initialize" in data) {
      return {
        taskID: data.taskID,
        duration: durationMs,
        initialize: {
          status: "ERROR",
          error: toErrorMessage(error),
        },
        error: errorPayload,
      };
    }
    if ("runEpisodes" in data) {
      return {
        taskID: data.taskID,
        duration: durationMs,
        runEpisodes: { outcomes: [] },
        error: errorPayload,
      };
    }
    // Discriminator above is exhaustive; this branch is unreachable for
    // well-formed requests but still needs to be type-safe.
    const taskID = (data as { taskID: number }).taskID;
    return {
      taskID,
      duration: durationMs,
      error: errorPayload,
    };
  },
);
