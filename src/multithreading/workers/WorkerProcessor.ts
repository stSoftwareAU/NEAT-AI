/**
 * @module
 *
 * The worker's half of the worker protocol. {@link WorkerProcessor} receives
 * the `RequestData` messages sent by `WorkerHandler.ts` on the main thread,
 * runs the actual work inside the worker — dataset load, scoring, training,
 * discovery — and returns the matching `ResponseData`.
 *
 * Reach for this module when adding a new kind of worker job: the handler
 * defines the request, this defines what happens to it. It also owns the
 * worker-local state that makes repeat jobs cheap (resolved cost function,
 * dataset file-list cache, one-time WASM initialisation).
 *
 * Discovery results can be very large, so payloads are trimmed to what the main
 * thread actually reads and the source structures are released for collection
 * before the response is posted.
 */
import { assert } from "@std/assert";
import { dirname, join } from "@std/path";
import { recordDirectory } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";
import { toErrorMessage } from "@utils/ErrorSerialisation.ts";
import type {
  DiscoverResult,
  RemovalCandidate,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { trainDir } from "@architecture/Training.ts";
import { BreedingSubPhaseAccumulator } from "@breed/BreedingSubPhaseAccumulator.ts";
import { Costs } from "@costs";
import type { CostInterface } from "@costs/CostInterface.ts";
import type { RequiredOutputRange } from "@config/OutputRangeConfig.ts";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
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
import { assertLocalModuleSpecifier } from "@utils/ModuleSpecifierGuard.ts";
import { DatasetFileListCache } from "@architecture/DatasetFileListCache.ts";

type DiscoverResponsePayload = NonNullable<ResponseData["discover"]>;

/**
 * Max removal candidates copied onto the worker→main wire payload (Issue #3774).
 *
 * CandidateFiltering only samples a small lowest-impact pool; transferring
 * thousands of removals (GRQ-25: 1,544) OOMed the isolate after analysis had
 * already finished. Keep the lowest-impact slice; the full set lives on disk
 * via {@link persistDiscoverResultCheckpoint}.
 */
export const DISCOVERY_WIRE_REMOVAL_CANDIDATE_CAP = 128;

/**
 * Select the lowest-impact removal candidates for the wire payload.
 *
 * Returns a fresh array (never the input reference) so the worker can drop the
 * source for GC after building the response.
 */
export function selectRemovalCandidatesForWire(
  candidates: readonly RemovalCandidate[],
  cap: number = DISCOVERY_WIRE_REMOVAL_CANDIDATE_CAP,
): { selected: RemovalCandidate[]; total: number } {
  const total = candidates.length;
  if (total === 0) {
    return { selected: [], total: 0 };
  }
  if (total <= cap) {
    return { selected: [...candidates], total };
  }
  const ranked = [...candidates].sort((a, b) => a.impact - b.impact);
  return { selected: ranked.slice(0, cap), total };
}

/**
 * Persist the full discover result before crossing the worker boundary
 * (Issue #3774 / GRQ #4066).
 *
 * An OOM while serialising the return payload then loses the message, not
 * hours of completed analysis — the checkpoint can be recovered from disk.
 */
export async function persistDiscoverResultCheckpoint(
  result: DiscoverResult,
  checkpointPath: string,
): Promise<void> {
  await Deno.mkdir(dirname(checkpointPath), { recursive: true });
  await Deno.writeTextFile(checkpointPath, JSON.stringify(result));
}

/** Resolve the on-disk checkpoint path for a discovery session.
 *
 * `discoveryId` must be the **run directory name** — the full creature UUID
 * used by `DiscoverStructureBase.tempDir` (Issue #3790). A shortened
 * `uuid.slice(-8)` here mkdir's a second top-level directory under the
 * discovery base and fails GRQ's "exactly one run directory" snapshot.
 */
export function discoverResultCheckpointPath(
  discoveryId: string,
  baseDirectory?: string,
): string {
  const base = baseDirectory && baseDirectory.length > 0
    ? baseDirectory
    : ".discovery";
  return join(base, discoveryId, "worker-result-checkpoint.json");
}

export type BuildDiscoverResponseOptions = {
  /** Absolute or repo-relative path written by {@link persistDiscoverResultCheckpoint}. */
  resultCheckpointPath?: string;
  /** Override the wire removal-candidate cap (tests). */
  removalCandidateCap?: number;
};

/**
 * Converts a `DiscoverResult` into the wire-safe payload returned to the parent
 * thread.
 *
 * Note (6-Jan-2026): This mapping must include all candidate groups we want the
 * parent `DiscoveryRunner` to evaluate and record in caches.
 *
 * Issue #3774: `removalCandidates` are capped to
 * {@link DISCOVERY_WIRE_REMOVAL_CANDIDATE_CAP} (lowest impact first). When
 * truncated, `removalCandidatesTotal` carries the pre-cap count and
 * `resultCheckpointPath` points at the full on-disk checkpoint.
 */
export function buildDiscoverResponsePayload(
  result: DiscoverResult,
  options: BuildDiscoverResponseOptions = {},
): DiscoverResponsePayload {
  const removal = result.removalCandidates
    ? selectRemovalCandidatesForWire(
      result.removalCandidates,
      options.removalCandidateCap ?? DISCOVERY_WIRE_REMOVAL_CANDIDATE_CAP,
    )
    : undefined;

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
    removalCandidates: removal && removal.selected.length > 0
      ? removal.selected
      : undefined,
    removalCandidatesTotal: removal && removal.total > removal.selected.length
      ? removal.total
      : undefined,
    candidateSquashes: result.candidateSquashes
      ? [...result.candidateSquashes]
      : undefined,
    resultCheckpointPath: options.resultCheckpointPath,
    // Issue #2737: Propagate the structured heap-abort signal across the
    // worker boundary so the parent thread can surface it via the
    // `discovery_complete` event.
    heapAbortedAtExtensionBoundary: result.heapAbortedAtExtensionBoundary,
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
    // Issue #3685: only local specifiers may be imported, so a config value
    // that ever came from a remote manifest cannot execute remote code here.
    // Deliberately outside the try/catch below so the typed ValidationError
    // reaches the caller instead of being flattened into a load failure.
    assertLocalModuleSpecifier(filePath, "custom cost function");

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
        // Do not dump to `.diagnostics/` here. Evaluate failures are operational
        // (empty dataset, WASM trap, corrupt creature) and fire on every worker
        // retry. Writing the creature plus the full request payload on each miss
        // filled `.diagnostics/` with hundreds of thousands of `evaluate-*`
        // files. The error is still logged and rethrown for the caller.
        getLogger().error(error);
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

        // Issue #3774: checkpoint the full result before the worker→main
        // transfer so an OOM while building/returning the payload does not
        // discard hours of completed analysis.
        // Issue #3790: the path must use the full creature UUID (the same
        // run directory DiscoverStructureBase already created). result.ID
        // used to be uuid.slice(-8), which mkdir'd a second top-level dir
        // and failed GRQ's "exactly one run directory" snapshot.
        const checkpointPath = discoverResultCheckpointPath(
          CreatureUtil.makeUUID(creature),
          data.discover.config.discoveryBaseDirectory,
        );
        await persistDiscoverResultCheckpoint(result, checkpointPath);

        const removalTotal = result.removalCandidates?.length ?? 0;
        const response = {
          taskID: data.taskID,
          duration: Date.now() - start,
          discover: buildDiscoverResponsePayload(result, {
            resultCheckpointPath: checkpointPath,
          }),
        };

        clearDiscoverResultForGC(result);

        if (data.discover!.config.log) {
          const wireRemovals = response.discover.removalCandidates?.length ?? 0;
          getLogger().info(
            `[Worker] Returning discovery response (taskID: ${data.taskID}` +
              `, removalCandidates=${wireRemovals}` +
              (removalTotal > wireRemovals
                ? ` of ${removalTotal} (capped, checkpoint=${checkpointPath})`
                : "") +
              ")...",
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
