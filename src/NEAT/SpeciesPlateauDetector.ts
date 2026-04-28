/**
 * SpeciesPlateauDetector.ts - Per-species fitness stagnation tracking
 * (Issue #2454).
 *
 * Tracks the high-water-mark best raw fitness for every species across
 * generations. When a species fails to improve for `haltWindow`
 * generations it is considered "halted" and its breeding share is
 * halved; when it stays flat for `extinctionWindow` generations it is
 * considered "extinct" and dropped from the breeding pool entirely.
 * Reclaimed breeding slots are redistributed proportionally to the
 * remaining (still-progressing) species so the global breeding budget
 * is preserved.
 */

import type { Genus } from "@neat/Genus.ts";
import type { RequiredSpeciesStagnationConfig } from "@config/SpeciesStagnationConfig.ts";

/** Stagnation classification for a species. */
export type SpeciesStagnationStatus = "active" | "halted" | "extinct";

/**
 * Per-species rolling state used to determine stagnation classification.
 *
 * `bestEverFitness` is the high-water mark across every generation
 * recorded so far for this species. `generationsSinceImprovement` is
 * the count of consecutive generations whose best raw fitness did not
 * exceed the high-water mark — i.e. the size of the current flat window.
 */
interface SpeciesHistoryEntry {
  bestEverFitness: number;
  generationsSinceImprovement: number;
}

/**
 * Tracks per-species best-fitness history and classifies each species
 * as `active`, `halted`, or `extinct` based on the configured windows.
 */
export class SpeciesPlateauDetector {
  private readonly config: RequiredSpeciesStagnationConfig;
  private readonly history = new Map<string, SpeciesHistoryEntry>();

  constructor(config: RequiredSpeciesStagnationConfig) {
    this.config = config;
  }

  /**
   * Record one generation worth of best-fitness statistics for every
   * species in the genus. Call after `genus.updateSpeciesStatistics()`
   * each generation. A non-finite `bestRawFitness` (e.g. an unscored or
   * panicked species) is skipped — it neither resets nor advances the
   * counter so that transient evaluation issues do not poison the
   * stagnation signal.
   */
  recordGeneration(genus: Genus): void {
    if (!this.config.enabled) return;
    genus.speciesMap.forEach((species) => {
      const best = species.bestRawFitness;
      if (!Number.isFinite(best)) return;
      this.recordSpecies(species.speciesKey, best);
    });
  }

  /**
   * Record a single species observation. Exposed for testing and so
   * callers can drive the detector without a full Genus when only the
   * stagnation logic matters.
   */
  recordSpecies(speciesKey: string, bestRawFitness: number): void {
    if (!this.config.enabled) return;
    if (!Number.isFinite(bestRawFitness)) return;

    const prior = this.history.get(speciesKey);
    if (!prior) {
      this.history.set(speciesKey, {
        bestEverFitness: bestRawFitness,
        generationsSinceImprovement: 0,
      });
      return;
    }

    if (bestRawFitness > prior.bestEverFitness) {
      prior.bestEverFitness = bestRawFitness;
      prior.generationsSinceImprovement = 0;
    } else {
      prior.generationsSinceImprovement += 1;
    }
  }

  /**
   * Number of consecutive generations the named species has spent at
   * or below its high-water mark. Returns 0 for species that have
   * never been recorded (a fresh species starts fully active).
   */
  getStagnantGenerations(speciesKey: string): number {
    const entry = this.history.get(speciesKey);
    return entry ? entry.generationsSinceImprovement : 0;
  }

  /**
   * Classify a species as `active`, `halted`, or `extinct` using the
   * configured windows. When stagnation detection is disabled, every
   * species is reported as `active`.
   */
  getStatus(speciesKey: string): SpeciesStagnationStatus {
    if (!this.config.enabled) return "active";
    const stagnant = this.getStagnantGenerations(speciesKey);
    if (stagnant >= this.config.extinctionWindow) return "extinct";
    if (stagnant >= this.config.haltWindow) return "halted";
    return "active";
  }

  /**
   * Drop history for any species not present in the supplied set.
   * Useful when a species has gone extinct in the population sense
   * (no surviving members) so its history would otherwise leak.
   */
  pruneAbsent(activeSpeciesKeys: Iterable<string>): void {
    const keep = new Set(activeSpeciesKeys);
    for (const key of [...this.history.keys()]) {
      if (!keep.has(key)) this.history.delete(key);
    }
  }

  /** Reset all per-species history. */
  reset(): void {
    this.history.clear();
  }
}

