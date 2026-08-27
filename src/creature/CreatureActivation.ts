/**
 * CreatureActivation.ts - Forward pass and WASM activation logic.
 *
 * Extracted from Creature.ts (Issue #1409) to keep the Creature class
 * under 500 lines and each module focused on a single responsibility.
 */

import { calculateOutputRangePenalty } from "@architecture/OutputRangePenalty.ts";
import { dataFiles } from "@architecture/Training.ts";
import {
  assertDatasetFilesIntact,
  assertWholeRecordRead,
  openDatasetFileSync,
} from "@architecture/DatasetIO.ts";
import { DatasetError } from "@errors/DatasetError.ts";
import type { RequiredOutputRange } from "@config/OutputRangeConfig.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import type { CostInterface } from "@costs/CostInterface.ts";
import {
  accumulationCostFor,
  finaliseCostMean,
} from "@costs/CostAggregation.ts";
import type { Creature } from "@creature";
import { WasmError } from "@errors/WasmError.ts";
import { runnerUpProximity } from "@methods/activations/aggregate/RunnerUpProximity.ts";
import type { SparseConfigLike } from "@propagate/sparse/SparseConfigLike.ts";
import { getLogger } from "@utils/Logger.ts";
import {
  clearWasmCompilationCache,
  compileCreatureToWasm,
  type CompiledCreatureData,
  getOrCompileWasmModule,
  isWasmActivationAvailable,
  resolveWasmSquashName,
  WasmCreatureActivation,
} from "@wasm/mod.ts";
import {
  deregisterWasmCreatureActivation,
  evictOldestWasmCreatureActivations,
  noteWasmCreatureActivationUse,
} from "@wasm/WasmCreatureActivationLRU.ts";
import { tryScoreWithRustScorer } from "../score/RustScorerBridge.ts";
import { nativeDatasetScoringEligibility } from "../score/NativeDatasetScoringEligibility.ts";

/**
 * Verify WASM is available and the creature is eligible.
 * Throws if WASM could not be loaded or the creature is not WASM-eligible.
 */
export function requireWasmOrThrow(creature: Creature): void {
  if (!isWasmActivationAvailable()) {
    throw new WasmError(
      "WASM activation could not be loaded. Ensure the NEAT-AI package is installed correctly. " +
        "WASM activation is required.",
      "MODULE_NOT_LOADED",
    );
  }
  if (!isWasmEligible(creature)) {
    const unsupported = getUnsupportedWasmSquashFunctions(creature);
    throw new WasmError(
      "This creature uses squash functions not supported by the current backend: " +
        unsupported.join(", ") +
        ". WASM activation is required.",
      "ACTIVATION_FAILED",
    );
  }
}

/**
 * Check if this creature is eligible for WASM activation.
 * A creature is eligible if all its neurons use WASM-supported squash functions.
 * The result is cached and invalidated when structure changes.
 * Issue #1118: WASM Migration Phase 1.
 */
export function isWasmEligible(creature: Creature): boolean {
  if (creature.wasmEligibilityCache !== undefined) {
    return creature.wasmEligibilityCache;
  }
  const unsupported = getUnsupportedWasmSquashFunctions(creature);
  creature.wasmEligibilityCache = unsupported.length === 0;
  return creature.wasmEligibilityCache;
}

/**
 * Get the list of squash functions used by this creature that are not
 * supported by WASM.
 * Issue #1118: WASM Migration Phase 1.
 */
export function getUnsupportedWasmSquashFunctions(
  creature: Creature,
): string[] {
  const unsupported: string[] = [];
  const seen = new Set<string>();

  for (let i = creature.input; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    const squash = neuron.squash ?? "IDENTITY";
    if (seen.has(squash)) continue;
    seen.add(squash);
    if (resolveWasmSquashName(squash) === undefined) {
      unsupported.push(squash);
    }
  }
  return unsupported;
}

/**
 * Dispose of cached WASM resources.
 * Call this when the creature structure changes or when done using WASM activation.
 * Issue #1118: WASM Migration Phase 1.
 */
