import { WorkerData } from "./WorkerHandler.ts";

import { Network } from "../../architecture/network.js";
import { findCost } from "../../config.ts";

export class WorkerProcessor {
  // deno-lint-ignore no-explicit-any
  private cost: any = null;
  private dataSetDir: (string | null) = null;

  process(data: WorkerData) {
    if (data.evaluate) {
      const network = Network.fromJSON(data.evaluate.network);
      const result = network.test(this.dataSetDir, this.cost);

      return result;
    } else if (data.initialize) {
      this.cost = findCost(data.initialize.costName);

      this.dataSetDir = data.initialize.dataSetDir;
      return { status: "OK" };
    } else {
      console.error(data);
      throw "unknown message";
    }
  }
}
