import { assert } from "@std/assert";
import { creatureValidate } from "../../architecture/CreatureValidate.ts";
import { recordDirectory } from "../../architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";
import type {
  DiscoverResult,
} from "../../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { trainDir } from "../../architecture/Training.ts";
import { Costs } from "../../Costs.ts";
import type { CostInterface } from "../../costs/CostInterface.ts";
import { Creature } from "../../Creature.ts";
import { writeDiagnostics } from "../../utils/Diagnostics.ts";
import {
  initWasmActivationSync,
  isWasmActivationAvailable,
} from "../../wasm/mod.ts";
import type { RequestData, ResponseData } from "./WorkerHandler.ts";

type DiscoverResponsePayload = NonNullable<ResponseData["discover"]>;

/**
 * Converts a `DiscoverResult` into the wire-safe payload returned to the parent
 * thread.
 *
 * Note (6-Jan-2026): This mapping must include all candidate groups we want the
 * parent `DiscoveryRunner` to evaluate and record in caches.
 */
export function buildDiscoverResponsePayload(
  result: DiscoverResult,
): DiscoverResponsePayload {
  return {
    ID: result.ID,
    addHelpfulSynapses: result.addHelpfulSynapses
      ? [...result.addHelpfulSynapses]
      : undefined,
    addHelpfulNeurons: result.addHelpfulNeurons
      ? [...result.addHelpfulNeurons]
      : undefined,
    coordinatedStructuralCandidates: result.coordinatedStructuralCandidates
      ? [...result.coordinatedStructuralCandidates]
      : undefined,
    removeHarmfulSynapse: result.removeHarmfulSynapse,
    removeHarmfulNeurons: result.removeHarmfulNeurons
      ? [...result.removeHarmfulNeurons]
      : undefined,
    removalCandidates: result.removalCandidates
      ? [...result.removalCandidates]
      : undefined,
    candidateSquashes: result.candidateSquashes
      ? [...result.candidateSquashes]
      : undefined,
  };
}

/**
 * Clears large result arrays after building the worker response payload.
 *
 * Note (6-Jan-2026): We aggressively drop these references to help V8 GC in
 * long-running discovery workers.
 */
export function clearDiscoverResultForGC(result: DiscoverResult): void {
  if (result.addHelpfulSynapses) {
    // @ts-ignore - clearing to help GC
    result.addHelpfulSynapses = null;
  }
  if (result.addHelpfulNeurons) {
    // @ts-ignore - clearing to help GC
    result.addHelpfulNeurons = null;
  }
  if (result.coordinatedStructuralCandidates) {
    // @ts-ignore - clearing to help GC
    result.coordinatedStructuralCandidates = null;
  }
  if (result.removeHarmfulNeurons) {
    // @ts-ignore - clearing to help GC
    result.removeHarmfulNeurons = null;
  }
  if (result.removalCandidates) {
    // @ts-ignore - clearing to help GC
    result.removalCandidates = null;
  }
  if (result.candidateSquashes) {
    // @ts-ignore - clearing to help GC
    result.candidateSquashes = null;
  }
}

export class WorkerProcessor {
  private dataSetDir: string | null = null;

  private cost?: CostInterface;

  private wasmInitAttempted = false;

  private async initialiseWasmActivationFromPayload(
    payload: NonNullable<RequestData["initialize"]>["wasmActivation"],
  ): Promise<void> {
    if (!payload) return;
    if (this.wasmInitAttempted) return;
    this.wasmInitAttempted = true;

    // If already initialised, nothing to do.
    if (isWasmActivationAvailable()) return;

    // Import wasm-bindgen glue from the provided source to avoid file reads.
    const jsModuleUrl = `data:application/javascript;charset=utf-8,${
      encodeURIComponent(payload.jsSource)
    }`;
    const jsBindings = await import(jsModuleUrl);

    const ok = initWasmActivationSync(jsBindings, payload.wasmBinary);
    if (ok) return;

    // Defensive: if an async auto-init is in flight (e.g. env-driven module-load init),
    // the sync init intentionally fails fast to avoid re-entrancy into wasm-bindgen.
    // In that case, wait briefly for the in-flight init to finish before failing.
    const deadlineMs = Date.now() + 30_000;
    while (Date.now() < deadlineMs) {
      if (isWasmActivationAvailable()) return;
      // deno-lint-ignore no-await-in-loop -- deliberate polling backoff
      await new Promise((r) => setTimeout(r, 50));
    }

    if (isWasmActivationAvailable()) return;
    throw new Error("Worker WASM activation init failed");
  }

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
      // Dynamic import of user-provided custom cost function file.
      // JSR Warning: This dynamic import is intentional and loads external user files at runtime.
      // The import path cannot be analysed at publish time as it's provided by the user.
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
      if (data.initialize.discoveryVerbose) {
        try {
          Deno.env.set("NEAT_AI_DISCOVERY_VERBOSE", "1");
        } catch {
          // Best-effort: worker may not have --allow-env.
        }
      }
      // Handle custom cost function if provided
      if (data.initialize.customCostData) {
        const customCostInfo = JSON.parse(data.initialize.customCostData);
        this.cost = await this.loadCustomCostFromFile(customCostInfo.filePath);
      } else {
        this.cost = Costs.find(data.initialize.costName);
      }

