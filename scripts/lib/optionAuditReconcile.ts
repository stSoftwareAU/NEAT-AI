/**
 * Mechanical coverage check for the #3505 roll-up (Issue #3525).
 *
 * Diffs the #3518 harness key inventory against the merged classification
 * table in `optionAuditRollup.ts`. A key the harness enumerates but the table
 * does not classify is a **gap**, and a gap is reported loudly rather than
 * rendered as an absent table row — the roll-up must not close #3505 while one
 * exists.
 */

import type { OptionKeyRow } from "./optionInventory.ts";
import type { RollupEntry, Verdict } from "./optionAuditRollup.ts";

/** One enumerated key with the verdict the merged table gives it. */
export interface ClassifiedRow {
  row: OptionKeyRow;
  entry: RollupEntry;
  verdict: Verdict;
  issue?: number;
}

/** A key the harness found that the merged table does not classify. */
export interface Gap {
  reason: "unclassified top-level key" | "unclassified config interface";
  detail: string;
}

/** Result of diffing the inventory against the merged table. */
export interface ReconcileResult {
  classified: ClassifiedRow[];
  gaps: Gap[];
  /** Roll-up entries describing a key or interface the source no longer has. */
  orphans: string[];
}

/** Verdict for one field of `entry`, honouring its overrides. */
function fieldVerdict(
  entry: RollupEntry,
  field: string,
): { verdict: Verdict; issue?: number } {
  const override = entry.fieldOverrides?.[field];
  if (override) return { verdict: override.verdict, issue: override.issue };
  const verdict = entry.fieldDefault ?? entry.verdict;
  // A field inherits its parent's issue only when it also inherits the parent's
  // QUALIFIES verdict — a KEEP field of a QUALIFIES parent carries no issue.
  return {
    verdict,
    issue: verdict === "QUALIFIES" ? entry.issue : undefined,
  };
}

/**
 * Diff the enumerated inventory against the merged classification table.
 *
 * Never throws on an unclassified key: it is collected as a gap so the caller
 * can report every one of them at once and exit non-zero.
 */
export function reconcile(
  rows: readonly OptionKeyRow[],
  entries: readonly RollupEntry[],
): ReconcileResult {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const byInterface = new Map<string, RollupEntry>();
  for (const entry of entries) {
    for (const iface of entry.interfaces ?? []) byInterface.set(iface, entry);
  }

  const classified: ClassifiedRow[] = [];
  const gaps: Gap[] = [];
  const seenKeys = new Set<string>();
  const seenInterfaces = new Set<string>();

  for (const row of rows) {
    if (row.slice === "top-level") {
      const entry = byKey.get(row.key);
      if (!entry) {
        gaps.push({ reason: "unclassified top-level key", detail: row.key });
        continue;
      }
      seenKeys.add(entry.key);
      classified.push({
        row,
        entry,
        verdict: entry.verdict,
        issue: entry.verdict === "QUALIFIES" ? entry.issue : undefined,
      });
      continue;
    }

    const iface = `${row.ownerFile}::${row.owner}`;
    const entry = byInterface.get(iface);
    if (!entry) {
      gaps.push({ reason: "unclassified config interface", detail: iface });
      continue;
    }
    seenKeys.add(entry.key);
    seenInterfaces.add(iface);
    classified.push({ row, entry, ...fieldVerdict(entry, row.key) });
  }

  const orphans: string[] = [];
  for (const entry of entries) {
    if (!entry.internal && !seenKeys.has(entry.key)) orphans.push(entry.key);
    for (const iface of entry.interfaces ?? []) {
      if (!seenInterfaces.has(iface)) orphans.push(iface);
    }
  }

  return { classified, gaps, orphans: orphans.sort() };
}

const VERDICT_ORDER: Verdict[] = ["QUALIFIES", "KEEP", "IN USE"];

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|");
}

/** Render the merged classification table, gaps included, as markdown. */
export function toConsolidatedMarkdown(result: ReconcileResult): string {
  const out: string[] = [];

  const counts = new Map<Verdict, number>();
  for (const c of result.classified) {
    counts.set(c.verdict, (counts.get(c.verdict) ?? 0) + 1);
  }

  out.push("| Verdict | Classifications |");
  out.push("| --- | ---: |");
  for (const verdict of VERDICT_ORDER) {
    out.push(`| \`${verdict}\` | ${counts.get(verdict) ?? 0} |`);
  }
  out.push(`| **Total** | **${result.classified.length}** |`);
  out.push("");

  out.push("| Key | Slice | Verdict | Issue | Note |");
  out.push("| --- | --- | --- | --- | --- |");
  // One row per key, not per field: fields inherit unless overridden, and the
  // overrides are rendered as their own rows so nothing is hidden.
  const seen = new Set<string>();
  for (const c of result.classified) {
    const label = c.row.slice === "top-level"
      ? c.row.key
      : `${c.entry.key}.${c.row.key}`;
    const isParentRow = c.row.slice === "top-level";
    const isOverride = c.entry.fieldOverrides?.[c.row.key] !== undefined;
    if (!isParentRow && !isOverride) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    const issue = c.issue ? `#${c.issue}` : "—";
    const note = isParentRow ? c.entry.note ?? "" : "";
    out.push(
      `| \`${label}\` | ${c.entry.slice} | \`${c.verdict}\` | ${issue} | ${
        escapeCell(note)
      } |`,
    );
  }

  // Internal configs have no NeatOptions key, so they have no top-level row.
  for (const entry of new Set(result.classified.map((c) => c.entry))) {
    if (!entry.internal || seen.has(entry.key)) continue;
    seen.add(entry.key);
    out.push(
      `| \`${entry.key}\` | ${entry.slice} | \`${entry.verdict}\` | ${
        entry.issue ? `#${entry.issue}` : "—"
      } | ${escapeCell(entry.note ?? "")} |`,
    );
  }

  if (result.gaps.length > 0) {
    out.push("");
    out.push(`## ⚠️ Coverage gaps — ${result.gaps.length}`);
    out.push("");
    out.push("| Gap | Detail |");
    out.push("| --- | --- |");
    for (const gap of result.gaps) {
      out.push(`| ${gap.reason} | \`${escapeCell(gap.detail)}\` |`);
    }
  }

  return out.join("\n");
}
