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
  postMessage(data: RequestData) {
    this.processor.process(data).then((result) => {
      type MockEvent = Event & { data: ResponseData };
      const me = new Event("mock") as MockEvent;
      me.data = result;
      if (this.callBack) {
        this.callBack(me);
      }
    }).catch((error) => {
      console.error("MockWorker processing error:", error);
      // Still call callback to prevent hanging promises
      if (this.callBack) {
        type MockEvent = Event & { data: ResponseData };
        const me = new Event("mock") as MockEvent;
        me.data = {
          taskID: data.taskID,
          duration: 0,
        };
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
