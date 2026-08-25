import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { meanMagnitudePenalty } from "@architecture/Score.ts";
import { ABSOLUTE } from "@methods/activations/types/ABSOLUTE.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { LeakyReLU } from "@methods/activations/types/LeakyReLU.ts";
import { ReLU } from "@methods/activations/types/ReLU.ts";
import { IF } from "@methods/activations/aggregate/IF.ts";
import { MAXIMUM } from "@methods/activations/aggregate/MAXIMUM.ts";
import { MINIMUM } from "@methods/activations/aggregate/MINIMUM.ts";
// best-practice-ignore: BP-91862f495db6 — HYPOT is deprecated but remains a
// supported squash here so legacy creatures that still carry it are compacted
// rather than silently skipped. Issue #3446.
import { HYPOT } from "@deprecated/HYPOT.ts";
// best-practice-ignore: BP-6b1e9a008759 — HYPOTv2 is deprecated but remains a
// supported squash here so legacy creatures that still carry it are compacted
// rather than silently skipped. Issue #3447.
import { HYPOTv2 } from "@deprecated/HYPOTv2.ts";
// best-practice-ignore: BP-619a32c95d3a — MEAN is deprecated but remains a
// supported squash here so existing creatures that still carry it are compacted
// rather than silently skipped. Issue #3448.
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
    // best-practice-ignore: BP-91862f495db6 — deliberate; see import above.
    HYPOT.NAME,
    // best-practice-ignore: BP-6b1e9a008759 — deliberate; see import above.
    HYPOTv2.NAME,
    // best-practice-ignore: BP-619a32c95d3a — deliberate; see import above.
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
 * Calculates a weight/bias magnitude penalty using the same aggregate scoring
 * charges — the mean per-value penalty (Issue #3881). Exposed for use by
 * callers that want to compare penalty before/after a structural change.
 *
 * It previously averaged `(max, avg)`, so a simplification that shrank the body
 * of the distribution without touching the largest weight scored as no
 * improvement even though the score had moved.
 *
 * @param exported - The creature export to measure.
 * @returns A penalty in [0, 1). Higher values indicate larger weights/biases.
 */
export function calculateWeightBiasPenalty(exported: CreatureExport): number {
  function* magnitudes(): Generator<number> {
    for (const synapse of exported.synapses) yield synapse.weight;
    // CreatureExport.neurons excludes inputs; bias is defined for all entries.
    for (const neuron of exported.neurons) yield neuron.bias;
  }
  return meanMagnitudePenalty(magnitudes());
}
