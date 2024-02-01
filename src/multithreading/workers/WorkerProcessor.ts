import { RequestData, ResponseData } from "./WorkerHandler.ts";

import { CostInterface, Costs } from "../../Costs.ts";
import { Creature } from "../../Creature.ts";
import { trainDir } from "../../architecture/Training.ts";

export class WorkerProcessor {
  private costName?: string;
  private dataSetDir: string | null = null;

  private cost?: CostInterface;

  private workerName: string;

  constructor(workerName?: string) {
    if (workerName) {
      this.workerName = workerName;
    } else {
      this.workerName = "main";
    }
  }

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
      if (!this.dataSetDir) throw new Error("no data directory");
      if (!this.cost) throw new Error("no cost");

      const network = Creature.fromJSON(JSON.parse(data.evaluate.creature));
      /* release some memory*/
      data.evaluate.creature = "";
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
      const network = Creature.fromJSON(
        JSON.parse(data.train.creature),
        data.debug,
      );
      /* release some memory*/
      data.train.creature = "";

      if (!this.dataSetDir) throw new Error("No data dir");

      network.validate();
      const result = await trainDir(
        network,
        this.dataSetDir,
        data.train.options,
      );
      network.validate();
      const json = JSON.stringify(network.exportJSON());

      network.dispose();

      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        train: {
          ID: result.ID,
          network: json,
          error: result.error,
          trace: JSON.stringify(result.trace),
          compact: result.compact ? JSON.stringify(result.compact) : undefined,
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
      throw new Error("unknown message");
    }
  }
}
