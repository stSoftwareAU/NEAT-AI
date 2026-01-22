import type {
  RequestData,
  ResponseData,
  WorkerInterface,
} from "./WorkerHandler.ts";

import { WorkerProcessor } from "./WorkerProcessor.ts";

export class MockWorker implements WorkerInterface {
  private callBack: EventListener | null = null;

  addEventListener(
    _type: string,
    listener: EventListener,
    _options?: boolean | AddEventListenerOptions,
  ): void {
    this.callBack = listener;
  }

  private processor = new WorkerProcessor();
  postMessage(data: RequestData, _transfer?: Transferable[]) {
    this.processor.process(data).then((result) => {
      type MockEvent = Event & { data: ResponseData };
      const me = new Event("mock") as MockEvent;
      me.data = result;
      if (this.callBack) {
        this.callBack(me);
      }
    }).catch((error) => {
      console.error("MockWorker processing error:", error);
      // Create a proper error response with operation-specific error field
      const errorResponse: ResponseData = {
        taskID: data.taskID,
        duration: 0,
      };

      // Add operation-specific error field based on request type
      if (data.evaluate) {
        errorResponse.evaluate = {
          error: Number.POSITIVE_INFINITY, // Use infinity to indicate evaluation failure
        };
      } else if (data.train) {
        errorResponse.train = {
          ID: "error",
          creature: "",
          error: Number.POSITIVE_INFINITY, // Use infinity to indicate training failure
          trace: "",
        };
      } else if (data.discover) {
        errorResponse.discover = {
          ID: "error",
        };
      } else if (data.echo) {
        errorResponse.echo = {
          message: `Error: ${error?.message || String(error)}`,
        };
      } else if (data.initialize) {
        errorResponse.initialize = {
          status: "ERROR",
        };
      } else if (data.breed) {
        // Issue #1026: Handle breeding errors
        errorResponse.breed = {
          success: false,
        };
      }

      if (this.callBack) {
        type MockEvent = Event & { data: ResponseData };
        const me = new Event("mock") as MockEvent;
        me.data = errorResponse;
        this.callBack(me);
      }
    });
  }

  terminate(): void {
    // Clean up references to prevent memory leaks
    this.callBack = null;
    // @ts-ignore - clearing processor reference
    this.processor = null;
  }
}
