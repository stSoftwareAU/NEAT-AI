/**
 * Discovery Evaluation Summary Module
 *
 * Records and logs evaluation summaries for discovery candidates,
 * including persisting candidate creatures to archive directories
 * and formatted logging of evaluation results.
 *
 * Extracted from DiscoveryRunner.ts as part of #1598.
 */

import { bold, cyan, green, yellow } from "@std/fmt/colors";
import { join } from "@std/path/join";
import type { Creature } from "../Creature.ts";
import { getLogger } from "../utils/Logger.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import type {
  DiscoveredNeuronDetails,
  DiscoveryChangeType,
} from "./DiscoveryCandidates.ts";
import { formatErrorDelta } from "./DiscoveryFormatting.ts";

export interface DiscoveryEvaluationSummary {
  kind: "original" | "candidate";
  changeType?: DiscoveryChangeType;
  description?: string;
  score: number;
  error: number;
  scoreDelta?: number;
  improved: boolean;
  archivePath?: string;
  errorDelta?: number;
  errorDeltaPct?: number;
  /** Details of discovered neuron (for single neuron candidates). */
  neuronDetails?: DiscoveredNeuronDetails;
}

export interface RecordEvaluationSummariesParams {
  discoveryID: string;
  evaluationResults: Array<{
    kind: "original" | "candidate";
    candidate?: DiscoveryCandidate;
    error: number;
    score: number;
  }>;
  originalScore: number;
  originalError: number;
  baseCreature: Creature;
}

function sanitizeSegment(value: string): string {
  const lowered = value.toLowerCase();
  const cleaned = lowered.replace(/[^a-z0-9._-]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );
  return cleaned.length > 0 ? cleaned : "entry";
}

function makeArchiveTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeRealPath(path: string): string {
  try {
    return Deno.realPathSync(path);
  } catch {
    return path;
  }
}

/**
 * Records evaluation summaries for all discovery candidates.
 *
 * Persists candidate creatures to an archive directory and builds
 * summary records for each evaluation result.
 */
export function recordEvaluationSummaries(
  params: RecordEvaluationSummariesParams,
): { summaries: DiscoveryEvaluationSummary[]; archiveDir?: string } {
  const {
    discoveryID,
    evaluationResults,
    originalScore,
    originalError,
    baseCreature,
  } = params;
  const summaries: DiscoveryEvaluationSummary[] = [];
  const labelCounts = new Map<string, number>();

  let archiveDir: string | undefined;
  let resolvedArchiveDir: string | undefined;

  const ensureArchiveDir = (): string | undefined => {
    if (archiveDir) return archiveDir;

    const safeDiscoveryID = sanitizeSegment(discoveryID || "discovery");
    const timestamp = makeArchiveTimestamp();
    const targetDir = join(
      ".discovery",
      "candidates",
      safeDiscoveryID,
      timestamp,
    );
    try {
      Deno.mkdirSync(targetDir, { recursive: true });
      archiveDir = targetDir;
      resolvedArchiveDir = safeRealPath(targetDir);
    } catch (error) {
      getLogger().warn(
        "[DiscoveryRunner] Failed to create discovery candidate archive:",
        error,
      );
      archiveDir = undefined;
    }
    return archiveDir;
  };

  const persistCreature = (
    baseLabel: string,
    payload: Record<string, unknown>,
  ): string | undefined => {
    const dir = ensureArchiveDir();
    if (!dir) {
      return undefined;
    }
    try {
      const safeLabel = sanitizeSegment(baseLabel);
      const index = (labelCounts.get(safeLabel) ?? 0) + 1;
      labelCounts.set(safeLabel, index);
      const suffix = index === 1 ? "" : `-${index}`;
      const filePath = join(dir, `${safeLabel}${suffix}.json`);
      Deno.writeTextFileSync(filePath, JSON.stringify(payload, null, 1));
      return safeRealPath(filePath);
    } catch (error) {
      getLogger().warn(
        `[DiscoveryRunner] Failed to persist discovery candidate '${baseLabel}':`,
        error,
      );
      return undefined;
    }
  };

  const originalExport = baseCreature.exportJSON();

  for (const evaluation of evaluationResults) {
    const changeType = evaluation.candidate?.change.type;
    const scoreDelta = evaluation.score - originalScore;
    const improved = evaluation.kind === "candidate" && scoreDelta > 0;
    const errorDelta = originalError - evaluation.error;
    const errorDeltaPct = originalError === 0
      ? evaluation.error === 0 ? 0 : -100
      : (errorDelta / originalError) * 100;

    let archivePath: string | undefined;
    const exportPayload = evaluation.kind === "original"
      ? originalExport
      : evaluation.candidate?.creature.exportJSON();

    if (exportPayload) {
      const label = evaluation.kind === "original"
        ? "original"
        : `candidate-${changeType ?? "unknown"}`;
      archivePath = persistCreature(label, {
        kind: evaluation.kind,
        changeType,
        score: evaluation.score,
        error: evaluation.error,
        scoreDelta,
        improved,
        errorDelta,
        errorDeltaPct,
        creature: exportPayload,
      });
    }

    summaries.push({
      kind: evaluation.kind,
      changeType,
      description: evaluation.candidate?.change.description,
      score: evaluation.score,
      error: evaluation.error,
      scoreDelta,
      improved,
      archivePath,
      errorDelta,
      errorDeltaPct,
      neuronDetails: evaluation.candidate?.change.neuronDetails,
    });
  }

  if (archiveDir) {
    try {
      const summaryPath = join(archiveDir, "summary.json");
      Deno.writeTextFileSync(summaryPath, JSON.stringify(summaries, null, 1));
    } catch (error) {
      getLogger().warn(
        "[DiscoveryRunner] Failed to persist discovery evaluation summary:",
        error,
      );
    }
  }

  return {
    summaries,
    archiveDir: resolvedArchiveDir ?? archiveDir,
  };
}

