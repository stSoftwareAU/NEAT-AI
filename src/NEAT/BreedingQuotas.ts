/**
 * BreedingQuotas.ts - Per-species breeding-slot allocation for NEAT
 * fitness sharing (Issue #2453).
 *
 * Standard NEAT (Stanley & Miikkulainen, 2002) allocates the next
 * generation's breeding slots in proportion to each species' summed
 * adjusted fitness, so a niche generating 30% of the adjusted-fitness
 * total breeds ~30% of the offspring. Without this, a numerous species
 * starves smaller niches even when the niche-mean fitness is competitive.
 *
 * The allocation rounds proportionally and distributes the remainder
 * largest-fractional-part first, then enforces a per-species floor
 * (`minSpeciesSlots`) so every non-empty species is guaranteed a chance.
 * The total returned slots always equals the requested `totalSlots`.
 */

import type { Genus } from "@neat/Genus.ts";

/**
 * Build per-species breeding quotas in proportion to summed adjusted
 * fitness, with a per-species floor.
 *
 * The total of the returned values equals `totalSlots` exactly. Quotas
 * are always non-negative integers. Species with zero size or
 * non-finite fitness are skipped (no quota entry is returned for them).
 *
 * @param genus - The genus, after `updateSpeciesStatistics()` has run
 * @param totalSlots - Total breeding slots to allocate this generation
 * @param minSpeciesSlots - Minimum slots guaranteed per non-empty species
 * @returns A map from speciesKey to allocated breeding slots
 */
export function allocateBreedingQuotas(
  genus: Genus,
  totalSlots: number,
  minSpeciesSlots: number,
): Map<string, number> {
  const quotas = new Map<string, number>();
  if (totalSlots <= 0) return quotas;

  // Collect non-empty species and their summed adjusted fitness.
  // Per Issue #2453: summed adjusted fitness for a species is the sum
  // over its members of (rawFitness / speciesSize), which equals the
  // species' meanRawFitness when all members have a finite score.
  // We use bestRawFitness / size for species that have no usable mean
  // (size 1 or all-equal scores) — the value is still proportional to
  // niche dominance and matches the telemetry signal in Issue #2452.
  interface SpeciesEntry {
    speciesKey: string;
    size: number;
    summedAdjusted: number;
  }
  const entries: SpeciesEntry[] = [];
  let totalAdjusted = 0;
  genus.speciesMap.forEach((species) => {
    const size = species.size > 0 ? species.size : species.creatures.length;
    if (size === 0) return;
    // summedAdjusted = sum_i(rawFitness_i / size) = meanRawFitness when
    // every member has a finite score. Fall back to bestRawFitness /
    // size if meanRawFitness is non-finite (unscored creatures).
    let summed = species.meanRawFitness;
    if (!Number.isFinite(summed)) {
      summed = Number.isFinite(species.bestRawFitness)
        ? species.bestRawFitness / size
        : 0;
    }
    entries.push({
      speciesKey: species.speciesKey,
      size,
      summedAdjusted: summed,
    });
    totalAdjusted += summed;
  });

  if (entries.length === 0) return quotas;

  const floor = Math.max(0, Math.floor(minSpeciesSlots));
  // Apply the floor first so we know the residual budget available for
  // proportional distribution.
  const flooredTotal = floor * entries.length;
  if (flooredTotal >= totalSlots) {
    // Floors alone exceed the budget — distribute slots one-per-species
    // until we run out, in deterministic key order.
    const sorted = [...entries].sort((a, b) =>
      a.speciesKey.localeCompare(b.speciesKey)
    );
    let remaining = totalSlots;
    let cursor = 0;
    while (remaining > 0) {
      const e = sorted[cursor % sorted.length];
      quotas.set(e.speciesKey, (quotas.get(e.speciesKey) ?? 0) + 1);
      remaining--;
      cursor++;
      // Stop after each entry has at most `floor` slots — but when budget
      // is short, distribute as evenly as possible.
      if (cursor >= sorted.length * floor && floor > 0) break;
    }
    return quotas;
  }

  const residual = totalSlots - flooredTotal;

  // Proportional allocation of the residual against summed adjusted
  // fitness. When no species has positive summed adjusted fitness
  // (all zero/negative), distribute the residual evenly.
  const positiveTotal = totalAdjusted > 0
    ? totalAdjusted
    : entries.reduce((sum, e) => sum + Math.max(0, e.summedAdjusted), 0);

  interface AllocationRow {
    speciesKey: string;
    integerPart: number;
    fractionalPart: number;
  }
  const rows: AllocationRow[] = [];
  let assigned = 0;

  if (positiveTotal > 0) {
    for (const e of entries) {
      const share = Math.max(0, e.summedAdjusted) / positiveTotal;
      const exact = share * residual;
      const integerPart = Math.floor(exact);
      const fractionalPart = exact - integerPart;
      rows.push({
        speciesKey: e.speciesKey,
        integerPart,
        fractionalPart,
      });
      assigned += integerPart;
    }
  } else {
    // Even split when nothing has positive fitness (e.g. cold start).
    const even = Math.floor(residual / entries.length);
    for (const e of entries) {
      rows.push({
        speciesKey: e.speciesKey,
        integerPart: even,
        fractionalPart: 0,
      });
      assigned += even;
    }
  }

  // Distribute the leftover (residual - assigned) by largest fractional
  // part first; ties broken by species key for determinism.
  let leftover = residual - assigned;
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
    quotas.set(row.speciesKey, floor + row.integerPart);
  }
  return quotas;
}
