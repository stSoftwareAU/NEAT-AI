import type { RequestData, WorkerInterface } from "./WorkerHandler.ts";
import type { ResponseData } from "./ResponseData.ts";
import { WorkerProcessor } from "./WorkerProcessor.ts";

/**
 * In-process (direct) worker for Intelligent Design scoring.
 *
 * This avoids spawning a real Deno Worker, which can be unreliable in remote
 * environments that cannot fetch/compile the worker module graph quickly
 * (e.g. cold JSR caches, restricted networking).
 *
 * The interface matches the minimal `WorkerInterface` contract expected by
 * `WorkerHandler`.
 */
export class MockWorker implements WorkerInterface {
  private callBack: EventListener | null = null;
  private processor = new WorkerProcessor();

  addEventListener(
    _type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions,
  ): void {
    // We only ever use "message" listeners in this codepath.
    this.callBack = listener as EventListener;
  }

  postMessage(data: RequestData): void {
    this.processor.process(data).then((result) => {
      type MockEvent = Event & { data: ResponseData };
      const me = new Event("mock") as MockEvent;
      me.data = result;
      this.callBack?.(me);
    }).catch((error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      const errorResponse: ResponseData = {
        taskID: data.taskID,
        duration: 0,
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
      };
      type MockEvent = Event & { data: ResponseData };
      const me = new Event("mock") as MockEvent;
      me.data = errorResponse;
      this.callBack?.(me);
    });
  }

  terminate(): void {
    this.callBack = null;
    // @ts-ignore - clearing processor reference
    this.processor = null;
  }
}
