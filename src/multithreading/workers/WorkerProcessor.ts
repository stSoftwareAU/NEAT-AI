import type { RequestData, ResponseData } from "./WorkerHandler.ts";

import { type CostInterface, Costs } from "../../Costs.ts";
import { Creature } from "../../Creature.ts";
import { trainDir } from "../../architecture/Training.ts";
import { assert } from "@std/assert";
import { creatureValidate } from "../../architecture/CreatureValidate.ts";

export class WorkerProcessor {
  private dataSetDir: string | null = null;

  private cost?: CostInterface;

  async process(data: RequestData): Promise<ResponseData> {
    const start = Date.now();
    if (data.initialize) {
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
      assert(this.dataSetDir, "No data dir");
      assert(this.cost, "No cost");

      const creature = Creature.fromJSON(JSON.parse(data.evaluate.creature));
      /* release some memory*/
      data.evaluate.creature = "";
      const result = creature.evaluateDir(
        this.dataSetDir,
        this.cost,
        data.evaluate.feedbackLoop,
      );

      creature.dispose();

      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        evaluate: {
          error: result.error,
        },
      };
    } else if (data.train) {
      const creature = Creature.fromJSON(
        JSON.parse(data.train.creature),
        data.debug,
      );
      /* release some memory*/
      data.train.creature = "";

      assert(this.dataSetDir, "No data dir");

      creatureValidate(creature);
      const result = trainDir(
        creature,
        this.dataSetDir,
        data.train.options,
      );
      creatureValidate(creature);
      const json = JSON.stringify(creature.exportJSON());

      creature.dispose();

      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        train: {
          ID: result.ID,
          creature: json,
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
      throw new Error("unknown message");
    }
  }
}
