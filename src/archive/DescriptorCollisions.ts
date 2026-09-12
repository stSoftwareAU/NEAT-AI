/**
 * DescriptorCollisions.ts — how blind is the descriptor? (Issue #3929)
 *
 * Two creatures with identical descriptors but materially different exact
 * scores mean the descriptor cannot see something that decides fitness. No
 * surrogate fitted to the archive can distinguish them either, so the incidence
 * of that case is a hard ceiling on how good any such model can be — and it is
 * worth knowing *before* a model is built rather than after it underperforms.
 *
 * This is the sanity check the archive owes its consumers. It reads records and
 * reports; it changes nothing.
 *
 * @module DescriptorCollisions
 */

import type { EvaluationArchiveRecord } from "@archive/EvaluationArchiveFormat.ts";

/** One group of records sharing a descriptor, and the score spread within it. */
export interface DescriptorCollisionGroup {
  /** The shared descriptor vector. */
  readonly descriptor: readonly number[];
  /** How many records share it. */
  readonly records: number;
  /** Lowest score in the group. */
  readonly minScore: number;
  /** Highest score in the group. */
  readonly maxScore: number;
  /** `maxScore - minScore`. */
  readonly spread: number;
}

/** The incidence report over a whole archive. */
export interface DescriptorCollisionReport {
  /** Records considered (every exact record supplied). */
  readonly records: number;
  /** Distinct descriptor vectors among them. */
  readonly distinctDescriptors: number;
  /** Descriptors held by more than one record. */
  readonly sharedDescriptors: number;
  /**
   * Descriptors held by more than one record where the score spread exceeds
   * `tolerance` — the blind spots.
   */
  readonly collidingDescriptors: number;
  /** Records belonging to a colliding descriptor. */
  readonly collidingRecords: number;
  /** `collidingRecords / records`, or `0` for an empty archive. */
  readonly incidence: number;
  /** Widest spread seen within any shared descriptor. */
  readonly maxSpread: number;
  /** The worst offenders, widest spread first. */
  readonly worstGroups: readonly DescriptorCollisionGroup[];
}

/**
 * Default score spread below which two identical descriptors are treated as
 * agreeing rather than colliding.
 *
 * `0` would make float noise look like blindness. On the GRQ lineage an
 * *accepted* improvement is around `1e-05`, so a spread at or under `1e-09` is
 * four orders of magnitude below anything selection can act on.
 */
export const DEFAULT_COLLISION_TOLERANCE = 1e-9;

/** How many groups the report keeps as examples. */
const WORST_GROUP_LIMIT = 10;

/**
 * Report the identical-descriptor / different-score incidence over `records`.
 *
 * Only exact records (`fidelity === 1`) are considered: a partial score and an
 * exact score differing is not evidence about the descriptor, it is evidence
 * about the corpus fraction.
 *
 * @param records - Archive records to analyse.
 * @param tolerance - Score spread treated as agreement. Defaults to
 *   {@link DEFAULT_COLLISION_TOLERANCE}.
 * @returns The incidence report.
 */
export function reportDescriptorCollisions(
  records: readonly EvaluationArchiveRecord[],
  tolerance: number = DEFAULT_COLLISION_TOLERANCE,
): DescriptorCollisionReport {
  const byDescriptor = new Map<string, {
    descriptor: readonly number[];
    records: number;
    minScore: number;
    maxScore: number;
  }>();

  let considered = 0;
  for (const record of records) {
    if (record.fidelity !== 1) continue;
    considered++;
    // JSON of the vector is an exact key: two vectors share it only when every
    // slot matches bit for bit, which is what "identical descriptor" means.
    const key = JSON.stringify(record.descriptor);
    const group = byDescriptor.get(key);
    if (group === undefined) {
      byDescriptor.set(key, {
        descriptor: record.descriptor,
        records: 1,
        minScore: record.score,
        maxScore: record.score,
      });
      continue;
    }
    group.records++;
    if (record.score < group.minScore) group.minScore = record.score;
    if (record.score > group.maxScore) group.maxScore = record.score;
  }

  let sharedDescriptors = 0;
  let collidingDescriptors = 0;
  let collidingRecords = 0;
  let maxSpread = 0;
  const groups: DescriptorCollisionGroup[] = [];
  for (const group of byDescriptor.values()) {
    if (group.records < 2) continue;
    sharedDescriptors++;
    const spread = group.maxScore - group.minScore;
    if (spread > maxSpread) maxSpread = spread;
    if (spread <= tolerance) continue;
    collidingDescriptors++;
    collidingRecords += group.records;
    groups.push({
      descriptor: group.descriptor,
      records: group.records,
      minScore: group.minScore,
      maxScore: group.maxScore,
      spread,
    });
  }
  groups.sort((a, b) => b.spread - a.spread);

  return {
    records: considered,
    distinctDescriptors: byDescriptor.size,
    sharedDescriptors,
    collidingDescriptors,
    collidingRecords,
    incidence: considered > 0 ? collidingRecords / considered : 0,
    maxSpread,
    worstGroups: groups.slice(0, WORST_GROUP_LIMIT),
  };
}

/**
 * Render a collision report as the operator-facing summary lines.
 *
 * @param report - The report to render.
 * @returns A multi-line human-readable summary.
 */
export function formatDescriptorCollisionReport(
  report: DescriptorCollisionReport,
): string {
  const percent = (report.incidence * 100).toFixed(3);
  const lines = [
    `exact records: ${report.records}`,
    `distinct descriptors: ${report.distinctDescriptors}`,
    `descriptors shared by >1 record: ${report.sharedDescriptors}`,
    `colliding descriptors (score spread > tolerance): ` +
    `${report.collidingDescriptors}`,
    `colliding records: ${report.collidingRecords} (${percent}% incidence)`,
    `widest spread within a shared descriptor: ${report.maxSpread}`,
  ];
  for (const group of report.worstGroups) {
    lines.push(
      `  spread ${group.spread} across ${group.records} records ` +
        `(${group.minScore} … ${group.maxScore})`,
    );
  }
  return lines.join("\n");
}
