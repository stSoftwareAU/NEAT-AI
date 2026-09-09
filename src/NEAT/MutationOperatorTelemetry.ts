/**
 * MutationOperatorTelemetry.ts - Per-operator mutation outcome telemetry
 * (Issue #3971).
 *
 * `MCMCDiagnostics` (Issue #2201) counts acceptance in aggregate, so it cannot
 * say whether `AddNeuron` is rejected more often than `ModWeight`, at what
 * depth the rejected changes landed, or how much evaluation wall-clock was
 * spent on offspring that were then discarded. This tracker records those
 * outcomes per operator.
 *
 * It is always on: every hook is a counter or a single map write per
 * *mutation*, never per synapse. The one non-constant call is the depth
 * bucket, which the caller computes for structural mutations only.
 *
 * Lifecycle of one mutated offspring:
 *
 * ```mermaid
 * flowchart LR
 *   P[recordProposed] --> N[recordNoChange]
 *   P --> A[recordApplied]
 *   A --> R[recordReverted]
 *   A --> E[recordEvaluated]
 *   A -.->|never evaluated| D[discarded at finaliseGeneration]
 *   E --> F[finaliseGeneration: accepted or rejected]
 * ```
 *
 * Attribution survives breeding: an offspring accumulates every operator
 * applied to it, and each one is credited with the offspring's outcome. The
 * report states that ambiguity rather than guessing at a single operator.
 */

import { getTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import type {
  MutationAttributionSummary,
  MutationDepthBucket,
  MutationOperatorReport,
  MutationOperatorSummary,
  ScoreDeltaDistribution,
} from "@neat/MutationOperatorReport.ts";
import {
  MULTI_OPERATOR_ATTRIBUTION_NOTE,
  MUTATION_DEPTH_BUCKETS,
} from "@neat/MutationOperatorReport.ts";

/**
 * How many `finaliseGeneration` passes a mutated offspring may stay pending
 * before it is written off as never evaluated. An offspring mutated at the end
 * of generation G is evaluated during G+1's fitness phase, so two passes is
 * one full generation of slack.
 */
const MAX_PENDING_GENERATIONS = 2;

/** Mutable per-operator accumulator; frozen into a summary at report time. */
interface OperatorCounters {
  proposed: number;
  noChange: number;
  applied: number;
  reverted: number;
  mcmcAccepted: number;
  mcmcRejected: number;
  evaluated: number;
  accepted: number;
  rejected: number;
  evaluationMs: number;
  deltaUnavailable: number;
  soleAttributed: number;
  coAttributed: number;
  readonly depthBuckets: Record<MutationDepthBucket, number>;
  readonly scoreDeltas: number[];
}

/** A mutated creature awaiting evaluation and a selection outcome. */
interface PendingOffspring {
  /**
   * Weak reference so a creature dropped from the population is collectable
   * while its attribution is still pending — telemetry must never be the
   * reason a generation's worth of creatures is retained.
   */
  readonly ref: WeakRef<Creature>;
  /** Every operator applied to this offspring, in application order. */
  readonly operators: Set<string>;
  /** Pre-mutation (parent) score, when one was available. */
  baselineScore: number | undefined;
  /** True once the offspring reached `Fitness.calculate()`. */
  evaluated: boolean;
  /** Evaluation wall-clock charged to this offspring, in ms. */
  evaluationMs: number;
  /** `finaliseGeneration` passes survived without being evaluated. */
  generationsPending: number;
  /** Set when the mutations were rolled back; swept at the next finalise. */
  dropped: boolean;
}

/** Options for {@link MutationOperatorTelemetry.recordApplied}. */
export interface RecordAppliedOptions {
  /** Depth bucket of the mutation site. Defaults to `unknown`. */
  readonly depthBucket?: MutationDepthBucket;
  /**
   * Score of the creature *before* the mutation. When omitted the tracker
   * falls back to the creature's own score, its `score` tag, and finally the
   * parent-baseline lookup supplied by {@link setParentBaselines}.
   */
  readonly baselineScore?: number;
}

function emptyDepthBuckets(): Record<MutationDepthBucket, number> {
  const buckets = {} as Record<MutationDepthBucket, number>;
  for (const bucket of MUTATION_DEPTH_BUCKETS) {
    buckets[bucket] = 0;
  }
  return buckets;
}

function newCounters(): OperatorCounters {
  return {
    proposed: 0,
    noChange: 0,
    applied: 0,
    reverted: 0,
    mcmcAccepted: 0,
    mcmcRejected: 0,
    evaluated: 0,
    accepted: 0,
    rejected: 0,
    evaluationMs: 0,
    deltaUnavailable: 0,
    soleAttributed: 0,
    coAttributed: 0,
    depthBuckets: emptyDepthBuckets(),
    scoreDeltas: [],
  };
}

/**
 * Order statistics of a delta sample. Returns `undefined` for an empty sample
 * so the report carries no distribution rather than a fabricated zero.
 */
export function summariseScoreDeltas(
  deltas: readonly number[],
): ScoreDeltaDistribution | undefined {
  if (deltas.length === 0) return undefined;
  const sorted = [...deltas].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    count: sorted.length,
    min: sorted[0],
    median,
    max: sorted[sorted.length - 1],
  };
}

