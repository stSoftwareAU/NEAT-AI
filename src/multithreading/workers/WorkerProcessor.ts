import { RequestData, ResponseData } from "./WorkerHandler.ts";

import { Network } from "../../architecture/network.js";
import { NetworkUtil } from "../../architecture/NetworkUtil.ts";
import { findCost } from "../../config.ts";

import { TrainOptions } from "../../config/TrainOptions.ts";

export class WorkerProcessor {
  private costName: (string | null) = null;
  private dataSetDir: (string | null) = null;

  process(data: RequestData): ResponseData {
    const start = Date.now();
    if (data.initialize) {
      this.costName = data.initialize.costName;

      this.dataSetDir = data.initialize.dataSetDir;
      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        initialize: {
          status: "OK",
        },
      };
    } else if (data.evaluate) {
      if (!this.dataSetDir) throw "no data directory";
      if (!this.costName) throw "no cost";

      const network = Network.fromJSON(data.evaluate.network);
      const util = new NetworkUtil(network);

      const cost = findCost(this.costName);
      const result = util.testDir(this.dataSetDir, cost);

      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        evaluate: {
          error: result.error,
        },
      };
    } else if (data.train) {
      const network = Network.fromJSON(data.train.network);
      const util = new NetworkUtil(network);

      if (!this.dataSetDir) throw "No data dir";

      if (!this.costName) throw "no cost";

      const trainOptions: TrainOptions = {
        cost: this.costName,
        // log: 100,
        iterations: 1, // Math.max(1, Math.round(10 * Math.random())),
        momentum: Math.random() * Math.random(),
        rate: data.train.rate,
        batchSize: Infinity,
        //  clear: Math.random() < 0.5 ? true : false,
      };

      const result = util.trainDir(this.dataSetDir, trainOptions);
      const json = JSON.stringify(network.toJSON());

      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        train: {
          network: json,
          error: result.error,
        },
      };
    } else {
      console.error(data);
      throw "unknown message";
    }
  }
}
