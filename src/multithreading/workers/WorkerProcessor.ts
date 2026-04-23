import { assert } from "@std/assert";
import { recordDirectory } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";
import { toErrorMessage } from "@utils/ErrorSerialisation.ts";
import type {
  DiscoverResult,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { trainDir } from "@architecture/Training.ts";
import { BreedingSubPhaseAccumulator } from "@breed/BreedingSubPhaseAccumulator.ts";
import { Costs } from "@costs";
import type { CostInterface } from "@costs/CostInterface.ts";
import type { RequiredOutputRange } from "@config/OutputRangeConfig.ts";
import { Creature } from "@creature";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { writeDiagnostics } from "@utils/Diagnostics.ts";
import {
  getCachedWasmActivationCount,
  getMaxCachedWasmCreatureActivations,
  getWasmCompilationCacheMaxSize,
  getWasmCompilationCacheStats,
  setMaxCachedWasmCreatureActivations,
  setWasmCompilationCacheSize,
} from "@wasm/mod.ts";
import { initialiseWasmActivationFromPayload } from "@workers/WasmWorkerInit.ts";
import type {
  RequestData,
  ResponseData,
} from "@multithreading/workers/WorkerHandler.ts";
import { getLogger } from "@utils/Logger.ts";
import { clearForGc } from "@utils/ReleasableRef.ts";
import { DatasetFileListCache } from "@architecture/DatasetFileListCache.ts";

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
  if (result.addHelpfulSynapses) clearForGc(result, "addHelpfulSynapses");
  if (result.addHelpfulNeurons) clearForGc(result, "addHelpfulNeurons");
  if (result.coordinatedStructuralCandidates) {
    clearForGc(result, "coordinatedStructuralCandidates");
  }
  if (result.removeHarmfulNeurons) clearForGc(result, "removeHarmfulNeurons");
  if (result.removalCandidates) clearForGc(result, "removalCandidates");
  if (result.candidateSquashes) clearForGc(result, "candidateSquashes");
}

export class WorkerProcessor {
  private dataSetDir: string | null = null;

  private cost?: CostInterface;

  /** Issue #1620: Per-output range constraints for fitness penalty. */
  private outputRanges?: ReadonlyArray<RequiredOutputRange>;

  private wasmInitAttempted = false;

  /** Issue #2260: Cache dataset file list across evaluate calls. */
  private readonly datasetFileCache = new DatasetFileListCache();

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
      const errorMessage = toErrorMessage(error);
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

      // Issue #1600: Use shared WASM init utility.
      if (!this.wasmInitAttempted) {
        this.wasmInitAttempted = true;
        await initialiseWasmActivationFromPayload(
          data.initialize.wasmActivation,
          true,
        );
      }

      // Issue #1567: Apply WASM cache configuration from main thread.
      if (data.initialize.wasmCache) {
        const wc = data.initialize.wasmCache;
        if (wc.maxCachedActivations !== undefined) {
          setMaxCachedWasmCreatureActivations(wc.maxCachedActivations);
        }
        if (wc.compilationCacheSize !== undefined) {
          setWasmCompilationCacheSize(wc.compilationCacheSize);
        }
      }

      this.dataSetDir = data.initialize.dataSetDir;

      // Issue #1620: Store output range constraints for evaluation penalty.
      if (data.initialize.outputRanges) {
        this.outputRanges = data.initialize.outputRanges;
      }

      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        initialize: {
          status: "OK",
        },
      };
    } else if (data.configureCache) {
      // Issue #1567: Dynamically update WASM cache caps.
      if (data.configureCache.maxCachedActivations !== undefined) {
        setMaxCachedWasmCreatureActivations(
          data.configureCache.maxCachedActivations,
        );
      }
      if (data.configureCache.compilationCacheSize !== undefined) {
        setWasmCompilationCacheSize(
          data.configureCache.compilationCacheSize,
        );
      }
      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        configureCache: {
          status: "OK",
        },
      };
    } else if (data.requestCacheStats) {
      // Issue #1567: Report cache statistics to the main thread.
      const compilationStats = getWasmCompilationCacheStats();
      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        cacheStats: {
          activationCacheCount: getCachedWasmActivationCount(),
          activationCacheMax: getMaxCachedWasmCreatureActivations(),
          compilationCacheSize: compilationStats.size,
          compilationCacheMax: getWasmCompilationCacheMaxSize(),
        },
      };
    } else if (data.evaluate) {
      assert(this.dataSetDir, "No data dir");
      assert(this.cost, "No cost");

      let creature: Creature | null = null;
      try {
        creature = Creature.fromJSON(data.evaluate.creature);
        clearForGc(data.evaluate, "creature");
        // Issue #2260: Use cached file list to avoid repeated directory scans.
        const cachedFiles = this.datasetFileCache.getFiles(this.dataSetDir);
        const result = await creature.evaluateDir(
          this.dataSetDir,
          this.cost,
          data.evaluate.feedbackLoop,
          this.outputRanges,
          cachedFiles,
        );

        return {
          taskID: data.taskID,
          duration: Date.now() - start,
          evaluate: {
            error: result.error,
          },
        };
      } catch (error) {
        getLogger().error(error);
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
          data.train.creature,
          data.debug,
        );
        clearForGc(data.train, "creature");

        assert(this.dataSetDir, "No data dir");
        assert(this.cost, "No cost");

        const result = trainDir(
          creature,
          this.dataSetDir,
          data.train.options,
          this.cost,
        );

        const response = {
          taskID: data.taskID,
          duration: Date.now() - start,
          train: {
            ID: result.ID,
            creature: exportJSONWithRuntimeIds(creature),
            error: result.error,
            trace: result.trace,
            compact: result.compact,
          },
        };

        // Immediately clear large objects to help GC
        if (result.trace) clearForGc(result, "trace");
        if (result.compact) clearForGc(result, "compact");

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
          data.discover.creature,
          data.debug,
        );

        assert(this.dataSetDir, "No data dir");

        if (data.discover.config.log) {
          getLogger().info(
            `[Worker] Starting discovery for creature (taskID: ${data.taskID})...`,
          );
        }

        const result = await recordDirectory(
          creature,
          this.dataSetDir,
          data.discover.config,
        );

        if (data.discover.config.log) {
          getLogger().info(
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
          getLogger().info(
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
        mother = Creature.fromJSON(data.breed.mother, data.debug);
        father = Creature.fromJSON(data.breed.father, data.debug);

        // Release memory from request data
        clearForGc(data.breed, "mother");
        clearForGc(data.breed, "father");

        // Import Offspring dynamically to avoid circular dependencies
        const { Offspring } = await import(
          "../../architecture/Offspring.ts"
        );

        // Issue #2324: Capture sub-phase timing in worker breeding
        const acc = new BreedingSubPhaseAccumulator();

        offspring = Offspring.breed(mother, father, {
          geneticCompatibilityThreshold:
            data.breed.geneticCompatibilityThreshold,
          forwardOnly: data.breed.forwardOnly,
          subPhaseAccumulator: acc,
        });

        if (offspring) {
          return {
            taskID: data.taskID,
            duration: Date.now() - start,
            breed: {
              offspring: offspring.exportJSON(),
              success: true,
              subPhaseTiming: acc.toTiming(),
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
