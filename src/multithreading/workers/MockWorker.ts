import { RequestData, ResponseData, WorkerInterface } from "./WorkerHandler.ts";

import { WorkerProcessor } from "./WorkerProcessor.ts";

export class MockWorker implements WorkerInterface {
  private callBack: (EventListener | null) = null;

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
    });
  }

  terminate(): void {
  }
}
