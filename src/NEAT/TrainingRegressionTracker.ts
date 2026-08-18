/**
 * TrainingRegressionTracker.ts - Skip training for creatures that consistently
 * regress.
 *
 * Issue #2382: `GRQ-22-sloth.log` showed 217 "Training X caused a higher error"
 * events per run on the reference workload — every training cycle produced a
 * net regression that was silently rolled back. This tracker records per-UUID
 * regression outcomes so `scheduleTraining` can bypass creatures with a recent
 * history of regressions, instead of spending heavy worker cycles producing
 * another rollback.
 *
 * Issue #3779: the per-UUID streak alone is ineffective against population-wide
 * doom — creatures are trained at most once per run (#3553), so a single
 * creature's streak almost never reaches the threshold. The tracker therefore
 * also keeps a **population-wide** streak of consecutive no-progress outcomes
 * across every creature, which `scheduleTraining` can gate on.
 *
 * The tracker also exposes aggregate counters (`totalRegressions`,
 * `totalImprovements`, `totalNoChange`, `totalSkipped`) for lifecycle logging,
 * the `evolve*` result, and tests.
 */
export interface TrainingRegressionEntry {
  /**
   * Number of consecutive training attempts that worsened this creature's
   * error without producing a usable fine-tune variant. Reset to 0 on any
   * improvement or tuning success.
   */
  consecutiveRegressions: number;
  /** Epoch-ms timestamp of the most recent recorded outcome. */
  lastRecordedMS: number;
}

/**
 * Issue #2382: retention window for per-UUID regression history. Entries older
 * than this are pruned once the map grows beyond `MAX_ENTRIES`. Ten minutes is
 * longer than a typical training timeout but short enough that stale UUIDs do
 * not linger across long evolve runs.
 */
const RETENTION_MS = 10 * 60_000;
const MAX_ENTRIES = 1000;

/**
 * Issue #3779: while the population-wide gate is closed, one training dispatch
 * is let through every `POPULATION_PROBE_INTERVAL` skips. Without the probe no
 * outcome could ever be recorded again, so the gate could never reopen and
 * memetic evolution would be dead for the rest of the run — the same trap
 * Issue #2382's per-UUID skip fell into. Twenty turns ~17 doomed dispatches
 * (the GRQ #4064 observation) into one.
 */
export const POPULATION_PROBE_INTERVAL = 20;

export class TrainingRegressionTracker {
  readonly entries: Map<string, TrainingRegressionEntry> = new Map();

  /** Cumulative count of regressions recorded since construction. */
  totalRegressions = 0;
  /** Cumulative count of improvements (or fine-tune successes) recorded. */
  totalImprovements = 0;
  /** Cumulative count of training attempts skipped by {@link shouldSkip}. */
  totalSkipped = 0;
  /**
   * Cumulative count of training attempts that finished inside the noise floor
   * — neither a regression nor a material improvement (Issue #3779).
   */
  totalNoChange = 0;
  /**
   * Population-wide streak of consecutive training outcomes that made no
   * progress (a regression or a no-change), across *every* creature. Reset by
   * any material improvement anywhere in the population (Issue #3779).
   */
  populationConsecutiveNoProgress = 0;

  /** Skips issued since the last outcome was recorded (probe counter). */
  private skipsSinceProbe = 0;

  /**
   * Returns `true` if a further training attempt for `uuid` should be skipped
   * because this creature has already regressed {@link threshold} times in a
   * row without any improvement or fine-tune success.
   *
   * A `threshold` of `0` disables skipping entirely — the tracker still
   * records outcomes for metrics but never instructs callers to skip.
   */
  shouldSkip(uuid: string, threshold: number): boolean {
    if (threshold <= 0) return false;
    const entry = this.entries.get(uuid);
    if (!entry) return false;
    return entry.consecutiveRegressions >= threshold;
  }

