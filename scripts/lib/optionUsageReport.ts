/**
 * Report rendering for the #3505 option-removal audit (Issue #3518).
 *
 * Emits `key → consumers that set it → verdict candidate` as CSV and markdown.
 * Silent omission is the failure mode to avoid, so every enumerated key appears
 * in the output — including as `UNKNOWN` when it could not be resolved.
 */

import type { OptionKeyRow } from "./optionInventory.ts";
import type { KeyVerdict, UsageStatus } from "./optionUsageScan.ts";

/** One row of the published inventory. */
export interface AuditRow {
  slice: string;
  ownerFile: string;
  owner: string;
  key: string;
  status: UsageStatus;
  /** Consumers that set the key. */
  setBy: string[];
  /** What a sibling slice should do next with this key. */
  verdictCandidate: string;
  /** Evidence paths, or the reason the key is unresolved. */
  detail: string;
}

/** Counts for the run summary. */
export interface AuditSummary {
  total: number;
  inUse: number;
  notSet: number;
  unknown: number;
}

const CANDIDATE_BY_STATUS: Record<UsageStatus, string> = {
  "IN USE": "KEEP (set by a consumer)",
  "not set": "REVIEW DEFAULT (may qualify for removal)",
  UNKNOWN: "UNKNOWN (unresolved — do not act)",
};

/** Join enumerated keys to their verdicts, one row per declaration site. */
export function buildRows(
  inventory: OptionKeyRow[],
  verdicts: KeyVerdict[],
): AuditRow[] {
  const byKey = new Map(verdicts.map((v) => [v.key, v]));
  return inventory.map((entry) => {
    const verdict = byKey.get(entry.key);
    if (!verdict) {
      return {
        ...entry,
        status: "UNKNOWN" as const,
        setBy: [],
        verdictCandidate: CANDIDATE_BY_STATUS.UNKNOWN,
        detail: "key was never scanned",
      };
    }
    const detail = verdict.status === "UNKNOWN"
      ? verdict.consumers
        .filter((c) => c.status === "UNKNOWN")
        .map((c) => `${c.repo}: ${c.notes.join("; ")}`)
        .join(" | ")
      : verdict.consumers.flatMap((c) =>
        c.evidence.map((e) => `${c.repo}:${e}`)
      ).join(" | ");
    return {
      ...entry,
      status: verdict.status,
      setBy: verdict.setBy,
      verdictCandidate: CANDIDATE_BY_STATUS[verdict.status],
      detail,
    };
  });
}

/** Count rows by status. */
export function summarise(rows: AuditRow[]): AuditSummary {
  return {
    total: rows.length,
    inUse: rows.filter((r) => r.status === "IN USE").length,
    notSet: rows.filter((r) => r.status === "not set").length,
    unknown: rows.filter((r) => r.status === "UNKNOWN").length,
  };
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Render the inventory as CSV. */
export function toCsv(rows: AuditRow[]): string {
  const header = [
    "slice",
    "owner_file",
    "owner_interface",
    "key",
    "status",
    "set_by",
    "verdict_candidate",
    "detail",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.slice,
        row.ownerFile,
        row.owner,
        row.key,
        row.status,
        row.setBy.join(" "),
        row.verdictCandidate,
        row.detail,
      ].map(csvField).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function mdCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** Render the inventory as a markdown table with a leading summary. */
export function toMarkdown(rows: AuditRow[], title: string): string {
  const summary = summarise(rows);
  const out = [
    `## ${title}`,
    "",
    `- Rows: **${summary.total}**`,
    `- \`IN USE\`: **${summary.inUse}**`,
    `- \`not set\`: **${summary.notSet}**`,
    `- \`UNKNOWN\`: **${summary.unknown}**`,
    "",
    "| slice | owner file | interface | key | status | set by | verdict candidate |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    out.push(
      `| ${mdCell(row.slice)} | \`${mdCell(row.ownerFile)}\` | \`${
        mdCell(row.owner)
      }\` | \`${mdCell(row.key)}\` | ${mdCell(row.status)} | ${
        mdCell(row.setBy.join(", ") || "—")
      } | ${mdCell(row.verdictCandidate)} |`,
    );
  }
  out.push("");
  return out.join("\n");
}
