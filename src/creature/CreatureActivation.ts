/**
 * CreatureActivation.ts - Forward pass and WASM activation logic.
 *
 * Extracted from Creature.ts (Issue #1409) to keep the Creature class
 * under 500 lines and each module focused on a single responsibility.
 */

import { assert, fail } from "@std/assert";
import type { Creature } from "../Creature.ts";
import type { SparseConfigLike } from "../propagate/sparse/SparseConfigLike.ts";
import {
  compileCreatureToWasm,
  getOrCompileWasmModule,
  isWasmActivationAvailable,
  resolveWasmSquashName,
  WasmCreatureActivation,
} from "../wasm/mod.ts";
import {
  evictOldestWasmCreatureActivations,
  noteWasmCreatureActivationUse,
} from "../wasm/WasmCreatureActivationLRU.ts";
import type { CostInterface } from "../costs/CostInterface.ts";
import { dataFiles } from "../architecture/Training.ts";
import { getLogger } from "../utils/Logger.ts";

/**
 * Verify WASM is available and the creature is eligible.
 * Throws if WASM could not be loaded or the creature is not WASM-eligible.
 */
export function requireWasmOrThrow(creature: Creature): void {
  if (!isWasmActivationAvailable()) {
    throw new Error(
      "WASM activation could not be loaded. Ensure the NEAT-AI package is installed correctly. " +
        "WASM activation is required.",
    );
  }
  if (!isWasmEligible(creature)) {
    const unsupported = getUnsupportedWasmSquashFunctions(creature);
    throw new Error(
      "This creature uses squash functions not supported by the current backend: " +
        unsupported.join(", ") +
        ". WASM activation is required.",
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

    if (!creature.cachedWasmActivation) {
      fail(
        "WASM activation was selected but failed to instantiate CompiledNetwork",
      );
    }

    const major = Number.parseInt(
      creature.semanticVersion.split(".")[0] ?? "0",
      10,
    );
    const forwardOnlyGuaranteed = Number.isFinite(major) && major >= 4 &&
      creature.forwardOnly === true;
    creature.cachedWasmActivation.setNeedsResetWhenStateless(
      !forwardOnlyGuaranteed,
    );
  }

  noteWasmCreatureActivationUse(creature);
  return creature.cachedWasmActivation.activateWithState(input, feedbackLoop);
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

    if (!creature.cachedWasmActivation) {
      fail(
        "WASM activateAndTrace was selected but failed to instantiate CompiledNetwork",
      );
    }
  }

  noteWasmCreatureActivationUse(creature);

  prepareNeurons(creature);
  creature.state.makeActivation(input, feedbackLoop);

  const wasmResult = creature.cachedWasmActivation.activateAndTraceWithFeedback(
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
    if (sparseConfig.propagateNeeded(n.uuid)) {
      creature.state.node(n.index).hintValue =
        wasmResult.hintValues[i - creature.input];
    }
  }

  return wasmResult.outputs;
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
    if (!sparseConfig.traceNeeded(neuron.uuid)) continue;

    const inwardList = creature.inwardConnections(neuronIdx);
    if (inwardList.length === 0) continue;

    const sortedInward = inwardList.slice().sort((a, b) => a.from - b.from);
    const squash = neuron.squash ?? "IDENTITY";

    if (squash === "MINIMUM" || squash === "MAXIMUM") {
      const winningLocalIdx = Math.round(entry.traceInfo);
      for (const c of sortedInward) {
        const cs = creature.state.connection(c.from, c.to);
        if (cs.used === undefined) cs.used = false;
      }
      if (winningLocalIdx >= 0 && winningLocalIdx < sortedInward.length) {
        const winningConnection = sortedInward[winningLocalIdx];
        creature.state.connection(winningConnection.from, winningConnection.to)
          .used = true;
      }
    } else if (squash === "IF") {
      const positiveBranch = entry.traceInfo > 0.5;
      if (positiveBranch) {
        for (const c of sortedInward) {
          const cs = creature.state.connection(c.from, c.to);
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
        for (const c of sortedInward) {
          if (c.type === "negative") {
            creature.state.connection(c.from, c.to).used = true;
          }
        }
      }
    }
  }

  // For non-aggregate neurons that need tracing, mark all synapses as used
  for (let i = creature.input; i < neurons.length; i++) {
    const n = neurons[i];
    if (!sparseConfig.traceNeeded(n.uuid)) continue;

    const squash = n.squash ?? "IDENTITY";
    if (squash === "MINIMUM" || squash === "MAXIMUM" || squash === "IF") {
      continue;
    }

    const inwardList = creature.inwardConnections(i);
    for (const c of inwardList) {
      const cs = creature.state.connection(c.from, c.to);
      cs.used = true;
    }
  }
}

/**
 * Evaluate a dataset directory and return the average error.
 * Supports fused WASM scoring for forward-only creatures.
 *
 * Issue #1229: WASM is required by default with no fallback.
 */
export async function evaluateDir(
  creature: Creature,
  dataDir: string,
  cost: CostInterface,
  feedbackLoop: boolean,
): Promise<{ error: number }> {
  const dataResult = dataFiles(dataDir);
  assert(dataResult.files.length > 0, "No data files found");

  // Issue #1247: Auto-initialise WASM before scoring if not yet available.
  const { ensureWasmActivation } = await import("../wasm/mod.ts");
  await ensureWasmActivation();

  requireWasmOrThrow(creature);

  let error = 0;
  let count = 0;

  const costName = cost.getName();
  const major = Number.parseInt(
    creature.semanticVersion.split(".")[0] ?? "0",
    10,
  );
  const forwardOnlyGuaranteed = Number.isFinite(major) && major >= 4 &&
    creature.forwardOnly === true;

  const effectiveFeedbackLoop = forwardOnlyGuaranteed ? false : feedbackLoop;

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
      fail(
        "WASM activation was selected but failed to instantiate CompiledNetwork",
      );
    }
    creature.cachedWasmActivation.setNeedsResetWhenStateless(
      !forwardOnlyGuaranteed,
    );
  }

  noteWasmCreatureActivationUse(creature);

  const outputBuffer = new Float32Array(creature.output);
  const valuesCount = creature.input + creature.output;
  const BYTES_PER_RECORD = valuesCount * 4;
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
  const useFusedWasm = forwardOnlyGuaranteed &&
    supportedFusedCosts.includes(
      costName as typeof supportedFusedCosts[number],
    );

  for (let fileIndx = dataResult.files.length; fileIndx--;) {
    const filePath = dataResult.files[fileIndx];
    // deno-lint-ignore no-sync-fn-in-async-fn -- Intentional: synchronous I/O for batch processing performance.
    const file = Deno.openSync(filePath, { read: true });

    try {
      while (true) {
        const bytesRead = file.readSync(batchBuffer);
        if (bytesRead === null) break;
        assert(bytesRead > 0, "Invalid number of bytes read");

        const recordsRead = Math.floor(bytesRead / BYTES_PER_RECORD);
        assert(
          bytesRead % BYTES_PER_RECORD === 0,
          "Invalid number of bytes read",
        );

        if (useFusedWasm) {
          const floatsRead = recordsRead * valuesCount;
          const slice = batchArray.subarray(0, floatsRead);
          const wasm = creature.cachedWasmActivation!;

          switch (costName) {
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
          error += cost.calculate(target, outputBuffer);
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
    const averageError = error / count;
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
