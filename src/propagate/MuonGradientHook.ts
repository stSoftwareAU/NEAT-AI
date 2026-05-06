/**
 * Issue #2529 — Muon gradient orthogonalisation hook.
 *
 * Optional post-step that runs after a topological backprop pass and
 * orthogonalises the per-target-neuron incoming-weight gradient deltas,
 * grouped per topological layer.
 *
 * The hook supports two modes of operation:
 *
 * 1. {@link applyMuonGradientOrthogonalisation} — operates on the
 *    `batchAverageWeight` of synapse state. Used after `propagate()`
 *    when the batch is in flight.
 *
 * 2. {@link applyMuonOrthogonalisationToDeltas} — operates on a
 *    pre-captured snapshot of weights vs the post-update weights.
 *    Used inside `propagateUpdate()` where actual weight changes
 *    happen.
 *
 * Both are no-ops when `config.gradientOrthogonalisation === "none"`,
 * preserving the default behaviour exactly.
 *
 * Strategy (shared):
 *   1. Group neurons by topological layer (longest path from inputs).
 *   2. Within each layer, sub-group neurons by incoming-synapse count
 *      so each sub-matrix is rectangular without padding artefacts.
 *   3. For each sub-group with ≥ 2 neurons, build a row-major matrix of
 *      implied weight deltas, capture the row-wise Frobenius norms,
 *      run the standard quintic Newton-Schulz iteration, then rescale
 *      each row back to its original norm so the per-neuron update
 *      magnitude is preserved.
 *   4. Write the rescaled, orthogonalised delta back to its source.
 *
 * Sub-groups with only one neuron, or where no row has a non-zero
 * delta, are skipped — there is nothing to decorrelate.
 */

import type { Creature } from "@creature";
import type { BackPropagationConfig } from "@propagate/BackPropagation.ts";
import { computeLayerAssignments } from "@propagate/LayerAssignment.ts";
import {
  newtonSchulzOrthogonalise,
  type RowMajorMatrix,
} from "@propagate/MuonOrthogonalisation.ts";

/**
 * Apply Muon-style orthogonalised gradient updates to a creature's
 * accumulated per-neuron weight deltas.
 *
 * No-op when `config.gradientOrthogonalisation !== "muon"`.
 */
export function applyMuonGradientOrthogonalisation(
  creature: Creature,
  config: BackPropagationConfig,
): void {
  if (config.gradientOrthogonalisation !== "muon") return;
  if (config.disableWeightAdjustment) return;

  const layers = computeLayerAssignments(creature);
  if (layers.size === 0) return;

  const state = creature.state;

  // Walk each layer (skip layer 0 = inputs/constants — no incoming weights).
  for (const [depth, neuronIndices] of layers) {
    if (depth === 0) continue;
    if (neuronIndices.length < 2) continue;

    // Sub-group neurons by incoming-connection count to get rectangular
    // matrices without padding skew.
    const buckets = new Map<number, number[]>();
    for (const idx of neuronIndices) {
      const inCount = creature.inwardConnections(idx).length;
      if (inCount === 0) continue;
      let bucket = buckets.get(inCount);
      if (bucket === undefined) {
        bucket = [];
        buckets.set(inCount, bucket);
      }
      bucket.push(idx);
    }

    for (const [inCount, indices] of buckets) {
      if (indices.length < 2) continue;

      const rows = indices.length;
      const cols = inCount;
      const data = new Float64Array(rows * cols);
      const rowNorms = new Float64Array(rows);
      // Track which (row, col) positions actually have a finalised
      // batchAverageWeight so we don't write back into untouched state.
      const written = new Uint8Array(rows * cols);

      let anyFinalised = false;
      for (let r = 0; r < rows; r++) {
        const inward = creature.inwardConnections(indices[r]);
        let normSq = 0;
        for (let c = 0; c < cols; c++) {
          const synapse = inward[c];
          const cs = state.connection(synapse.from, synapse.to);
          if (cs.batchAverageWeight === undefined) continue;
          const delta = cs.batchAverageWeight - synapse.weight;
          if (!Number.isFinite(delta)) continue;
          data[r * cols + c] = delta;
          written[r * cols + c] = 1;
          normSq += delta * delta;
          anyFinalised = true;
        }
        rowNorms[r] = Math.sqrt(normSq);
      }

      if (!anyFinalised) continue;

      const matrix: RowMajorMatrix = { data, rows, cols };
      newtonSchulzOrthogonalise(matrix);

      // Rescale each row back to its original norm so per-neuron update
      // magnitude is preserved (the orthogonalisation only redirects).
      for (let r = 0; r < rows; r++) {
        const targetNorm = rowNorms[r];
        if (targetNorm === 0) continue;
        let postSq = 0;
        for (let c = 0; c < cols; c++) {
          const v = data[r * cols + c];
          postSq += v * v;
        }
        const postNorm = Math.sqrt(postSq);
        if (postNorm === 0) continue;
        const scale = targetNorm / postNorm;
        for (let c = 0; c < cols; c++) {
          data[r * cols + c] *= scale;
        }
      }

      // Write back: batchAverageWeight = currentWeight + orthogonalised delta.
      for (let r = 0; r < rows; r++) {
        const inward = creature.inwardConnections(indices[r]);
        for (let c = 0; c < cols; c++) {
          if (written[r * cols + c] === 0) continue;
          const synapse = inward[c];
          const cs = state.connection(synapse.from, synapse.to);
          const newDelta = data[r * cols + c];
          if (!Number.isFinite(newDelta)) continue;
          cs.batchAverageWeight = synapse.weight + newDelta;
        }
      }
    }
  }
}

