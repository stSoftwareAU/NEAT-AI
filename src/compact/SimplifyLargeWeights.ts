import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { valuePenalty } from "@architecture/Score.ts";
import { ABSOLUTE } from "@methods/activations/types/ABSOLUTE.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { LeakyReLU } from "@methods/activations/types/LeakyReLU.ts";
import { ReLU } from "@methods/activations/types/ReLU.ts";
import { IF } from "@methods/activations/aggregate/IF.ts";
import { MAXIMUM } from "@methods/activations/aggregate/MAXIMUM.ts";
import { MINIMUM } from "@methods/activations/aggregate/MINIMUM.ts";
import { HYPOT } from "@deprecated/HYPOT.ts";
import { HYPOTv2 } from "@deprecated/HYPOTv2.ts";
import { MEAN } from "@deprecated/MEAN.ts";

/**
 * 30-Dec-2025: Simplify large weights for homogeneous squashes (issue #642).
 *
 * For scale-homogeneous squashes (e.g. ABSOLUTE, IDENTITY, ReLU) a neuron's
 * inbound weights/bias can be rescaled by 1/c and its outbound weights by c
 * without changing behaviour:
 *
 *   z   = Σ(wi*xi) + b
 *   z'  = z / c
 *   f(z') = f(z) / c         (for homogeneous f, with c > 0)
 *   (v*c) * (f(z)/c) = v*f(z)
 *
 * This can turn a "huge inbound / tiny outbound" pair into two moderate
 * values, reducing the score penalty (which is based on max/avg abs weights
 * and biases).
 *
 * Issue #2200: When `mcmcTemperature` is provided, worsening rescalings are
 * accepted with probability exp(-delta / temperature) rather than being
 * greedily rejected. This allows escaping local optima in weight space.
 *
 * @param exported - The creature export to modify in-place
 * @param mcmcTemperature - Optional MCMC temperature for probabilistic
 *   acceptance of worsening rescalings.
 * @returns `true` if any rescaling was applied, `false` otherwise.
 */