export function disposeWasm(creature: Creature): void {
  if (creature.cachedWasmActivation) {
    creature.cachedWasmActivation.free();
    creature.cachedWasmActivation = undefined;
  }
  creature.wasmEligibilityCache = undefined;
  // Issue #1581: Remove the creature from the LRU cache so it no longer
  // counts against the cap after manual disposal.
  deregisterWasmCreatureActivation(creature);
}

/** Prepare non-input neurons for activation. */
function prepareNeurons(creature: Creature): void {
  if (creature.state.preparedNeurons) return;
  for (let i = creature.input, len = creature.neurons.length; i < len; i++) {
    creature.neurons[i].prepare();
  }
  creature.state.preparedNeurons = true;
}

/**
 * Activate the creature using WASM (no tracing).
 * Lazily compiles the creature to WASM on first call.
 * Issue #1301: Uses topology-based caching to avoid redundant compilation.
 */
export function activateWasm(
  creature: Creature,
  input: Float32Array,
  feedbackLoop: boolean,
): Float32Array {
  if (!creature.cachedWasmActivation) {
    creature.cachedWasmActivation = getOrCompileWasmModule(creature) ??
      undefined;

    // Issue #1338: Under memory pressure, evict old cached WASM activations and retry.
    if (!creature.cachedWasmActivation) {
      evictOldestWasmCreatureActivations(64);
      creature.cachedWasmActivation = getOrCompileWasmModule(creature) ??
        undefined;
    }

    // MemoryMonitor may clear the compilation cache under heap pressure while
    // leaving this creature without a cached module — flush compiled modules
    // and retry once (full parallel test runs can hit this path).
    if (!creature.cachedWasmActivation) {
      clearWasmCompilationCache();
      creature.cachedWasmActivation = getOrCompileWasmModule(creature) ??
        undefined;
    }

    if (!creature.cachedWasmActivation) {
      throw new WasmError(
        "WASM activation was selected but failed to instantiate CompiledNetwork",
        "ACTIVATION_FAILED",
      );
    }

    creature.cachedWasmActivation.setNeedsResetWhenStateless(
      !creature.forwardOnlyGuaranteed,
    );
  }

  noteWasmCreatureActivationUse(creature);

  // Issue #2146: Wrap the WASM call so that a RuntimeError (unreachable trap)
  // surfaces as a typed WasmError instead of crashing the worker.
  try {
    return creature.cachedWasmActivation.activateWithState(input, feedbackLoop);
  } catch (error) {
    creature.cachedWasmActivation = undefined;
    if (error instanceof WasmError) throw error;
    throw new WasmError(
      `WASM activation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "ACTIVATION_FAILED",
    );
  }
}

/**
 * Activate the creature without caching the CompiledNetwork instance.
 *
 * Issue #1504: For data-generation workloads that touch thousands of creatures
 * but only activate each one once or twice, caching a CompiledNetwork on every
 * creature wastes WASM heap memory. This function compiles, activates, and
 * immediately frees the WASM instance so it does not contribute to memory
 * pressure.
 *
 * If the creature already has a cached activation it is reused (and kept),
 * so mixing ephemeral and cached calls on the same creature is safe.
 */
export function activateEphemeral(
  creature: Creature,
  input: Float32Array,
  feedbackLoop: boolean,
): Float32Array {
  // If the creature already has a cached WASM activation, reuse it.
  if (creature.cachedWasmActivation) {
    return creature.cachedWasmActivation.activateWithState(
      input,
      feedbackLoop,
    );
  }

  // Compile a one-shot activation that is freed immediately after use.
  const compiled: CompiledCreatureData = compileCreatureToWasm(creature);
  const activation = WasmCreatureActivation.create(compiled);

  if (!activation) {
    // Best-effort eviction and retry.
    evictOldestWasmCreatureActivations(64);
    const retryActivation = WasmCreatureActivation.create(compiled);
    if (!retryActivation) {
      throw new WasmError(
        "WASM ephemeral activation failed to instantiate CompiledNetwork",
        "ACTIVATION_FAILED",
      );
    }
    try {
      retryActivation.setNeedsResetWhenStateless(
        !creature.forwardOnlyGuaranteed,
      );
      return retryActivation.activateWithState(input, feedbackLoop);
    } finally {
      retryActivation.free();
    }
  }

  try {
    activation.setNeedsResetWhenStateless(!creature.forwardOnlyGuaranteed);
    return activation.activateWithState(input, feedbackLoop);
  } finally {
    activation.free();
  }
}

/**
 * Activate the creature using WASM with tracing support for backpropagation.
 * Issue #1121: WASM Migration Phase 4 - activateAndTrace.
 */
export function activateAndTraceWasm(
  creature: Creature,
  input: Float32Array,
  feedbackLoop: boolean,
  sparseConfig: SparseConfigLike,
): Float32Array {
  if (!creature.cachedWasmActivation) {
    creature.cachedWasmActivation = getOrCompileWasmModule(creature) ??
      undefined;

    // Issue #1338: Best-effort eviction + retry under memory pressure.
    if (!creature.cachedWasmActivation) {
      evictOldestWasmCreatureActivations(64);
      creature.cachedWasmActivation = getOrCompileWasmModule(creature) ??
        undefined;
    }

    // Issue #2146: Flush compiled modules and retry once (matches activateWasm).
    if (!creature.cachedWasmActivation) {
      clearWasmCompilationCache();
      creature.cachedWasmActivation = getOrCompileWasmModule(creature) ??
        undefined;
    }

    if (!creature.cachedWasmActivation) {
      throw new WasmError(
        "WASM activateAndTrace was selected but failed to instantiate CompiledNetwork",
        "ACTIVATION_FAILED",
      );
    }
  }

  noteWasmCreatureActivationUse(creature);

  // Issue #2146: Wrap the entire activation path so that any error from
  // preparation, the WASM call itself, or post-processing surfaces as a
  // typed WasmError instead of crashing the worker with an unhandled
  // TypeError or RuntimeError.
  try {
    prepareNeurons(creature);
    creature.state.makeActivation(input, feedbackLoop);

    const wasmResult = creature.cachedWasmActivation
      .activateAndTraceWithFeedback(
        input,
        feedbackLoop,
      );

    const neurons = creature.neurons;
    for (let i = 0; i < wasmResult.activations.length; i++) {
      const neuronIdx = creature.input + i;
      if (neuronIdx < neurons.length) {
        creature.state.activations[neuronIdx] = wasmResult.activations[i];
      }
    }

    applyWasmTraceData(creature, wasmResult.traceEntries, sparseConfig);

    for (let i = creature.input; i < neurons.length; i++) {
      const n = neurons[i];
      if (sparseConfig.propagateNeeded(n.id)) {
        creature.state.node(n.index).hintValue =
          wasmResult.hintValues[i - creature.input];
      }
    }

    return wasmResult.outputs;
  } catch (error) {
    creature.cachedWasmActivation = undefined;
    if (error instanceof WasmError) throw error;
    throw new WasmError(
      `WASM activateAndTrace failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "ACTIVATION_FAILED",
    );
  }
}