  /**
   * Record that training for `uuid` produced a higher error and no fine-tune
   * variant recovered the loss. Increments the per-UUID streak and the
   * aggregate regression counter.
   */
  recordRegression(uuid: string): void {
    const entry = this.entries.get(uuid) ?? {
      consecutiveRegressions: 0,
      lastRecordedMS: 0,
    };
    entry.consecutiveRegressions++;
    entry.lastRecordedMS = Date.now();
    this.entries.set(uuid, entry);
    this.totalRegressions++;
    this.populationConsecutiveNoProgress++;
    this.skipsSinceProbe = 0;
    this.pruneIfLarge();
  }

  /**
   * Record that training for `uuid` finished inside the noise floor — the
   * error moved neither materially up nor down (Issue #3779).
   *
   * The per-creature streak is left untouched: a no-change is not a regression,
   * but it is certainly not the improvement that should clear the streak. The
   * population-wide streak advances, because the heavy worker slot bought
   * nothing.
   */
  recordNoChange(uuid: string): void {
    const entry = this.entries.get(uuid);
    if (entry) {
      entry.lastRecordedMS = Date.now();
    }
    this.totalNoChange++;
    this.populationConsecutiveNoProgress++;
    this.skipsSinceProbe = 0;
  }

  /**
   * Record that training for `uuid` improved the error or produced a usable
   * fine-tune variant. Resets the per-UUID streak so the creature becomes
   * eligible for training again.
   */
  recordImprovement(uuid: string): void {
    const entry = this.entries.get(uuid);
    if (entry) {
      entry.consecutiveRegressions = 0;
      entry.lastRecordedMS = Date.now();
    }
    this.totalImprovements++;
    this.populationConsecutiveNoProgress = 0;
    this.skipsSinceProbe = 0;
  }

  /**
   * Record that a training attempt was skipped by {@link shouldSkip} or
   * {@link shouldSkipPopulation}. Used for metrics and to advance the
   * population probe counter — does not modify per-UUID history.
   */
  recordSkip(): void {
    this.totalSkipped++;
    this.skipsSinceProbe++;
  }

  /**
   * Returns `true` when the whole population has made no progress for
   * {@link threshold} consecutive training outcomes and this dispatch should
   * therefore be skipped (Issue #3779).
   *
   * A `threshold` of `0` disables the gate. While the gate is closed one
   * dispatch is let through every {@link POPULATION_PROBE_INTERVAL} skips so a
   * population that becomes trainable again can reopen it.
   */
  shouldSkipPopulation(threshold: number): boolean {
    if (threshold <= 0) return false;
    if (this.populationConsecutiveNoProgress < threshold) return false;
    return this.skipsSinceProbe < POPULATION_PROBE_INTERVAL;
  }

  /** Skips issued since the last probe — `0` marks the start of a window. */
  get skipsSincePopulationProbe(): number {
    return this.skipsSinceProbe;
  }

  /**
   * Fraction of recorded training outcomes (excluding skipped attempts) that
   * were regressions. Returns `0` when no outcomes have been recorded.
   * No-change outcomes count towards the denominator (Issue #3779).
   */
  regressionRate(): number {
    const total = this.totalRegressions + this.totalImprovements +
      this.totalNoChange;
    return total === 0 ? 0 : this.totalRegressions / total;
  }

  /** Reset all counters and history. Primarily used in tests. */
  reset(): void {
    this.entries.clear();
    this.totalRegressions = 0;
    this.totalImprovements = 0;
    this.totalSkipped = 0;
    this.totalNoChange = 0;
    this.populationConsecutiveNoProgress = 0;
    this.skipsSinceProbe = 0;
  }

  private pruneIfLarge(): void {
    if (this.entries.size <= MAX_ENTRIES) return;
    const cutoff = Date.now() - RETENTION_MS;
    for (const [uuid, entry] of this.entries) {
      if (entry.lastRecordedMS < cutoff) {
        this.entries.delete(uuid);
      }
    }
  }
}
