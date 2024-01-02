import { RequestData, ResponseData } from "./WorkerHandler.ts";

import { TrainOptions } from "../../config/TrainOptions.ts";
import { CostInterface, Costs } from "../../Costs.ts";
import { Network } from "../../architecture/Network.ts";

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

      const network = Network.fromJSON(JSON.parse(data.evaluate.network));
      /* release some memory*/
      data.evaluate.network = "";
      const result = network.evaluateDir(
        this.dataSetDir,
        this.cost,
        data.evaluate.feedbackLoop,
      );

      network.dispose();

      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        evaluate: {
          error: result.error,
        },
      };
    } else if (data.train) {
      const network = Network.fromJSON(
        JSON.parse(data.train.network),
        data.debug,
      );
      /* release some memory*/
      data.train.network = "";

      if (!this.dataSetDir) throw "No data dir";

      if (!this.cost) throw "no cost";

      const trainOptions: TrainOptions = {
        cost: this.costName,
        iterations: 1,
        log: 1,
      };

      const result = network.trainDir(this.dataSetDir, trainOptions);
      network.validate();
      const json = JSON.stringify(network.internalJSON());

      network.dispose();

      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        train: {
          network: json,
          error: result.error,
          trace: JSON.stringify(result.trace),
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
