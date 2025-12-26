import type { Neuron } from "../architecture/Neuron.ts";
import type { Synapse } from "../architecture/Synapse.ts";
import type { DiscoverRecord } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { distributeElasticError } from "./ElasticDistribution.ts";

/**
 * Recording-time elasticity helpers.
 *
 * Explorer + discovery use `Creature.record()` / `Neuron.record()` to attribute
 * value-space error to upstream paths. Historically the record path distributed
 * error equally across inbound links, which can heavily over-attribute error to
 * saturated squashes (eg. ArcTan near ±π/2).
 *
 * These helpers mirror training-time behaviour:
 * - prefer “plastic” links (large activation => smaller weight change needed)
 * - use safe-zone gates to avoid pushing already saturated parents further
 *
 * Note: record-time uses *raw* creature weights and *raw* activations from the
 * forward pass (not adjusted weights/biases), because it is an attribution /
 * analysis path rather than a training update.
 */

export type RecordElasticLink = Readonly<{
  synapse: Synapse;
  fromNeuron: Neuron;
  fromActivation: number;
  fromValue: number;
  safeZoneFactor: number;
  /**
   * Record-time feasibility/comfort factor for the *implied* upstream target.
   *
   * This is intentionally separate from `safeZoneFactor`:
   * - `safeZoneFactor` is about local plasticity / saturation in raw-input space
   * - `feasibilityFactor` is about whether the requested *activation target* is
   *   feasible (range-limited squashes) or strongly undesirable (ReLU-family
   *   variants we prefer to keep non-negative during record attribution)
   */
  feasibilityFactor: number;
}>;

// Tiny epsilon to avoid flapping around exact boundaries.
const RECORD_TARGET_EPSILON = 1e-9;

// Squashes where out-of-range record targets are especially misleading during
// attribution. For these, we treat out-of-range targets as blocked so we prefer
// alternative synapses when available.
const HARD_RANGE_SQUASHES = new Set<string>([
  "ABSOLUTE",
  "ReLU",
  "ReLU6",
  "SQUARE",
]);

// During record-time attribution (Explorer/discovery analysis), we prefer to
// avoid pushing these squashes negative when there is an alternative synapse.
//
// Rationale:while some of these can technically output
// negative values, pushing them negative during attribution can create large,
// misleading neuron-level errors that then get redistributed elsewhere.
const NEGATIVE_RESIST_SQUASHES = new Set<string>([
  "Swish",
  "SELU",
  "GELU",
  "LeakyReLU",
  "ELU",
]);