/**
 * Apply WASM trace data to synapse states.
 * Issue #1121: WASM Migration Phase 4 - activateAndTrace.
 */
function applyWasmTraceData(
  creature: Creature,
  traceEntries: Array<{ neuronRelativeIndex: number; traceInfo: number }>,
  sparseConfig: SparseConfigLike,
): void {
  const neurons = creature.neurons;

  for (const entry of traceEntries) {
    const neuronIdx = creature.input + entry.neuronRelativeIndex;
    if (neuronIdx >= neurons.length) continue;

    const neuron = neurons[neuronIdx];
    if (!sparseConfig.traceNeeded(neuron.id)) continue;

    const inwardList = creature.inwardConnections(neuronIdx);
    if (inwardList.length === 0) continue;

    const squash = neuron.squash ?? "IDENTITY";

    if (squash === "MINIMUM" || squash === "MAXIMUM") {
      const winningLocalIdx = Math.round(entry.traceInfo);
      for (const c of inwardList) {
        const cs = creature.state.connectionFor(c);
        if (cs.used === undefined) cs.used = false;
      }
      if (winningLocalIdx >= 0 && winningLocalIdx < inwardList.length) {
        const winningConnection = inwardList[winningLocalIdx];
        creature.state.connectionFor(winningConnection)
          .used = true;

        // Issue #3635/#3640: this WASM trace is the production path —
        // Creature.activateAndTrace() never reaches the TypeScript
        // MAXIMUM/MINIMUM activateAndTrace bodies. Apply the same runner-up
        // proximity rule they and propagate use, so applyLearnings never
        // disconnects a connection that still receives leaked gradient.
        // Regression cover: test/creature/WasmTraceRunnerUpProximity.ts.
        if (inwardList.length > 1) {
          const activations = creature.state.activations;
          const winnerValue = activations[winningConnection.from] *
            winningConnection.weight;
          const isMaximum = squash === "MAXIMUM";
          for (const c of inwardList) {
            if (c === winningConnection) continue;
            const value = activations[c.from] * c.weight;
            // Runner-ups sit below the winner for MAXIMUM, above it for MINIMUM
            const distance = isMaximum
              ? winnerValue - value
              : value - winnerValue;
            const proximity = runnerUpProximity(winnerValue, distance);
            if (proximity >= 0) {
              creature.state.connectionFor(c).used = true;
            }
          }
        }
      }
    } else if (squash === "IF") {
      const positiveBranch = entry.traceInfo > 0.5;
      if (positiveBranch) {
        for (const c of inwardList) {
          const cs = creature.state.connectionFor(c);
          switch (c.type) {
            case "condition":
            case "negative":
              if (cs.used === undefined) cs.used = false;
              break;
            default:
              cs.used = true;
          }
        }
      } else {
        for (const c of inwardList) {
          if (c.type === "negative") {
            creature.state.connectionFor(c).used = true;
          }
        }
      }
    }
  }

  // For non-aggregate neurons that need tracing, mark all synapses as used
  for (let i = creature.input; i < neurons.length; i++) {
    const n = neurons[i];
    if (!sparseConfig.traceNeeded(n.id)) continue;

    const squash = n.squash ?? "IDENTITY";
    if (squash === "MINIMUM" || squash === "MAXIMUM" || squash === "IF") {
      continue;
    }

    const inwardList = creature.inwardConnections(i);
    for (const c of inwardList) {
      const cs = creature.state.connectionFor(c);
      cs.used = true;
    }
  }
}

