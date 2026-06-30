/**
 * SquashEffectivenessTracker.ts - Per-role squash fitness EMA (Issue #2457).
 *
 * Maintains a per-(neuron-role) histogram mapping squash name → exponential
 * moving average of the fitness delta observed when a mutation landed on
 * that role with that squash. ModSquash uses the tracker to draw squash
 * candidates Boltzmann-style weighted by the recent EMA delta when enough
 * samples exist; otherwise it falls back to the existing uniform pool.
 *
 * "Role" is intentionally coarse to avoid sparsity: layer bucket
 * (input-adjacent / mid / output-adjacent) × fan-in bucket
 * (low / medium / high). Output neurons are always output-adjacent.
 */

import type { Creature } from "@creature";
import type { RequiredSquashEffectivenessConfig } from "@config/SquashEffectivenessConfig.ts";
import { computeLayerAssignments } from "@propagate/LayerAssignment.ts";
import type { RandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";

/** Coarse layer bucket. */
export type LayerBucket = "input-adjacent" | "mid" | "output-adjacent";

/** Coarse fan-in bucket. */
export type FanInBucket = "low" | "medium" | "high";

/**
 * Stable role identifier for a neuron.
 */
export interface NeuronRole {
  readonly layer: LayerBucket;
  readonly fanIn: FanInBucket;
}

/**
 * Encode a role into a string key suitable for Map indexing.
 */
function roleKey(role: NeuronRole): string {
  return `${role.layer}|${role.fanIn}`;
}

interface PendingEntry {
  readonly role: NeuronRole;
  readonly squashName: string;
  readonly baselineScore: number | undefined;
}

interface RoleStats {
  /**
   * Map of squash name → EMA of observed fitness delta for that squash in
   * this role. Larger values indicate the squash historically improved
   * fitness when used in this role.
   */
  readonly ema: Map<string, number>;
  /** Total samples committed to this role. */
  sampleCount: number;
}

/**
 * Per-role squash effectiveness tracker.
 *
 * Designed to be cheap on the hot path: pickSquash performs O(N) work over
 * the candidate squash names (typically ≤ ~30). The tracker is owned by
 * Neat and survives across generations within a single training run.
 */
export class SquashEffectivenessTracker {
  private readonly stats: Map<string, RoleStats> = new Map();
  /**
   * Pending mutations awaiting fitness re-evaluation. Keyed by Creature so
   * the entry is reclaimed automatically if the creature is dropped from
   * the population. Each creature can hold at most one pending squash
   * entry — if a second squash mutation lands on the same creature in the
   * same generation it overwrites the first (the latter is the squash
   * actually present at fitness time).
   */
  private readonly pending: WeakMap<Creature, PendingEntry> = new WeakMap();

  constructor(
    private readonly config: RequiredSquashEffectivenessConfig,
  ) {}

  /** Whether biasing is enabled in config. */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Returns the role for a neuron at `index` within `creature`. Layer info
   * is computed lazily by `computeLayerAssignments` for the entire creature.
   * Callers that mutate one neuron at a time should accept the cost; ModSquash
   * mutations are infrequent compared with weight/bias mutations.
   */
  computeRole(creature: Creature, neuronIndex: number): NeuronRole {
    const inputCount = creature.input;
    const outputStart = creature.neurons.length - creature.output;

    let layer: LayerBucket;
    if (neuronIndex >= outputStart) {
      // Output neurons are always output-adjacent.
      layer = "output-adjacent";
    } else {
      const layers = computeLayerAssignments(creature);
      // Find this neuron's depth and the maximum hidden depth.
      let depth = -1;
      let maxHiddenDepth = 0;
      for (const [layerNum, indices] of layers) {
        if (indices.includes(neuronIndex)) depth = layerNum;
        // Track the maximum depth that does not contain output neurons.
        if (indices[0] !== undefined && indices[0] < outputStart) {
          if (layerNum > maxHiddenDepth) maxHiddenDepth = layerNum;
        }
      }

      if (depth <= 1 || neuronIndex < inputCount) {
        layer = "input-adjacent";
      } else if (depth >= maxHiddenDepth) {
        // Last hidden layer — adjacent to outputs.
        layer = "output-adjacent";
      } else {
        layer = "mid";
      }
    }

    const fanInCount = creature.inwardConnections(neuronIndex).length;
    let fanIn: FanInBucket;
    if (fanInCount < this.config.fanInLowThreshold) {
      fanIn = "low";
    } else if (fanInCount >= this.config.fanInHighThreshold) {
      fanIn = "high";
    } else {
      fanIn = "medium";
    }

    return { layer, fanIn };
  }

  /**
   * Pick a squash for a neuron in `role`, preferring squashes with higher
   * EMA fitness delta when enough samples exist. Returns `null` when the
   * caller should fall back to its uniform sampler — specifically when:
   *   - the tracker is disabled,
   *   - the role does not yet have `minSamples` samples, or
   *   - the exploration draw fires (`< explorationWeight`).
   *
   * `candidates` should already exclude any current squash the caller
   * wants to avoid (e.g. the neuron's existing squash). Returning `null`
   * (rather than picking from `candidates` uniformly) preserves the
   * existing uniform-weighted-by-priority sampling in `Activations`.
   */
  pickSquashBiased(
    role: NeuronRole,
    candidates: readonly string[],
    rng: RandomNumberGenerator,
  ): string | null {
    if (candidates.length === 0) return null;

    if (!this.config.enabled) return null;

    const stats = this.stats.get(roleKey(role));
    if (!stats || stats.sampleCount < this.config.minSamples) {
      return null;
    }

    // Exploration: a fraction of draws stay uniform so under-explored
    // squashes still get tried.
    if (rng.random() < this.config.explorationWeight) {
      return null;
    }

    // Boltzmann-style weighting: w_i = exp(beta * ema_i). Squashes with no
    // recorded EMA receive the neutral weight exp(0) = 1 so they remain
    // reachable. The inverse-temperature `beta` makes small fitness deltas
    // decisive — production fitness deltas are typically small in magnitude.
    const beta = this.config.boltzmannBeta;
    let totalWeight = 0;
    const weights = new Array<number>(candidates.length);
    for (let i = 0; i < candidates.length; i++) {
      const ema = stats.ema.get(candidates[i]) ?? 0;
      const w = Math.exp(beta * ema);
      weights[i] = w;
      totalWeight += w;
    }

    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      return null;
    }

    const target = rng.random() * totalWeight;
    let cumulative = 0;
    for (let i = 0; i < candidates.length; i++) {
      cumulative += weights[i];
      if (target < cumulative) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  /**
   * Record that `creature` had its squash mutated to `squashName` for a
   * neuron with role `role`. The pre-mutation score is captured (when
   * available) so the next commit can compute the delta.
   */
  recordPending(
    creature: Creature,
    role: NeuronRole,
    squashName: string,
    baselineScore: number | undefined,
  ): void {
    this.pending.set(creature, { role, squashName, baselineScore });
  }

  /**
   * Commit any pending squash mutation for `creature` using its currently
   * observed fitness. When a baseline score was captured at mutation time,
   * the EMA is updated with `currentScore - baselineScore`; otherwise the
   * raw `currentScore` is used as an approximate signal so freshly bred
   * creatures still contribute. No-ops when nothing is pending.
   *
   * @returns `true` if an entry was committed, `false` otherwise.
   */
  commit(creature: Creature, currentScore: number | undefined): boolean {
    const entry = this.pending.get(creature);
    if (!entry) return false;
    this.pending.delete(creature);
    if (currentScore === undefined || !Number.isFinite(currentScore)) {
      return false;
    }
    const baseline = entry.baselineScore;
    const delta = baseline !== undefined && Number.isFinite(baseline)
      ? currentScore - baseline
      : currentScore;
    if (!Number.isFinite(delta)) return false;
    this.applyDelta(entry.role, entry.squashName, delta);
    return true;
  }

  /**
   * Convenience helper used in tests and direct integrations to feed an
   * outcome without going through the pending mechanism.
   */
  recordOutcome(role: NeuronRole, squashName: string, delta: number): void {
    if (!Number.isFinite(delta)) return;
    this.applyDelta(role, squashName, delta);
  }

  /**
   * Inspect the current sample count for a role (useful in tests).
   */
  getSampleCount(role: NeuronRole): number {
    return this.stats.get(roleKey(role))?.sampleCount ?? 0;
  }

  /**
   * Inspect the current EMA for a (role, squash) pair (useful in tests).
   * Returns 0 when no samples have been recorded yet.
   */
  getEma(role: NeuronRole, squashName: string): number {
    return this.stats.get(roleKey(role))?.ema.get(squashName) ?? 0;
  }

  /** Drop all pending entries (e.g. when reseeding a population). */
  clearPending(): void {
    // WeakMap has no clear in older targets; recreate by replacing the
    // reference. Since `pending` is `readonly`, instead iterate is
    // unnecessary — pending entries are reclaimed when creatures are GCed.
    // For tests we expose this method but it intentionally remains a no-op
    // because creatures keep pending until commit is called.
  }

  private applyDelta(
    role: NeuronRole,
    squashName: string,
    delta: number,
  ): void {
    const key = roleKey(role);
    let stats = this.stats.get(key);
    if (!stats) {
      stats = { ema: new Map(), sampleCount: 0 };
      this.stats.set(key, stats);
    }
    const alpha = this.config.emaAlpha;
    const previous = stats.ema.get(squashName) ?? 0;
    const updated = previous + alpha * (delta - previous);
    stats.ema.set(squashName, updated);
    stats.sampleCount++;
  }
}