export function recordTargetFeasibilityFactor(
  fromNeuron: Neuron,
  targetActivation: number,
): number {
  if (!Number.isFinite(targetActivation)) return 0;

  const squash = fromNeuron.findSquash();
  const range = squash.range;
  const name = squash.getName();

  // Preference weighting (NOT hard blocking):
  //
  // For some squashes, requesting out-of-range targets (or strongly undesirable
  // targets) can inflate record-time error attribution. We bias away from these
  // paths, but we do not hard-block them here because we support “partial”
  // allocation (clamp to feasible boundary + redistribute residue).
  if (HARD_RANGE_SQUASHES.has(name)) {
    if (
      targetActivation < range.low - RECORD_TARGET_EPSILON ||
      targetActivation > range.high + RECORD_TARGET_EPSILON
    ) {
      return 0.1;
    }
  }

  // Soft preference: for certain ReLU-family variants, prefer not to cross
  // below zero during record attribution.
  if (
    NEGATIVE_RESIST_SQUASHES.has(name) &&
    targetActivation < -RECORD_TARGET_EPSILON
  ) {
    return 0.1;
  }

  return 1;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Clamp + redistribute record-time shares so we never request impossible (or
 * strongly undesirable) upstream activation targets.
 *
 * Example: ABSOLUTE has activation range [0, +∞). If a link’s allocated share
 * would imply a negative target activation, we clamp that share to the
 * boundary (target=0) and redistribute the leftover error to other links.
 */
export function constrainAndRedistributeRecordShares(
  error: number,
  links: ReadonlyArray<RecordElasticLink>,
  shares: ReadonlyArray<number>,
  options?: Readonly<{
    plankConstant?: number;
  }>,
): number[] {
  const plankConstant = options?.plankConstant ?? 1e-12;
  const workingShares = shares.slice();

  // Preallocate bounds arrays for stability / perf.
  const minShareBound = new Array<number>(links.length);
  const maxShareBound = new Array<number>(links.length);

  for (let pass = 0; pass < links.length + 2; pass++) {
    let sum = 0;

    // Clamp each share to what its upstream squash can accept.
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const weight = link.synapse.weight;
      const fromNeuron = link.fromNeuron;
      const fromValue = link.fromValue;

      let minTarget = -Infinity;
      let maxTarget = Infinity;

      if (
        fromNeuron.type !== "input" &&
        fromNeuron.type !== "constant"
      ) {
        const squash = fromNeuron.findSquash();
        const name = squash.getName();

        if (HARD_RANGE_SQUASHES.has(name)) {
          minTarget = squash.range.low;
          maxTarget = squash.range.high;
        } else if (NEGATIVE_RESIST_SQUASHES.has(name)) {
          // Soft preference: avoid going negative when alternatives exist.
          minTarget = Math.max(0, squash.range.low);
          maxTarget = squash.range.high;
        }
      }

      let minShare = -Infinity;
      let maxShare = Infinity;

      // If we cannot recurse meaningfully (no weight / blocked safe-zone),
      // clamp to 0 share.
      const gate = Math.max(
        0,
        Math.min(1, link.safeZoneFactor * link.feasibilityFactor),
      );
      if (!weight || !Number.isFinite(weight) || gate <= plankConstant) {
        minShare = 0;
        maxShare = 0;
      } else {
        const a = Number.isFinite(minTarget)
          ? (weight * minTarget - fromValue)
          : -Infinity;
        const b = Number.isFinite(maxTarget)
          ? (weight * maxTarget - fromValue)
          : Infinity;
        minShare = Math.min(a, b);
        maxShare = Math.max(a, b);
      }

      minShareBound[i] = minShare;
      maxShareBound[i] = maxShare;

      const s = Number.isFinite(workingShares[i]) ? workingShares[i] : 0;
      const clampedShare = clamp(s, minShare, maxShare);
      workingShares[i] = clampedShare;
      sum += clampedShare;
    }

    // Leftover value-space error after clamping.
    const residue = error - sum;
    if (!Number.isFinite(residue) || Math.abs(residue) <= plankConstant) {
      break;
    }

    // Find links that still have capacity to absorb residue in the required direction.
    const eligibleLinks: RecordElasticLink[] = [];
    const eligibleIndex: number[] = [];
    for (let i = 0; i < links.length; i++) {
      const s = workingShares[i] ?? 0;
      if (residue > 0) {
        if (s < (maxShareBound[i] ?? 0) - plankConstant) {
          eligibleLinks.push(links[i]);
          eligibleIndex.push(i);
        }
      } else {
        if (s > (minShareBound[i] ?? 0) + plankConstant) {
          eligibleLinks.push(links[i]);
          eligibleIndex.push(i);
        }
      }
    }

    if (eligibleLinks.length === 0) {
      break;
    }

    // Redistribute residue across remaining-capacity links using elasticity.
    const { shares: redistributed } = distributeRecordError(
      residue,
      eligibleLinks,
      {
        plankConstant,
        allowEqualFallback: true,
      },
    );
    for (let j = 0; j < eligibleIndex.length; j++) {
      const idx = eligibleIndex[j];
      workingShares[idx] = (workingShares[idx] ?? 0) + (redistributed[j] ?? 0);
    }
  }

  return workingShares;
}

export function getOrComputeRecordValue(
  neuron: Neuron,
  discoverMap: Map<string, DiscoverRecord>,
): number {
  const existing = discoverMap.get(neuron.uuid);
  if (
    existing && typeof existing.value === "number" &&
    Number.isFinite(existing.value)
  ) {
    return existing.value;
  }

  const state = neuron.creature.state;
  const activations = state.activations;

  let value = neuron.bias;
  if (neuron.type === "input") {
    value = activations[neuron.index];
  } else if (neuron.type === "constant") {
    value = neuron.bias;
  } else {
    const inward = neuron.creature.inwardConnections(neuron.index);
    for (let i = inward.length; i--;) {
      const c = inward[i];
      if (c.from === c.to) continue;
      value += c.weight * activations[c.from];
    }
  }

  if (existing) {
    existing.value = value;
  } else {
    discoverMap.set(neuron.uuid, {
      activation: state.activations[neuron.index],
      errors: [],
      value,
    });
  }

  return value;
}

