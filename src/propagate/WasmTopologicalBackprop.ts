/**
 * Issue #1954 - WASM topological backpropagation serialisation wrapper.
 *
 * Serialises creature state into a binary format for the WASM
 * propagate_topological() function, then deserialises the results
 * back into creature state objects.
 */

import type { Creature } from "@creature";
import type { NeuronActivationInterface } from "@methods/activations/NeuronActivationInterface.ts";
import type { BackPropagationConfig } from "@propagate/BackPropagation.ts";
import type { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { BackpropBuffers } from "@propagate/BackpropBuffers.ts";
import { TopologicalBackpropCache } from "@propagate/TopologicalBackpropCache.ts";
import { wasmPropagateTopological } from "@wasm/WasmStandaloneFunctions.ts";
import { getPropagateTopologicalFn } from "@wasm/WasmModuleLoader.ts";
import { noChangePropagate } from "@architecture/NoChangePropagate.ts";

/**
 * Attempt to run topological backpropagation via WASM.
 *
 * Issue #2416 — the TypeScript fallbacks have been removed; this shim now
 * returns false only when the WASM module is genuinely unavailable. All
 * other cases (batchSize === 1, no-error early-out, in-loop noChange paths)
 * are handled by the canonical Rust implementation in
 * `neat-core/src/topological_backprop.rs` and surfaced through the WASM
 * result buffer.
 */
export function wasmTopologicalBackprop(
  creature: Creature,
  expected: Float32Array,
  config: BackPropagationConfig,
  sparseConfig: SparseConfig,
): boolean {
  // Early bail: avoid side effects if WASM is unavailable.
  if (!getPropagateTopologicalFn()) {
    return false;
  }

  creature.state.cacheAdjustedActivation.clear();

  // Ensure backpropBuffers is initialised for special neuron TS fallback.
  if (creature.state.backpropBuffers === undefined) {
    creature.state.backpropBuffers = new BackpropBuffers();
  }

  const neurons = creature.neurons;
  const neuronCount = neurons.length;
  const synapseCount = creature.synapses.length;
  const state = creature.state;

  // Issue #3479: reuse the topology-invariant cache when the creature's
  // structure (and squash functions) are unchanged. `topologyInvalidationGeneration`
  // is bumped by every structural or squash change (via `invalidateScoreCache`),
  // so a stale cache after a mutation is detected in O(1) and rebuilt — the
  // reverse topo-sort, inward mapping and buffer template are otherwise reused
  // across every training record.
  const generation = creature.topologyInvalidationGeneration;
  let cache = state.backpropTopologyCache;
  if (cache === undefined || cache.generation !== generation) {
    cache = TopologicalBackpropCache.build(creature, generation);
    cache.applySparse(creature, sparseConfig);
    state.backpropTopologyCache = cache;
  } else if (cache.sparseConfig !== sparseConfig) {
    // Sparse selection flags depend on the sparse config, not pure topology.
    cache.applySparse(creature, sparseConfig);
  }

  // Patch the per-sample value-dependent fields straight into the reused
  // buffer, then hand it to WASM.
  cache.writeSample(creature, config, expected);
  const order = cache.order;
  const adjActivations = cache.adjActivations;

  // ---- Call WASM ----
  const result = wasmPropagateTopological(cache.bytes);
  if (result === undefined) {
    return false;
  }

  // ---- Deserialise results ----
  const neuronResultStride = 7;
  const synapseResultStride = 7;

  // Check if any neurons need the custom-propagate handler (IF/MAXIMUM/MINIMUM)
  // and collect any neurons that hit the WASM-side noChange path so that the
  // recursive parent-marking semantics of `noChangePropagate` can be applied
  // afterwards in TS. Issue #2416.
  let needsTsFallback = false;
  const noChangeNeurons: number[] = [];

  for (let i = 0; i < neuronCount; i++) {
    const nbase = i * neuronResultStride;
    const totalErrorDelta = result[nbase];
    const cachedAct = result[nbase + 1];
    const noChange = result[nbase + 2];
    const biasCountDelta = result[nbase + 3];
    const totalBiasDelta = result[nbase + 4];
    const totalAdjBiasDelta = result[nbase + 5];
    const traceAct = result[nbase + 6];

    // Check for special neuron sentinel (POSITIVE INFINITY = custom propagate
    // method handled by handleSpecialNeuronFallback below).
    if (cachedAct === Infinity) {
      needsTsFallback = true;
      continue;
    }

    if (totalErrorDelta > 0) {
      const ns = state.node(i);
      ns.totalErrorAbsolute += totalErrorDelta;
    }

    // NEGATIVE INFINITY signals the in-loop noChange path on the WASM side —
    // the cached activation is intentionally absent for those neurons. Skip
    // the cache write here; the recursive `noChangePropagate` pass below will
    // populate the cache, the noChange flag, the trace, and bias accumulators
    // exactly as the original TS implementation did.
    if (cachedAct === -Infinity) {
      noChangeNeurons.push(i);
      continue;
    }

    if (!isNaN(cachedAct)) {
      state.cacheAdjustedActivation.set(i, cachedAct);
    }

    if (noChange > 0.5) {
      const ns = state.node(i);
      ns.noChange = true;
    }

    if (biasCountDelta > 0) {
      const ns = state.node(i);
      ns.count += biasCountDelta;
      ns.totalBias += totalBiasDelta;
      ns.totalAdjustedBias += totalAdjBiasDelta;
    }

    if (!isNaN(traceAct)) {
      const ns = state.node(i);
      ns.traceActivation(traceAct);
    }
  }

  // Apply `noChangePropagate` for every neuron that WASM flagged with the
  // NEG_INFINITY sentinel. This walks upstream and marks dependent parents as
  // noChange + records their trace activations — semantics that the WASM core
  // intentionally delegates back to TS.
  if (noChangeNeurons.length > 0) {
    for (const neuronIndex of noChangeNeurons) {
      const neuron = neurons[neuronIndex];
      const activation = adjActivations[neuronIndex];
      noChangePropagate(neuron, activation, config);
      state.cacheAdjustedActivation.set(neuronIndex, activation);
    }
  }

  // Apply synapse state updates.
  for (let i = 0; i < synapseCount; i++) {
    const sbase = neuronCount * neuronResultStride + i * synapseResultStride;
    const countDelta = result[sbase];
    if (countDelta > 0) {
      const syn = creature.synapses[i];
      const cs = state.connectionFor(syn); // Issue #3089: cached state lookup
      cs.count += countDelta;
      cs.totalPositiveActivation += result[sbase + 1];
      cs.totalNegativeActivation += result[sbase + 2];
      cs.countPositiveActivations += result[sbase + 3];
      cs.countNegativeActivations += result[sbase + 4];
      cs.totalPositiveAdjustedValue += result[sbase + 5];
      cs.totalNegativeAdjustedValue += result[sbase + 6];
    }
  }

  // If any neurons need TS fallback, handle them with the original TS code.
  if (needsTsFallback) {
    handleSpecialNeuronFallback(
      creature,
      expected,
      config,
      sparseConfig,
      result,
      order,
    );
  }

  return true;
}

/**
 * Handle IF/MAXIMUM/MINIMUM neurons that WASM skipped.
 * These neurons have custom propagate() methods.
 */
function handleSpecialNeuronFallback(
  creature: Creature,
  _expected: Float32Array,
  config: BackPropagationConfig,
  sparseConfig: SparseConfig,
  wasmResult: Float64Array,
  order: number[],
): void {
  const neurons = creature.neurons;
  const neuronResultStride = 7;
  const state = creature.state;

  // Rebuild target delta from WASM result for context.
  // The WASM function already distributed error for standard neurons.
  // For special neurons, we need to process them with their custom logic.

  // Build targetDeltaSum/Count from the WASM pass for the special neurons.
  // The sentinel value (INFINITY in cachedAct) marks neurons needing fallback.
  // The target activation is stored in traceActivation slot.

  for (let orderIdx = 0; orderIdx < order.length; orderIdx++) {
    const neuronIndex = order[orderIdx];
    const nbase = neuronIndex * neuronResultStride;
    const cachedAct = wasmResult[nbase + 1];

    if (cachedAct !== Infinity) continue;

    // This neuron needs TS fallback.
    const neuron = neurons[neuronIndex];
    const targetActivation = wasmResult[nbase + 6]; // stored in traceActivation slot

    const squashMethod = neuron.findSquash();
    const propagateMethod = squashMethod as NeuronActivationInterface;

    if (propagateMethod.propagate === undefined) continue;

    const ns = state.node(neuronIndex);
    const upNeeded = sparseConfig.updateNeeded(neuron.id);
    ns.noChange = upNeeded === false;

    const limitedActivation = propagateMethod.propagate(
      neuron,
      targetActivation,
      config,
      sparseConfig,
    );

    if (upNeeded) {
      ns.traceActivation(limitedActivation);
    }
    state.cacheAdjustedActivation.set(neuronIndex, limitedActivation);
  }
}