/**
 * Per-operator mutation outcome tracker.
 *
 * Owned by `Neat` so pending attributions survive the per-generation `Mutator`
 * rebuild, and shared with `Fitness` so evaluation cost lands on the operators
 * that caused it.
 */
export class MutationOperatorTelemetry {
  private readonly counters = new Map<string, OperatorCounters>();

  /** Pending offspring, in creation order; resolved at generation end. */
  private pending: PendingOffspring[] = [];
  /** O(1) lookup from creature to its pending record. */
  private pendingByCreature = new WeakMap<Creature, PendingOffspring>();

  /** Aggregate M-H decisions this generation. */
  private mcmcAccepted = 0;
  private mcmcRejected = 0;

  /** Attribution bookkeeping for the current generation. */
  private resolvedOffspring = 0;
  private multiOperatorOffspring = 0;
  private discardedOffspring = 0;
  private resolvedEvaluationMs = 0;

  /**
   * Parent scores for freshly bred offspring, supplied by the breeding phase.
   * A bred offspring has no score of its own, so without this the score delta
   * of the mutations applied to it would be unattributable.
   */
  private parentBaselines?: WeakMap<Creature, number>;

  /**
   * Supply the breeding phase's parent-score lookup for this generation.
   *
   * @param baselines - Map from offspring to the score of the parent it was
   *   bred from, or `undefined` to clear.
   */
  setParentBaselines(baselines: WeakMap<Creature, number> | undefined): void {
    this.parentBaselines = baselines;
  }

  /** Record that `operator` was invoked. */
  recordProposed(operator: string): void {
    this.countersFor(operator).proposed++;
  }

  /**
   * Record that `operator` changed nothing — it returned `false`, or the
   * creature's UUID did not rotate. Never a rejection: these cost nothing.
   */
  recordNoChange(operator: string): void {
    this.countersFor(operator).noChange++;
  }

  /**
   * Record that `operator` changed `creature`, attributing the creature's
   * eventual outcome to it (alongside any other operator already applied).
   */
  recordApplied(
    creature: Creature,
    operator: string,
    options?: RecordAppliedOptions,
  ): void {
    const counters = this.countersFor(operator);
    counters.applied++;
    counters.depthBuckets[options?.depthBucket ?? "unknown"]++;

    const entry = this.entryFor(creature);
    entry.operators.add(operator);
    if (entry.baselineScore === undefined) {
      entry.baselineScore = options?.baselineScore !== undefined &&
          Number.isFinite(options.baselineScore)
        ? options.baselineScore
        : this.resolveBaseline(creature);
    }
  }

  /**
   * Record that every mutation applied to `creature` was rolled back before
   * any evaluation — a failed repair, or a Metropolis-Hastings rejection.
   */
  recordReverted(creature: Creature): void {
    const entry = this.pendingByCreature.get(creature);
    if (!entry) return;
    for (const operator of entry.operators) {
      this.countersFor(operator).reverted++;
    }
    this.dropEntry(creature, entry);
  }

