import { ResponseData, WorkerData } from "./WorkerHandler.ts";

import { Network } from "../../architecture/network.js";
import { NetworkUtil } from "../../architecture/NetworkUtil.ts";
import { findCost } from "../../config.ts";

export class WorkerProcessor {
  // deno-lint-ignore no-explicit-any
  private cost: any = null;
  private dataSetDir: (string | null) = null;

  process(data: WorkerData): ResponseData {
    if (data.evaluate) {
      const network = Network.fromJSON(data.evaluate.network);
      const result = network.test(this.dataSetDir, this.cost);

      return {
        taskID: data.taskID,
        evaluate: {
          error: result.error,
        },
      };
    } else if (data.initialize) {
      this.cost = findCost(data.initialize.costName);

      this.dataSetDir = data.initialize.dataSetDir;
      return {
        taskID: data.taskID,
        initialize: {
          status: "OK",
        },
      };
    } else if (data.train) {
      const network = Network.fromJSON(data.train.network);
      const util = new NetworkUtil(network);
      if (!this.dataSetDir) throw "No data dir";

      util.trainDir(this.dataSetDir, data.train.options);
      const json = JSON.stringify(network.toJSON(), null, 1);
      return {
        taskID: data.taskID,
        train: {
          network: json,
        },
      };
    } else {
      console.error(data);
      throw "unknown message";
    }
  }
}