/**
 * Logs a formatted evaluation summary table for a discovery run.
 */
export function logEvaluationSummary(
  params: { discoveryID: string; summaries: DiscoveryEvaluationSummary[] },
): void {
  const { discoveryID, summaries } = params;
  if (!summaries || summaries.length === 0) {
    return;
  }

  // Separate original from candidates
  const original = summaries.find((s) => s.kind === "original");
  const candidates = summaries.filter((s) => s.kind === "candidate");

  // Sort candidates by actual improvement (scoreDelta descending)
  candidates.sort((a, b) => (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0));

  // Identify the best candidate (highest score delta)
  const bestCandidate = candidates.length > 0 ? candidates[0] : undefined;

  getLogger().info(
    `[DiscoveryRunner] ${bold(`Discovery ${discoveryID} evaluation summary:`)}`,
  );

  // Log original first
  if (original) {
    logSingleSummary(original, false);
  }

  // Log candidates (sorted by expected improvement)
  for (const summary of candidates) {
    const isBest = summary === bestCandidate;
    logSingleSummary(summary, isBest);
  }
}

/**
 * Logs a single evaluation summary line.
 */
export function logSingleSummary(
  summary: DiscoveryEvaluationSummary,
  isBest: boolean,
): void {
  const label = summary.kind === "original"
    ? cyan("Original creature")
    : `Candidate (${summary.changeType ?? "unknown"})`;

  // Build description, including added neuron short ID if available
  let description = summary.description ? ` ${summary.description}` : "";
  if (summary.neuronDetails?.addedNeuronShortID) {
    description += ` [${summary.neuronDetails.addedNeuronShortID}]`;
  }

  // Format error delta with both absolute value and percentage
  let errorDeltaText: string;
  if (summary.kind === "original") {
    errorDeltaText = cyan("baseline");
  } else {
    const pctText = formatErrorDelta(summary.errorDeltaPct ?? 0);
    // Show absolute error delta as well
    if (summary.errorDelta !== undefined && summary.errorDelta !== 0) {
      const sign = summary.errorDelta >= 0 ? "+" : "";
      errorDeltaText = `Δerr=${sign}${
        summary.errorDelta.toPrecision(3)
      } (${pctText})`;
    } else {
      errorDeltaText = pctText;
    }
  }

  const scoreText = `score=${summary.score.toPrecision(4)}`;
  const scoreDeltaText = summary.kind === "candidate" &&
      summary.scoreDelta !== undefined
    ? ` Δscore=${summary.scoreDelta >= 0 ? "+" : ""}${
      summary.scoreDelta.toPrecision(3)
    }`
    : "";
  const improvedText = summary.kind === "candidate"
    ? ` ${summary.improved ? green("✓improved") : yellow("no-improvement")}`
    : "";

  const bestMarker = isBest ? bold(cyan(" ★BEST")) : "";

  const mainInfo = summary.kind === "original"
    ? `error=${summary.error.toPrecision(6)} ${scoreText} ${errorDeltaText}`
    : `error=${
      summary.error.toPrecision(6)
    } ${scoreText}${scoreDeltaText}${improvedText} ${errorDeltaText}${bestMarker}`;

  getLogger().info(
    `[DiscoveryRunner]   ${label}${description}: ${mainInfo}`,
  );

  // Log full neuron details for ALL candidates with neuron details
  // This helps identify patterns in why discoveries aren't improving
  if (summary.neuronDetails) {
    const nd = summary.neuronDetails;
    const prefix = isBest ? "★ " : "  ";
    getLogger().info(
      `[DiscoveryRunner]     ${prefix}neuron: ` +
        `from=${nd.fromNeuronUuid} to=${nd.toNeuronUuid} ` +
        `squash=${nd.squash} ` +
        `inW=${nd.incomingWeight.toFixed(3)} outW=${
          nd.outgoingWeight.toFixed(3)
        } ` +
        `bias=${nd.bias.toFixed(3)}`,
    );
  }

  if (summary.archivePath) {
    getLogger().info(
      `[DiscoveryRunner]     Saved creature at ${summary.archivePath}`,
    );
  }
}
