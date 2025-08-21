import { assert } from "@std/assert";
import { creatureValidate } from "../../architecture/CreatureValidate.ts";
import { recordDirectory } from "../../architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";
import { trainDir } from "../../architecture/Training.ts";
import { Costs } from "../../Costs.ts";
import type { CostInterface } from "../../costs/CostInterface.ts";
import { Creature } from "../../Creature.ts";
import type { RequestData, ResponseData } from "./WorkerHandler.ts";

export class WorkerProcessor {
  private dataSetDir: string | null = null;

  private cost?: CostInterface;

  /**
   * Loads a custom cost function from a file path using dynamic import.
   * This allows external programs to provide custom cost functions without
   * needing to register constructors in advance.
   *
   * @param filePath - Path to the file containing the custom cost function
   * @returns Promise resolving to the cost function instance
   */
  private async loadCustomCostFromFile(
    filePath: string,
  ): Promise<CostInterface> {
    try {
      // Dynamic import of the custom cost function file
      const module = await import(filePath);

      // Try to get the default export first, then look for named exports
      const CostClass = module.default || module.CustomCost ||
        Object.values(module)[0];

      if (!CostClass) {
        throw new Error(`No cost function class found in ${filePath}`);
      }

      // Validate that CostClass is a constructor function
      if (typeof CostClass !== "function") {
        throw new Error(
          `Exported value in ${filePath} is not a constructor function. Expected a class or function, got ${typeof CostClass}`,
        );
      }

      // Create an instance of the cost function
      return new CostClass();
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      throw new Error(
        `Failed to load custom cost function from ${filePath}: ${errorMessage}`,
      );
    }
  }

  async process(data: RequestData): Promise<ResponseData> {
    const start = Date.now();
    if (data.initialize) {
      // Handle custom cost function if provided
      if (data.initialize.customCostData) {
        const customCostInfo = JSON.parse(data.initialize.customCostData);

        // Load custom cost function from file
        this.cost = await this.loadCustomCostFromFile(customCostInfo.filePath);
      } else {
        this.cost = Costs.find(data.initialize.costName);
      }

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

      try {
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
      } catch (error) {
        console.error(error);
        Deno.mkdirSync(".diagnostics", { recursive: true });
        Deno.writeTextFileSync(
          `.diagnostics/error.json`,
          JSON.stringify(error, null, 2),
        );
        Deno.writeTextFileSync(
          `.diagnostics/creature.txt`,
          data.evaluate.creature,
        );
        Deno.writeTextFileSync(
          `.diagnostics/data.json`,
          JSON.stringify(data, null, 2),
        );
        throw error;
      }
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

      const response = {
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

      // Immediately clear large objects to help GC
      if (result.trace) {
        // @ts-ignore - clearing to help GC
        result.trace = null;
      }
      if (result.compact) {
        // @ts-ignore - clearing to help GC
        result.compact = null;
      }

      return response;
    } else if (data.echo) {
      await new Promise((f) => setTimeout(f, data.echo?.ms));
      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        echo: {
          message: data.echo.message,
        },
      };
    } else if (data.discover) {
      const creature = Creature.fromJSON(
        JSON.parse(data.discover.creature),
        data.debug,
      );

      assert(this.dataSetDir, "No data dir");

      creatureValidate(creature);
      const result = await recordDirectory(
        creature,
        this.dataSetDir,
        data.discover.options,
      );
      creature.dispose();

      const response = {
        taskID: data.taskID,
        duration: Date.now() - start,
        discover: {
          ID: result.ID,
          addHelpfulSynapses: result.addHelpfulSynapses
            ? [...result.addHelpfulSynapses]
            : undefined,
          removeHarmfulSynapse: result.removeHarmfulSynapse,
          candidateSquashes: result.candidateSquashes
            ? [...result.candidateSquashes]
            : undefined,
        },
      };

      // Immediately clear large objects to help GC
      if (result.addHelpfulSynapses) {
        // @ts-ignore - clearing to help GC
        result.addHelpfulSynapses = null;
      }
      if (result.candidateSquashes) {
        // @ts-ignore - clearing to help GC
        result.candidateSquashes = null;
      }

      return response;
    } else {
      throw new Error("unknown message");
    }
  }
}