export function buildRecordElasticLinks(
  neuron: Neuron,
  inward: ReadonlyArray<Synapse>,
  discoverMap: Map<string, DiscoverRecord>,
  provisionalErrorPerLink: number,
  options?: Readonly<{
    includeInputNodes?: boolean;
  }>,
): RecordElasticLink[] {
  const includeInputNodes = options?.includeInputNodes ?? false;

  const state = neuron.creature.state;
  const activations = state.activations;

  const links: RecordElasticLink[] = [];
  for (let i = 0; i < inward.length; i++) {
    const c = inward[i];
    if (c.from === c.to) continue;
    if (!c.weight) continue;

    const fromNeuron = neuron.creature.neurons[c.from];
    if (
      includeInputNodes === false &&
      (fromNeuron.type === "input" || fromNeuron.type === "constant")
    ) {
      continue;
    }

    const fromActivation = activations[fromNeuron.index];
    const fromValue = c.weight * fromActivation;

    let safeZoneFactor = 1;
    if (fromNeuron.type !== "input" && fromNeuron.type !== "constant") {
      const squash = fromNeuron.findSquash();
      if (squash.safeZoneAdjustment) {
        const rawInput = getOrComputeRecordValue(fromNeuron, discoverMap);
        safeZoneFactor = squash.safeZoneAdjustment(
          rawInput,
          provisionalErrorPerLink,
          c.weight,
        );
      }
    }

    // Estimate the implied upstream activation target if this link absorbed a
    // provisional equal share of error in value space.
    const impliedTargetFromValue = fromValue + provisionalErrorPerLink;
    const impliedTargetFromActivation = impliedTargetFromValue / c.weight;
    const feasibilityFactor = (fromNeuron.type !== "input" &&
        fromNeuron.type !== "constant")
      ? recordTargetFeasibilityFactor(fromNeuron, impliedTargetFromActivation)
      : 1;

    links.push({
      synapse: c,
      fromNeuron,
      fromActivation,
      fromValue,
      safeZoneFactor,
      feasibilityFactor,
    });
  }

  return links;
}

/**
 * Distributes record-time error across inbound links using the same basic
 * elasticity heuristic as training time, but with record-time inputs.
 *
 * Returns the chosen links and per-link shares aligned to that link list.
 */
export function distributeRecordError(
  error: number,
  links: ReadonlyArray<RecordElasticLink>,
  options?: Readonly<{
    plankConstant?: number;
    /**
     * When true, if all safe-zone/activation scores are zero we still fall back
     * to an equal split (last resort).
     */
    allowEqualFallback?: boolean;
  }>,
): { links: ReadonlyArray<RecordElasticLink>; shares: number[] } {
  const plankConstant = options?.plankConstant ?? 1e-12;
  const allowEqualFallback = options?.allowEqualFallback ?? true;

  if (!Number.isFinite(error) || links.length === 0) {
    return { links, shares: new Array(links.length).fill(0) };
  }

  // IMPORTANT:
  // Training-time elasticity uses activation² because it approximates the
  // minimum L2 *weight-change* solution for achieving a target Δv:
  //   minimise Σ(Δw_i²) s.t. Σ(a_i Δw_i) = Δv  => shares ∝ a_i²
  //
  // Record-time attribution recursively calls `fromNeuron.record(targetActivation)`,
  // i.e. it implies changing *upstream activations*, not weights. For changing
  // activations, the analogous minimum L2 solution is:
  //   minimise Σ(Δa_i²) s.t. Σ(w_i Δa_i) = Δv  => shares ∝ w_i²
  //
  // This prevents “exploding” implied targets when a link has a tiny weight:
  //   targetFromActivation = (fromValue + share) / weight.
  const meta = links.map((l) => ({
    activation: Math.abs(l.synapse.weight),
    safeZoneFactor: l.safeZoneFactor * l.feasibilityFactor,
  }));

  // If everything is blocked, `distributeElasticError` will equal-split. That’s
  // acceptable as a last resort, but we allow opting out for callers that want
  // to stop recursion instead.
  if (!allowEqualFallback) {
    let denom = 0;
    for (const m of meta) {
      denom += (m.activation * m.activation) *
        Math.max(0, Math.min(1, m.safeZoneFactor));
    }
    if (denom <= plankConstant) {
      return { links, shares: new Array(links.length).fill(0) };
    }
  }

  const shares = distributeElasticError(error, meta, { plankConstant });
  return { links, shares };
}
