/**
 * Discovery Diagnostics Module
 *
 * Aggregates per-changeType success/failure rates from discovery
 * candidate evaluation results. Provides a formatted summary table
 * for logging and optional file persistence for trend analysis.
 *
 * Part of #1735.
 */

import { getLogger } from "@utils/Logger.ts";
import type { EvaluationTaskResult } from "./DiscoveryRunnerEvaluation.ts";

/** Per-changeType diagnostics entry. */
export interface DiscoveryDiagnosticsEntry {
  /** Number of candidates evaluated for this change type. */
  evaluated: number;
  /** Number that improved on the original score. */
  improved: number;
  /** Success rate as a percentage (0–100). */
  successRate: number;
  /** Average score delta for successful candidates (0 if none). */
  averageScoreDelta: number;
}

/**
 * Aggregates per-changeType success/failure statistics from evaluation results.
 *
 * Only considers candidates (ignores original entries). Candidates without
 * a change type are skipped.
 */
export function aggregateDiscoveryDiagnostics(
  results: EvaluationTaskResult[],
  originalScore: number,
): Map<string, DiscoveryDiagnosticsEntry> {
  const accumulator = new Map<
    string,
    { evaluated: number; improved: number; totalSuccessDelta: number }
  >();

  for (const result of results) {
    if (result.kind !== "candidate") continue;
    const changeType = result.candidate?.change.type;
    if (!changeType) continue;

    let entry = accumulator.get(changeType);
    if (!entry) {
      entry = { evaluated: 0, improved: 0, totalSuccessDelta: 0 };
      accumulator.set(changeType, entry);
    }

    entry.evaluated++;
    if (result.score > originalScore) {
      entry.improved++;
      entry.totalSuccessDelta += result.score - originalScore;
    }
  }

  const diagnostics = new Map<string, DiscoveryDiagnosticsEntry>();
  for (const [changeType, acc] of accumulator) {
    diagnostics.set(changeType, {
      evaluated: acc.evaluated,
      improved: acc.improved,
      successRate: acc.evaluated > 0 ? (acc.improved / acc.evaluated) * 100 : 0,
      averageScoreDelta: acc.improved > 0
        ? acc.totalSuccessDelta / acc.improved
        : 0,
    });
  }

  return diagnostics;
}

/**
 * Formats diagnostics as a human-readable summary table.
 *
 * Returns an empty string when there are no entries.
 */
export function formatDiagnosticsTable(
  diagnostics: Map<string, DiscoveryDiagnosticsEntry>,
): string {
  if (diagnostics.size === 0) return "";

  const header =
    "  Change Type                  | Evaluated | Improved | Success Rate | Avg Score Delta";
  const separator =
    "  -----------------------------|-----------|----------|--------------|----------------";
  const rows: string[] = [];

  for (const [changeType, entry] of diagnostics) {
    const type = changeType.padEnd(29);
    const evaluated = String(entry.evaluated).padStart(9);
    const improved = String(entry.improved).padStart(8);
    const rate = `${entry.successRate.toFixed(1)}%`.padStart(13);
    const delta = entry.averageScoreDelta > 0
      ? `+${entry.averageScoreDelta.toPrecision(3)}`.padStart(15)
      : "—".padStart(15);
    rows.push(`  ${type} | ${evaluated} | ${improved} | ${rate} | ${delta}`);
  }

  return [header, separator, ...rows].join("\n");
}

/**
 * Logs the diagnostics summary table at info level.
 *
 * No-op when there are no diagnostics entries.
 */
export function logDiscoveryDiagnostics(
  discoveryID: string,
  diagnostics: Map<string, DiscoveryDiagnosticsEntry>,
): void {
  if (diagnostics.size === 0) return;

  const table = formatDiagnosticsTable(diagnostics);
  getLogger().info(
    `[DiscoveryRunner] Discovery ${discoveryID} candidate diagnostics:\n${table}`,
  );
}

/**
 * Persists diagnostics to a JSON file alongside the candidate archive.
 *
 * Writes to `{archiveDir}/diagnostics.json` for trend analysis.
 * Failures are logged as warnings — never throws.
 */
export function persistDiagnostics(
  archiveDir: string,
  discoveryID: string,
  diagnostics: Map<string, DiscoveryDiagnosticsEntry>,
): void {
  if (diagnostics.size === 0) return;

  const payload: Record<string, unknown> = {
    discoveryID,
    timestamp: new Date().toISOString(),
    changeTypes: Object.fromEntries(diagnostics),
  };

  try {
    const filePath = `${archiveDir}/diagnostics.json`;
    Deno.writeTextFileSync(filePath, JSON.stringify(payload, null, 1));
  } catch (error) {
    getLogger().warn(
      "[DiscoveryRunner] Failed to persist discovery diagnostics:",
      error,
    );
  }
}