/**
 * Evaluate a dataset directory and return the average error.
 * Supports fused WASM scoring for forward-only creatures.
 *
 * Issue #1229: WASM is required by default with no fallback.
 * Issue #2260: Accepts optional pre-cached file list to avoid repeated
 * directory scans in long-lived workers.
 */
export async function evaluateDir(
  creature: Creature,
  dataDir: string,
  cost: CostInterface,
  feedbackLoop: boolean,
  outputRanges?: ReadonlyArray<RequiredOutputRange>,
  cachedFiles?: string[],
  rustScorer?: RequiredRustScorerConfig,
): Promise<{ error: number }> {
  const files = cachedFiles ?? dataFiles(dataDir).files;
  // Issue #3412: an empty file list means the dataset directory holds no
  // `.bin` files (e.g. deleted mid-run). Fail loud with a DatasetError naming
  // the directory rather than letting the empty corpus surface downstream as a
  // misleading "Error is not finite: Infinity" assertion.
  if (files.length === 0) {
    throw new DatasetError(
      `no .bin training data files found in ${dataDir} (dataset vanished?)`,
      "NO_DATA_FILES",
      dataDir,
    );
  }
  const valuesCount = creature.input + creature.output;
  const BYTES_PER_RECORD = valuesCount * 4;

  // rust_scorer scores the directory, not `cachedFiles`. Fail loud here so a
  // vanished file in the list cannot be dropped because the rest still score.
  //
  // Issue #3831: the same pass checks each file holds a whole number of
  // records. A corrupt dataset is then classified as `CORRUPT_DATA` — naming
  // the file, the trailing byte count and the record size — before the native
  // scorer runs, so `NEAT_AI_RUST_SCORER_STRICT=1` cannot turn it into a
  // `ScorerStrictError` that loses the diagnostic. The record check rides the
  // `stat` this call already made, so it costs no extra syscall.
  assertDatasetFilesIntact(files, {
    bytesPerRecord: BYTES_PER_RECORD,
    inputs: creature.input,
    outputs: creature.output,
  });

  // Issue #1247: Auto-initialise WASM before scoring if not yet available.
  const { ensureWasmActivation } = await import("../wasm/mod.ts");
  await ensureWasmActivation();

  const costName = cost.getName();
  const forwardOnlyGuaranteed = creature.forwardOnlyGuaranteed;

  const effectiveFeedbackLoop = forwardOnlyGuaranteed ? false : feedbackLoop;

  // Issue #3854: one predicate owns the whole delegation decision. Besides the
  // custom-cost gap (Issue #2745) it refuses to hand the request to
  // `rust_scorer` when the native engine cannot reproduce the semantics this
  // call was asked for — configured `outputRanges` (the penalty has no native
  // equivalent) or `feedbackLoop: true` on a recurrent creature (the native
  // recurrent path resets state per record). Delegating either case returned a
  // number computed under different rules, silently.
  const eligibility = nativeDatasetScoringEligibility({
    costName,
    forwardOnlyGuaranteed,
    feedbackLoop,
    outputRangeCount: outputRanges?.length ?? 0,
  });

  if (eligibility.eligible) {
    const rustResult = await tryScoreWithRustScorer(
      creature,
      dataDir,
      rustScorer,
      eligibility.costName,
    );
    if (rustResult) return { error: rustResult.error };
    // `undefined` is a *skip*, never a failure: scoring disabled, no binary,
    // or a binary too old for the configured cost. Issue #3871 removed the
    // failure fallback — a scorer that was there and failed throws — so the
    // accumulator below only ever serves a request the native engine did not
    // take.
  }

  // Issue #3871 (stage 3 of #3861) **demoted** this accumulator; it did not
  // delete it. Decision 2 of #3863 keeps custom costs supported, and a custom
  // cost is a JavaScript module `rust_scorer` cannot execute, so the
  // `CUSTOM_COST` refusal — and therefore this loop — is permanent. The
  // `OUTPUT_RANGES` refusal keeps it alive too until the downstream FX
  // migration lands (decision 3, sequenced). What stage 3 removed is this
  // path's *other* job: standing in for a native scorer that failed.
  requireWasmOrThrow(creature);

  let error = 0;
  let penalty = 0;
  let count = 0;

  // Issue #3853: RMSE is the root of the mean squared error, so it accumulates
  // MSE's squared-error sum and roots once at finalisation. Accumulating the
  // per-record roots instead reported `mean(sqrt(...))` — a different number
  // from the one `rust_scorer` reports for the same creature and dataset.
  const accumulationCost = accumulationCostFor(cost);
  const accumulationCostName = accumulationCost.getName();

  // Ensure WASM network is compiled once for scoring.
  if (!creature.cachedWasmActivation) {
    const compiled = compileCreatureToWasm(creature);
    creature.cachedWasmActivation = WasmCreatureActivation.create(compiled) ??
      undefined;

    // Issue #1338: Best-effort eviction + retry under memory pressure.
    if (!creature.cachedWasmActivation) {
      evictOldestWasmCreatureActivations(64);
      creature.cachedWasmActivation = WasmCreatureActivation.create(compiled) ??
        undefined;
    }
    if (!creature.cachedWasmActivation) {
      throw new WasmError(
        "WASM activation was selected but failed to instantiate CompiledNetwork",
        "ACTIVATION_FAILED",
      );
    }
    creature.cachedWasmActivation.setNeedsResetWhenStateless(
      !forwardOnlyGuaranteed,
    );
  }

  noteWasmCreatureActivationUse(creature);

  const outputBuffer = new Float32Array(creature.output);
  const NVME_OPTIMAL_READ_SIZE = 512 * 1024;
  const BATCH_SIZE = Math.max(
    1,
    Math.floor(NVME_OPTIMAL_READ_SIZE / BYTES_PER_RECORD),
  );
  const BYTES_PER_BATCH = BYTES_PER_RECORD * BATCH_SIZE;

  const batchBuffer = new Uint8Array(BYTES_PER_BATCH);
  const batchArray = new Float32Array(batchBuffer.buffer);

  const supportedFusedCosts = [
    "MSE",
    "MAE",
    "CROSS_ENTROPY",
    "MAPE",
    "MSLE",
    "HINGE",
  ] as const;
  // Issue #1620: Disable fused WASM when output range constraints are active,
  // because the fused path does not expose per-record outputs needed to
  // compute the range penalty.
  const hasOutputRanges = outputRanges !== undefined &&
    outputRanges.length > 0;
  // The fused batch kernels are keyed on the accumulation cost, so RMSE rides
  // MSE's kernel and only differs at finalisation (Issue #3853).
  const useFusedWasm = !hasOutputRanges && forwardOnlyGuaranteed &&
    supportedFusedCosts.includes(
      accumulationCostName as typeof supportedFusedCosts[number],
    );

  for (let fileIndx = files.length; fileIndx--;) {
    const filePath = files[fileIndx];
    // Issue #3412: a vanished `.bin` file fails loud as a DatasetError naming
    // the path rather than a bare NotFound swallowed into an Infinity score.
    const file = openDatasetFileSync(filePath);

    try {
      while (true) {
        const bytesRead = file.readSync(batchBuffer);
        if (bytesRead === null) break;
        // Issue #3541: name the file and the byte counts — the bare
        // `AssertionError: Invalid number of bytes read` named neither.
        assertWholeRecordRead(filePath, bytesRead, BYTES_PER_RECORD, {
          inputs: creature.input,
          outputs: creature.output,
        });

        const recordsRead = Math.floor(bytesRead / BYTES_PER_RECORD);

        if (useFusedWasm) {
          const slice = batchArray.subarray(0, recordsRead * valuesCount);
          const wasm = creature.cachedWasmActivation!;

          // Issue #2214: Wrap fused WASM batch calls in try-catch so that
          // a WASM panic (RuntimeError: unreachable) during scoring returns
          // a fallback error value instead of crashing the worker.
          try {
            switch (accumulationCostName) {
              case "MSE":
                error += wasm.mseSumBatchPacked(slice, creature.input, true);
                break;
              case "MAE":
                error += wasm.maeSumBatchPacked(slice, creature.input, true);
                break;
              case "CROSS_ENTROPY":
                error += wasm.crossEntropySumBatchPacked(
                  slice,
                  creature.input,
                  true,
                );
                break;
              case "MAPE":
                error += wasm.mapeSumBatchPacked(slice, creature.input, true);
                break;
              case "MSLE":
                error += wasm.msleSumBatchPacked(slice, creature.input, true);
                break;
              case "HINGE":
                error += wasm.hingeSumBatchPacked(slice, creature.input, true);
                break;
            }
          } catch (wasmError) {
            getLogger().warn(
              `WASM batch scoring failed for creature ` +
                `${creature.uuid?.substring(0, 8) ?? "unknown"}: ${wasmError}`,
            );
            return { error: Number.MAX_SAFE_INTEGER };
          }
          count += recordsRead;
          continue;
        }

        for (let recordIndex = 0; recordIndex < recordsRead; recordIndex++) {
          const offset = recordIndex * valuesCount;
          const inputEnd = offset + creature.input;
          const observations = batchArray.subarray(offset, inputEnd);
          const target = batchArray.subarray(inputEnd, offset + valuesCount);

          creature.cachedWasmActivation!.activateIntoWithFeedback(
            observations,
            outputBuffer,
            effectiveFeedbackLoop,
          );
          error += accumulationCost.calculate(target, outputBuffer);

          // Issue #1620: Additive penalty for out-of-range outputs. Issue
          // #3853: accumulated separately so it is added in error units after
          // finalisation — folding it into RMSE's squared-error sum would
          // penalise under the root. For mean-style costs the result is
          // unchanged, because mean(cost + penalty) = mean(cost) +
          // mean(penalty).
          if (hasOutputRanges) {
            penalty += calculateOutputRangePenalty(outputBuffer, outputRanges!);
          }

          count++;
        }
      }
    } finally {
      file.close();
    }
  }

  if (count === 0) {
    return { error: 0 };
  } else {
    const averageError = finaliseCostMean(costName, error, count) +
      penalty / count;
    if (Number.isFinite(averageError)) {
      return { error: averageError };
    } else {
      getLogger().warn(
        `AverageError: ${averageError} is not finite, Error: ${error}, Count: ${count}`,
      );
      return { error: Number.MAX_SAFE_INTEGER };
    }
  }
}
