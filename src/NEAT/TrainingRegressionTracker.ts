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
 * The tracker also exposes aggregate counters (`totalRegressions`,
 * `totalImprovements`, `totalSkipped`) for lifecycle logging and tests.
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

export class TrainingRegressionTracker {
  readonly entries: Map<string, TrainingRegressionEntry> = new Map();

  /** Cumulative count of regressions recorded since construction. */
  totalRegressions = 0;
  /** Cumulative count of improvements (or fine-tune successes) recorded. */
  totalImprovements = 0;
  /** Cumulative count of training attempts skipped by {@link shouldSkip}. */
  totalSkipped = 0;

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
    this.pruneIfLarge();
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
  }

  /**
   * Record that a training attempt was skipped by {@link shouldSkip}. Used
   * purely for metrics — does not modify per-UUID history.
   */
  recordSkip(): void {
    this.totalSkipped++;
  }

  /**
   * Fraction of recorded training outcomes (excluding skipped attempts) that
   * were regressions. Returns `0` when no outcomes have been recorded.
   */
  regressionRate(): number {
    const total = this.totalRegressions + this.totalImprovements;
    return total === 0 ? 0 : this.totalRegressions / total;
  }

  /** Reset all counters and history. Primarily used in tests. */
  reset(): void {
    this.entries.clear();
    this.totalRegressions = 0;
    this.totalImprovements = 0;
    this.totalSkipped = 0;
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