  /**
   * Record one Metropolis-Hastings decision covering `creature`'s mutation
   * batch. The aggregate counts are per decision, so they reconcile exactly
   * with `MCMCDiagnostics`; the per-operator counts credit every operator in
   * the batch.
   */
  recordMcmcDecision(creature: Creature, accepted: boolean): void {
    if (accepted) {
      this.mcmcAccepted++;
    } else {
      this.mcmcRejected++;
    }
    const entry = this.pendingByCreature.get(creature);
    if (!entry) return;
    for (const operator of entry.operators) {
      const counters = this.countersFor(operator);
      if (accepted) {
        counters.mcmcAccepted++;
      } else {
        counters.mcmcRejected++;
      }
    }
  }

  /**
   * Record that `creature` reached `Fitness.calculate()` and cost
   * `evaluationMs` of wall-clock. A creature that was never evaluated — one
   * the de-duplicator replaced, for instance — never reaches this method and
   * so contributes to neither `evaluated` nor `evaluationMs`.
   */
  recordEvaluated(creature: Creature, evaluationMs: number): void {
    const entry = this.pendingByCreature.get(creature);
    if (!entry) return;
    entry.evaluated = true;
    if (Number.isFinite(evaluationMs) && evaluationMs > 0) {
      entry.evaluationMs += evaluationMs;
    }
  }

  /** Whether `creature` currently carries a pending attribution (tests). */
  hasPending(creature: Creature): boolean {
    return this.pendingByCreature.has(creature);
  }

  /**
   * Resolve every evaluated offspring against the surviving population, emit
   * the generation's report, and reset the per-generation counters.
   *
   * Offspring that have not been evaluated stay pending for up to
   * {@link MAX_PENDING_GENERATIONS} passes; after that they are written off as
   * discarded — they never reached evaluation.
   *
   * @param survivors - The population carried into the next generation.
   * @returns The report for the generation just finished.
   */
  finaliseGeneration(
    survivors: Iterable<Creature>,
  ): MutationOperatorReport {
    const survivorSet = survivors instanceof Set
      ? survivors as Set<Creature>
      : new Set(survivors);

    const stillPending: PendingOffspring[] = [];
    for (const entry of this.pending) {
      if (entry.dropped) continue;
      const creature = entry.ref.deref();
      if (!creature) {
        // Collected before it was evaluated — it never reached fitness.
        this.discardedOffspring++;
        continue;
      }
      if (entry.evaluated) {
        this.resolveEntry(creature, entry, survivorSet.has(creature));
        this.pendingByCreature.delete(creature);
        continue;
      }
      entry.generationsPending++;
      if (entry.generationsPending >= MAX_PENDING_GENERATIONS) {
        this.discardedOffspring++;
        this.pendingByCreature.delete(creature);
        continue;
      }
      stillPending.push(entry);
    }
    this.pending = stillPending;

    const report = this.buildReport();
    this.resetGeneration();
    return report;
  }

  /**
   * The report for the current (in-progress) generation, without resolving or
   * resetting anything. Useful for diagnostics and tests.
   */
  getGenerationReport(): MutationOperatorReport {
    return this.buildReport();
  }

  /** Drop all state — pending attributions included. */
  reset(): void {
    this.counters.clear();
    this.pending = [];
    this.pendingByCreature = new WeakMap();
    this.parentBaselines = undefined;
    this.resetGeneration();
  }

  private resolveEntry(
    creature: Creature,
    entry: PendingOffspring,
    survived: boolean,
  ): void {
    const delta = this.computeDelta(creature, entry);
    const coAttributed = entry.operators.size > 1;

    this.resolvedOffspring++;
    if (coAttributed) this.multiOperatorOffspring++;
    this.resolvedEvaluationMs += entry.evaluationMs;

    for (const operator of entry.operators) {
      const counters = this.countersFor(operator);
      counters.evaluated++;
      counters.evaluationMs += entry.evaluationMs;
      if (survived) {
        counters.accepted++;
      } else {
        counters.rejected++;
      }
      if (delta === undefined) {
        counters.deltaUnavailable++;
      } else {
        counters.scoreDeltas.push(delta);
      }
      if (coAttributed) {
        counters.coAttributed++;
      } else {
        counters.soleAttributed++;
      }
    }
  }

