/**
 * MockEpisodeWorker.ts — In-process worker for the parallel episode-rollout
 * pool (Issue #2612).
 *
 * Mirrors the `MockWorker` ↔ `WorkerProcessor` pattern used by the
 * dataset-fitness path: implements the {@link WorkerInterface} contract but
 * runs the {@link EpisodeWorkerProcessor} on the calling thread. Used for
 * unit tests and for the `evolveRL()` worker-init-failure fallback path so
 * rollouts continue producing identical results when the real worker
 * cannot be spun up.
 */

import type { WorkerInterface } from "@workers/WorkerInterface.ts";
import { EpisodeWorkerProcessor } from "@creature/EpisodeWorkerProcessor.ts";
import type {
  EpisodeRequest,
  EpisodeResponse,
} from "@creature/EpisodeWorkerProtocol.ts";

export class MockEpisodeWorker implements WorkerInterface<EpisodeRequest> {
  private callBack: EventListener | null = null;
  private processor = new EpisodeWorkerProcessor();

  addEventListener(
    _type: string,
    listener: EventListener,
    _options?: boolean | AddEventListenerOptions,
  ): void {
    this.callBack = listener;
  }

  postMessage(data: EpisodeRequest, _transfer?: Transferable[]): void {
    // Validate the payload is structured-clone safe — same gate the real
    // Worker.postMessage() applies. Catches non-cloneable adapter configs
    // (functions, symbols) at the seam rather than inside the worker.
    structuredClone(data);

    this.processor.process(data).then((result) => {
      type MockEvent = Event & { data: EpisodeResponse };
      const me = new Event("mock") as MockEvent;
      me.data = result;
      this.callBack?.(me);
    }).catch((error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      type MockEvent = Event & { data: EpisodeResponse };
      const me = new Event("mock") as MockEvent;
      const errorPayload = {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
      let response: EpisodeResponse;
      if ("initialize" in data) {
        response = {
          taskID: data.taskID,
          duration: 0,
          initialize: { status: "ERROR", error: err.message },
          error: errorPayload,
        };
      } else if ("runEpisodes" in data) {
        response = {
          taskID: data.taskID,
          duration: 0,
          runEpisodes: { outcomes: [] },
          error: errorPayload,
        };
      } else {
        // Discriminator on `data` is exhaustive above; this branch is only
        // reached when neither tag is present, so `data` here is structurally
        // narrowed to `never`. We still want to surface an error to callers
        // rather than silently dropping the message — read taskID via cast.
        const taskID = (data as { taskID: number }).taskID;
        response = {
          taskID,
          duration: 0,
          error: errorPayload,
        };
      }
      me.data = response;
      this.callBack?.(me);
    });
  }

  terminate(): void {
    this.callBack = null;
  }
}