/**
 * Apply stagnation-based reductions to a per-species breeding quota
 * map. Halted species lose half their slots (rounded down); extinct
 * species lose all of them. Reclaimed slots are redistributed
 * proportionally to the remaining `active` species using the largest-
 * fractional-part rule for determinism. When no `active` species
 * remain, slots are redistributed to `halted` species in the same way
 * so the population still receives offspring. Quotas for species that
 * are not present in the input map are not introduced.
 *
 * The total of the returned map equals the total of the input map
 * exactly. When stagnation detection is disabled (or every species is
 * `active`), the input map is returned as-is without modification.
 *
 * @param quotas - Per-species quotas from `allocateBreedingQuotas`
 * @param detector - Per-species stagnation tracker
 * @returns A new quota map with stagnation reductions applied
 */
export function applyStagnationToQuotas(
  quotas: ReadonlyMap<string, number>,
  detector: SpeciesPlateauDetector,
): Map<string, number> {
  const result = new Map<string, number>();
  if (quotas.size === 0) return result;

  let totalIn = 0;
  let reclaimed = 0;
  // Active recipients keep full quota and become candidates for redistribution.
  const activeKeys: string[] = [];
  // Halted recipients keep half quota and become fallback recipients
  // when no active species are available.
  const haltedKeys: string[] = [];

  for (const [speciesKey, quota] of quotas) {
    totalIn += quota;
    const status = detector.getStatus(speciesKey);
    if (status === "extinct") {
      result.set(speciesKey, 0);
      reclaimed += quota;
      continue;
    }
    if (status === "halted") {
      const kept = Math.floor(quota / 2);
      const lost = quota - kept;
      result.set(speciesKey, kept);
      reclaimed += lost;
      haltedKeys.push(speciesKey);
      continue;
    }
    // active
    result.set(speciesKey, quota);
    activeKeys.push(speciesKey);
  }

  if (reclaimed <= 0) {
    // Defensive: total must round-trip even when nothing is reclaimed.
    return result;
  }

  const recipients = activeKeys.length > 0 ? activeKeys : haltedKeys;
  if (recipients.length === 0) {
    // Nowhere to send the reclaimed slots — return them to the
    // largest input-quota species so the global budget is preserved.
    let bestKey: string | undefined;
    let bestQuota = -1;
    for (const [speciesKey, quota] of quotas) {
      if (quota > bestQuota) {
        bestQuota = quota;
        bestKey = speciesKey;
      }
    }
    if (bestKey !== undefined) {
      result.set(bestKey, (result.get(bestKey) ?? 0) + reclaimed);
    }
    // Sanity: total preserved.
    return enforceTotal(result, totalIn);
  }

  // Proportional redistribution by current quota share among recipients.
  const recipientShareTotal = recipients.reduce(
    (sum, key) => sum + (result.get(key) ?? 0),
    0,
  );

  interface AllocationRow {
    speciesKey: string;
    integerPart: number;
    fractionalPart: number;
  }
  const rows: AllocationRow[] = [];
  let assigned = 0;

  if (recipientShareTotal > 0) {
    for (const key of recipients) {
      const share = (result.get(key) ?? 0) / recipientShareTotal;
      const exact = share * reclaimed;
      const integerPart = Math.floor(exact);
      const fractionalPart = exact - integerPart;
      rows.push({ speciesKey: key, integerPart, fractionalPart });
      assigned += integerPart;
    }
  } else {
    // Even split when current shares are all zero (edge case where
    // every active recipient already had quota 0 — possible when a
    // small minSpeciesSlots floor was zero and proportional allocation
    // rounded everyone down).
    const even = Math.floor(reclaimed / recipients.length);
    for (const key of recipients) {
      rows.push({ speciesKey: key, integerPart: even, fractionalPart: 0 });
      assigned += even;
    }
  }

  let leftover = reclaimed - assigned;
  if (leftover > 0) {
    const ordered = [...rows].sort((a, b) => {
      if (b.fractionalPart !== a.fractionalPart) {
        return b.fractionalPart - a.fractionalPart;
      }
      return a.speciesKey.localeCompare(b.speciesKey);
    });
    for (const row of ordered) {
      if (leftover === 0) break;
      row.integerPart += 1;
      leftover -= 1;
    }
  }

  for (const row of rows) {
    result.set(
      row.speciesKey,
      (result.get(row.speciesKey) ?? 0) + row.integerPart,
    );
  }

  return enforceTotal(result, totalIn);
}

/**
 * Defensive helper: if integer rounding has introduced any drift from
 * the input total, push or pull a single slot from the largest entry
 * so callers can rely on the round-trip invariant.
 */
function enforceTotal(
  result: Map<string, number>,
  expectedTotal: number,
): Map<string, number> {
  let actual = 0;
  for (const v of result.values()) actual += v;
  const drift = expectedTotal - actual;
  if (drift === 0) return result;

  // Find the entry with the largest current value to absorb drift.
  let bestKey: string | undefined;
  let bestQuota = -Infinity;
  for (const [k, v] of result) {
    if (v > bestQuota) {
      bestQuota = v;
      bestKey = k;
    }
  }
  if (bestKey !== undefined) {
    result.set(bestKey, Math.max(0, (result.get(bestKey) ?? 0) + drift));
  }
  return result;
}