/**
 * Snapshot of per-synapse weights captured before `propagateUpdate`
 * runs, keyed by `(fromNeuronIdx, toNeuronIdx)`.
 *
 * Built by {@link snapshotWeights} and consumed by
 * {@link applyMuonOrthogonalisationToDeltas}.
 */
export type WeightSnapshot = Map<number, Map<number, number>>;

/**
 * Capture every synapse's current weight into a `(from → to → weight)`
 * map. Used by Muon to compute the delta applied by the standard
 * `propagateUpdate` step and orthogonalise it post hoc.
 */
export function snapshotWeights(creature: Creature): WeightSnapshot {
  const snap: WeightSnapshot = new Map();
  for (const s of creature.synapses) {
    let inner = snap.get(s.from);
    if (inner === undefined) {
      inner = new Map();
      snap.set(s.from, inner);
    }
    inner.set(s.to, s.weight);
  }
  return snap;
}

/**
 * Apply Muon orthogonalisation to the per-neuron incoming-weight
 * deltas implied by the difference between the current synapse weights
 * and a pre-update snapshot. The orthogonalised delta is written back
 * to each synapse, replacing the standard backprop step's update with
 * a decorrelated equivalent.
 *
 * No-op when `config.gradientOrthogonalisation !== "muon"`.
 */
export function applyMuonOrthogonalisationToDeltas(
  creature: Creature,
  snapshot: WeightSnapshot,
  config: BackPropagationConfig,
): void {
  if (config.gradientOrthogonalisation !== "muon") return;
  if (config.disableWeightAdjustment) return;

  const layers = computeLayerAssignments(creature);
  if (layers.size === 0) return;

  const lookupOldWeight = (from: number, to: number): number | undefined => {
    const inner = snapshot.get(from);
    return inner?.get(to);
  };

  for (const [depth, neuronIndices] of layers) {
    if (depth === 0) continue;
    if (neuronIndices.length < 2) continue;

    const buckets = new Map<number, number[]>();
    for (const idx of neuronIndices) {
      const inCount = creature.inwardConnections(idx).length;
      if (inCount === 0) continue;
      let bucket = buckets.get(inCount);
      if (bucket === undefined) {
        bucket = [];
        buckets.set(inCount, bucket);
      }
      bucket.push(idx);
    }

    for (const [inCount, indices] of buckets) {
      if (indices.length < 2) continue;

      const rows = indices.length;
      const cols = inCount;
      const data = new Float64Array(rows * cols);
      const rowNorms = new Float64Array(rows);
      const oldWeightAt = new Float64Array(rows * cols);

      let anyDelta = false;
      for (let r = 0; r < rows; r++) {
        const inward = creature.inwardConnections(indices[r]);
        let normSq = 0;
        for (let c = 0; c < cols; c++) {
          const synapse = inward[c];
          const oldWeight = lookupOldWeight(synapse.from, synapse.to);
          if (oldWeight === undefined) continue;
          oldWeightAt[r * cols + c] = oldWeight;
          const delta = synapse.weight - oldWeight;
          if (!Number.isFinite(delta)) continue;
          data[r * cols + c] = delta;
          normSq += delta * delta;
          if (delta !== 0) anyDelta = true;
        }
        rowNorms[r] = Math.sqrt(normSq);
      }

      if (!anyDelta) continue;

      newtonSchulzOrthogonalise({ data, rows, cols });

      // Rescale each row to preserve per-neuron update magnitude.
      for (let r = 0; r < rows; r++) {
        const targetNorm = rowNorms[r];
        if (targetNorm === 0) continue;
        let postSq = 0;
        for (let c = 0; c < cols; c++) {
          const v = data[r * cols + c];
          postSq += v * v;
        }
        const postNorm = Math.sqrt(postSq);
        if (postNorm === 0) continue;
        const scale = targetNorm / postNorm;
        for (let c = 0; c < cols; c++) data[r * cols + c] *= scale;
      }

      // Write back: weight = oldWeight + orthogonalised delta.
      for (let r = 0; r < rows; r++) {
        const inward = creature.inwardConnections(indices[r]);
        if (rowNorms[r] === 0) continue;
        for (let c = 0; c < cols; c++) {
          const synapse = inward[c];
          const newDelta = data[r * cols + c];
          if (!Number.isFinite(newDelta)) continue;
          synapse.weight = oldWeightAt[r * cols + c] + newDelta;
        }
      }
    }
  }
}