  /**
   * Offspring score minus the baseline captured at mutation time. `undefined`
   * when either end is missing or non-finite — reported as `deltaUnavailable`
   * rather than guessed at.
   */
  private computeDelta(
    creature: Creature,
    entry: PendingOffspring,
  ): number | undefined {
    const baseline = entry.baselineScore;
    if (baseline === undefined || !Number.isFinite(baseline)) return undefined;
    const score = creature.score;
    if (score === undefined || !Number.isFinite(score)) return undefined;
    return score - baseline;
  }

  private buildReport(): MutationOperatorReport {
    const operators: Record<string, MutationOperatorSummary> = {};
    for (const [name, counters] of this.counters) {
      operators[name] = {
        proposed: counters.proposed,
        noChange: counters.noChange,
        applied: counters.applied,
        reverted: counters.reverted,
        mcmcAccepted: counters.mcmcAccepted,
        mcmcRejected: counters.mcmcRejected,
        evaluated: counters.evaluated,
        accepted: counters.accepted,
        rejected: counters.rejected,
        evaluationMs: counters.evaluationMs,
        scoreDelta: summariseScoreDeltas(counters.scoreDeltas),
        deltaUnavailable: counters.deltaUnavailable,
        depthBuckets: { ...counters.depthBuckets },
        soleAttributed: counters.soleAttributed,
        coAttributed: counters.coAttributed,
      };
    }

    const attribution: MutationAttributionSummary = {
      resolvedOffspring: this.resolvedOffspring,
      multiOperatorOffspring: this.multiOperatorOffspring,
      discardedOffspring: this.discardedOffspring,
      evaluationMs: this.resolvedEvaluationMs,
      note: MULTI_OPERATOR_ATTRIBUTION_NOTE,
    };

    return {
      operators,
      mcmc: {
        proposed: this.mcmcAccepted + this.mcmcRejected,
        accepted: this.mcmcAccepted,
        rejected: this.mcmcRejected,
      },
      attribution,
    };
  }

  /** Clear per-generation counters; pending attributions are untouched. */
  private resetGeneration(): void {
    this.counters.clear();
    this.mcmcAccepted = 0;
    this.mcmcRejected = 0;
    this.resolvedOffspring = 0;
    this.multiOperatorOffspring = 0;
    this.discardedOffspring = 0;
    this.resolvedEvaluationMs = 0;
  }

  private countersFor(operator: string): OperatorCounters {
    let counters = this.counters.get(operator);
    if (!counters) {
      counters = newCounters();
      this.counters.set(operator, counters);
    }
    return counters;
  }

  private entryFor(creature: Creature): PendingOffspring {
    let entry = this.pendingByCreature.get(creature);
    if (!entry) {
      entry = {
        ref: new WeakRef(creature),
        operators: new Set<string>(),
        baselineScore: undefined,
        evaluated: false,
        evaluationMs: 0,
        generationsPending: 0,
        dropped: false,
      };
      this.pendingByCreature.set(creature, entry);
      this.pending.push(entry);
    }
    return entry;
  }

  /**
   * Detach an entry from its creature. The record stays in `pending` with its
   * `dropped` flag set and is swept at the next finalise, keeping the drop
   * O(1) rather than an O(n) array search on a hot path.
   */
  private dropEntry(creature: Creature, entry: PendingOffspring): void {
    entry.dropped = true;
    this.pendingByCreature.delete(creature);
  }

  /**
   * Baseline score for a creature about to be mutated: its own score, then its
   * `score` tag, then the parent score recorded by the breeding phase. A
   * freshly bred offspring has none of its own, which is why the parent lookup
   * exists.
   */
  private resolveBaseline(creature: Creature): number | undefined {
    if (creature.score !== undefined && Number.isFinite(creature.score)) {
      return creature.score;
    }
    const scoreTag = getTag(creature, "score");
    if (scoreTag) {
      const parsed = parseFloat(scoreTag);
      if (Number.isFinite(parsed)) return parsed;
    }
    const parentScore = this.parentBaselines?.get(creature);
    if (parentScore !== undefined && Number.isFinite(parentScore)) {
      return parentScore;
    }
    return undefined;
  }
}
