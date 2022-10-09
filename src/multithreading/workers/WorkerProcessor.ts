import { RequestData, ResponseData } from "./WorkerHandler.ts";

import { NetworkUtil } from "../../architecture/NetworkUtil.ts";

import { TrainOptions } from "../../config/TrainOptions.ts";
import { CostInterface, Costs } from "../../Costs.ts";

export class WorkerProcessor {
  private costName?: string;
  private dataSetDir: string | null = null;
  private cost?: CostInterface;
  async process(data: RequestData): Promise<ResponseData> {
    const start = Date.now();
    if (data.initialize) {
      this.costName = data.initialize.costName;
      this.cost = Costs.find(data.initialize.costName);
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
      if (!this.cost) throw "no cost";

      const network = NetworkUtil.fromJSON(JSON.parse(data.evaluate.network));
      const util = new NetworkUtil(network);

      const result = util.testDir(
        this.dataSetDir,
        this.cost,
        data.evaluate.feedbackLoop,
      );

      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        evaluate: {
          error: result.error,
        },
      };
    } else if (data.train) {
      const network = NetworkUtil.fromJSON(
        JSON.parse(data.train.network),
        data.debug,
      );
      const util = new NetworkUtil(network);

      if (!this.dataSetDir) throw "No data dir";

      if (!this.cost) throw "no cost";

      const trainOptions: TrainOptions = {
        cost: this.costName,
        // log: 100,
        iterations: 1, // Math.max(1, Math.round(10 * Math.random())),
        momentum: Math.random() * Math.random(),
        rate: data.train.rate,
        batchSize: Infinity,
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
    } else if (data.echo) {
      await new Promise((f) => setTimeout(f, data.echo?.ms));
      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        echo: {
          message: data.echo.message,
        },
      };
    } else {
      console.error(data);
      throw "unknown message";
    }
  }
}