      // Explicit worker startup init (production parity):
      // initialise WASM activation once per worker, using payload supplied by
      // the parent, so worker-side training/evaluation uses WASM.
      await this.initialiseWasmActivationFromPayload(
        data.initialize.wasmActivation,
      );

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

      let creature: Creature | null = null;
      try {
        creature = Creature.fromJSON(JSON.parse(data.evaluate.creature));
        /* release some memory*/
        data.evaluate.creature = "";
        const result = await creature.evaluateDir(
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
      } catch (error) {
        console.error(error);
        writeDiagnostics({
          error,
          prefix: "evaluate",
          creature: data.evaluate.creature,
          context: { taskID: data.taskID, data },
        });
        throw error;
      } finally {
        // Ensure creature is disposed even if an error occurs
        if (creature) {
          creature.dispose();
        }
      }
    } else if (data.train) {
      let creature: Creature | null = null;
      try {
        creature = Creature.fromJSON(
          JSON.parse(data.train.creature),
          data.debug,
        );
        /* release some memory*/
        data.train.creature = "";

        assert(this.dataSetDir, "No data dir");
        assert(this.cost, "No cost");

        creatureValidate(creature);
        const result = trainDir(
          creature,
          this.dataSetDir,
          data.train.options,
          this.cost,
        );
        creatureValidate(creature);
        const json = JSON.stringify(creature.exportJSON());

        const response = {
          taskID: data.taskID,
          duration: Date.now() - start,
          train: {
            ID: result.ID,
            creature: json,
            error: result.error,
            trace: JSON.stringify(result.trace),
            compact: result.compact
              ? JSON.stringify(result.compact)
              : undefined,
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
      } finally {
        // Ensure creature is disposed even if an error occurs
        if (creature) {
          creature.dispose();
        }
      }
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
      let creature: Creature | null = null;
      try {
        creature = Creature.fromJSON(
          JSON.parse(data.discover.creature),
          data.debug,
        );

        assert(this.dataSetDir, "No data dir");

        creatureValidate(creature);

        if (data.discover.config.log) {
          console.log(
            `[Worker] Starting discovery for creature (taskID: ${data.taskID})...`,
          );
        }

        const result = await recordDirectory(
          creature,
          this.dataSetDir,
          data.discover.config,
        );

        if (data.discover.config.log) {
          console.log(
            `[Worker] Discovery complete for creature (taskID: ${data.taskID}), preparing response...`,
          );
        }

        const response = {
          taskID: data.taskID,
          duration: Date.now() - start,
          discover: buildDiscoverResponsePayload(result),
        };

        clearDiscoverResultForGC(result);

        if (data.discover!.config.log) {
          console.log(
            `[Worker] Returning discovery response (taskID: ${data.taskID})...`,
          );
        }

        return response;
      } finally {
        // Ensure creature is disposed even if an error occurs
        if (creature) {
          creature.dispose();
        }
      }
    } else if (data.breed) {
      // Issue #1026: Parallelise breeding loop using worker pool
      let mother: Creature | null = null;
      let father: Creature | null = null;
      let offspring: Creature | undefined = undefined;

      try {
        mother = Creature.fromJSON(JSON.parse(data.breed.mother), data.debug);
        father = Creature.fromJSON(JSON.parse(data.breed.father), data.debug);

        // Release memory from request data
        data.breed.mother = "";
        data.breed.father = "";

        // Import Offspring dynamically to avoid circular dependencies
        const { Offspring } = await import(
          "../../architecture/Offspring.ts"
        );

        offspring = Offspring.breed(mother, father, {
          geneticCompatibilityThreshold:
            data.breed.geneticCompatibilityThreshold,
          forwardOnly: data.breed.forwardOnly,
        });

        if (offspring) {
          const offspringJson = JSON.stringify(offspring.exportJSON());
          return {
            taskID: data.taskID,
            duration: Date.now() - start,
            breed: {
              offspring: offspringJson,
              success: true,
            },
          };
        } else {
          return {
            taskID: data.taskID,
            duration: Date.now() - start,
            breed: {
              success: false,
            },
          };
        }
      } finally {
        // Ensure creatures are disposed even if an error occurs
        if (mother) mother.dispose();
        if (father) father.dispose();
        if (offspring) offspring.dispose();
      }
    } else {
      throw new Error("unknown message");
    }
  }
}
