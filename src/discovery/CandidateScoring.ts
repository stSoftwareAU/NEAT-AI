/**
 * Candidate Scoring Module
 *
 * Handles expected improvement calculations for discovery candidates,
 * including weighted average summarisation and score-gain mapping.
 *
 * Extracted from DiscoveryCandidates.ts as part of #1473.
 */

/**
 * Compute a weighted-average expected improvement from candidate entries.
 *
 * Each entry's `expectedCreatureScoreGain` is weighted by its `totalCount`
 * (sample size). If no entry has a finite value the result is empty.
 */
export function summariseExpectedImprovement<
  T extends { expectedCreatureScoreGain: number; totalCount?: number },
>(
  entries?: readonly T[],
): { average?: number; sampleSize?: number } {
  if (!entries || entries.length === 0) return {};
  let weightedTotal = 0;
  let weightSum = 0;
  let sampleSize = 0;

  for (const entry of entries) {
    const value = entry.expectedCreatureScoreGain;
    if (Number.isFinite(value) === false) {
      continue;
    }
    const samples = Number.isFinite(entry.totalCount)
      ? Math.max(1, entry.totalCount ?? 1)
      : 1;
    weightedTotal += value * samples;
    weightSum += samples;
    if (Number.isFinite(entry.totalCount)) {
      sampleSize += entry.totalCount ?? 0;
    }
  }

  if (weightSum === 0) {
    return sampleSize > 0 ? { sampleSize } : {};
  }
  return {
    average: weightedTotal / weightSum,
    sampleSize: sampleSize > 0 ? sampleSize : undefined,
  };
}

/**
 * Map raw candidate entries into a normalised shape for `summariseExpectedImprovement`.
 *
 * @param entries   The raw candidate array
 * @param scale     Extracts the creature-level score gain from each entry
 * @param countSelector  Optional extractor for the sample count
 */
export function mapScaledSummaryEntries<T>(
  entries: readonly T[] | undefined,
  scale: (entry: T) => number | undefined,
  countSelector?: (entry: T) => number | undefined,
): Array<{ expectedCreatureScoreGain: number; totalCount?: number }> {
  if (!entries || entries.length === 0) return [];
  const mapped: Array<
    { expectedCreatureScoreGain: number; totalCount?: number }
  > = [];
  for (const entry of entries) {
    const scaled = scale(entry);
    if (scaled === undefined || Number.isFinite(scaled) === false) {
      continue;
    }
    mapped.push({
      expectedCreatureScoreGain: scaled,
      totalCount: countSelector ? countSelector(entry) : undefined,
    });
  }
  return mapped;
}