export function simplifyLargeWeights(
  exported: CreatureExport,
  mcmcTemperature?: number,
): boolean {
  // Supported squashes are those that are scale-homogeneous in our
  // implementation: for any k > 0, f(kx) = k f(x). Includes linear squashes
  // and some aggregation squashes that remain homogeneous.
  const candidateSquashes = new Set<string>([
    ABSOLUTE.NAME,
    IDENTITY.NAME,
    ReLU.NAME,
    LeakyReLU.NAME,
    MAXIMUM.NAME,
    MINIMUM.NAME,
    IF.NAME,
    HYPOT.NAME,
    HYPOTv2.NAME,
    MEAN.NAME,
  ]);

  // Only attempt rescaling when there is a meaningful imbalance (3+ orders
  // of magnitude). The accept/reject gate below uses the same penalty logic
  // as scoring, so this heuristic is purely a performance guard.
  const IMBALANCE_RATIO = 1_000;

  const inward = new Map<number, SynapseExport[]>();
  const outward = new Map<number, SynapseExport[]>();
  for (const s of exported.synapses) {
    outward.set(s.fromId!, (outward.get(s.fromId!) ?? []).concat(s));
    inward.set(s.toId!, (inward.get(s.toId!) ?? []).concat(s));
  }

  let changed = false;
  let bestPenalty = calculateWeightBiasPenalty(exported);

  for (const neuron of exported.neurons) {
    if (neuron.type !== "hidden") continue;
    if (!neuron.squash || !candidateSquashes.has(neuron.squash)) continue;

    const inConns = inward.get(neuron.id!) ?? [];
    const outConns = outward.get(neuron.id!) ?? [];
    if (inConns.length === 0) continue;
    if (outConns.length === 0) continue;

    let maxIn = Math.abs(neuron.bias);
    for (const s of inConns) maxIn = Math.max(maxIn, Math.abs(s.weight));

    let maxOut = 0;
    for (const s of outConns) maxOut = Math.max(maxOut, Math.abs(s.weight));

    if (maxIn === 0 || maxOut === 0) continue;

    const ratio = maxIn / maxOut;
    if (ratio < 1 / IMBALANCE_RATIO || ratio > IMBALANCE_RATIO) {
      // Choose c to equalise maxIn/c and maxOut*c, minimising their maximum.
      const c = Math.sqrt(maxIn / maxOut);
      if (!Number.isFinite(c) || c === 0 || c === 1) continue;

      // Snapshot for revert.
      const oldBias = neuron.bias;
      const oldInWeights = inConns.map((s) => s.weight);
      const oldOutWeights = outConns.map((s) => s.weight);

      neuron.bias = neuron.bias / c;
      for (const s of inConns) s.weight = s.weight / c;
      for (const s of outConns) s.weight = s.weight * c;

      // Reject if we introduced anything non-finite.
      const allFinite = Number.isFinite(neuron.bias) &&
        inConns.every((s) => Number.isFinite(s.weight)) &&
        outConns.every((s) => Number.isFinite(s.weight));

      if (!allFinite) {
        neuron.bias = oldBias;
        inConns.forEach((s, i) => s.weight = oldInWeights[i]);
        outConns.forEach((s, i) => s.weight = oldOutWeights[i]);
        continue;
      }

      const nextPenalty = calculateWeightBiasPenalty(exported);
      if (nextPenalty + 1e-15 < bestPenalty) {
        // Clear improvement: always accept
        bestPenalty = nextPenalty;
        changed = true;
      } else if (
        mcmcTemperature !== undefined && mcmcTemperature > 0
      ) {
        // Issue #2200: M-H probabilistic acceptance for worsening rescalings.
        // Allows escaping local optima in weight space during compaction.
        const deltaPenalty = nextPenalty - bestPenalty;
        const acceptProb = Math.exp(-deltaPenalty / mcmcTemperature);
        if (Math.random() < acceptProb) {
          bestPenalty = nextPenalty;
          changed = true;
        } else {
          neuron.bias = oldBias;
          inConns.forEach((s, i) => s.weight = oldInWeights[i]);
          outConns.forEach((s, i) => s.weight = oldOutWeights[i]);
        }
      } else {
        // No improvement; revert (greedy).
        neuron.bias = oldBias;
        inConns.forEach((s, i) => s.weight = oldInWeights[i]);
        outConns.forEach((s, i) => s.weight = oldOutWeights[i]);
      }
    }
  }

  if (changed) {
    // Memetic values were tuned for the previous scale; treat them as stale.
    delete exported.memetic;
  }

  return changed;
}

/**
 * Calculates a weight/bias magnitude penalty using the same max + average
 * combination applied in scoring. Exposed for use by callers that want to
 * compare penalty before/after a structural change.
 *
 * @param exported - The creature export to measure.
 * @returns A non-negative penalty value. Higher values indicate larger or
 *   more imbalanced weights/biases.
 */
export function calculateWeightBiasPenalty(exported: CreatureExport): number {
  let max = 0;
  let total = 0;
  let count = 0;

  for (const synapse of exported.synapses) {
    const w = Math.abs(synapse.weight);
    if (!Number.isFinite(w)) continue;
    max = Math.max(max, w);
    total += w;
    count++;
  }

  // CreatureExport.neurons excludes inputs; bias is defined for all entries.
  for (const neuron of exported.neurons) {
    const b = Math.abs(neuron.bias);
    if (!Number.isFinite(b)) continue;
    max = Math.max(max, b);
    total += b;
    count++;
  }

  // No weights/biases should never happen for a valid creature, but keep safe.
  if (count === 0) return 0;

  // Mirror Score.calculateMaxOutOfBounds() safety: clamp to avoid tripping
  // `valuePenalty()` asserts on absurd magnitudes.
  if (max > Number.MAX_SAFE_INTEGER) max = Number.MAX_SAFE_INTEGER;
  if (total > Number.MAX_SAFE_INTEGER) total = Number.MAX_SAFE_INTEGER;

  const avg = total / count;
  return (valuePenalty(max) + valuePenalty(avg)) / 2;
}
