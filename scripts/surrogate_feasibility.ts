/**
 * Issue #3930 — Stage 1: is a useful fitness surrogate possible at all?
 *
 * Issue #3929 made the training data exist; this is the study that asks
 * whether anything can be learnt from it. It fits every family in
 * `scripts/lib/surrogateModels.ts` to an evaluation archive, holds creatures
 * out **by lineage and by run**, and reports rank agreement, top-k agreement
 * and pair-ordering accuracy stratified by the true score gap — beside the
 * free baseline the search already has, which is the parent's own exact score.
 *
 * The issue's own framing is the one this harness implements: *do not scope
 * this as "build a surrogate", scope it as "find out whether a useful
 * surrogate is possible here, and stop early if not."* A failed kill gate is
 * therefore a successful run of this script, and it exits `0` and says so.
 *
 * ```bash
 * deno task surrogate-feasibility \
 *   --archive=/path/to/evaluations.jsonl \
 *   --provenance=production \
 *   --accept-gap=1e-04 \
 *   --markdown=docs/evidence/surrogate-feasibility-3930.md \
 *   --json=docs/evidence/surrogate-feasibility-3930.json
 * ```
 *
 * `--provenance` is required and has no default: a table of correlations is
 * unreadable without knowing whether the archive behind it came from the
 * production lineage or from a run raised inside a container, and the two
 * support very different claims.
 *
 * This is a measurement harness, not a production code path: nothing under
 * `src/` imports it, and it changes no scoring or selection behaviour.
 *
 * @module surrogate_feasibility
 */

import {
  type EvaluationArchiveRecord,
  readEvaluationArchive,
} from "@archive/EvaluationArchiveFormat.ts";
import { EVALUATION_DESCRIPTOR_VERSION } from "@archive/EvaluationDescriptor.ts";
import { SURROGATE_FAMILIES } from "./lib/surrogateModels.ts";
import {
  assessKillGate,
  buildFolds,
  defaultGapBands,
  evaluatePredictor,
  type FoldSplit,
  type GapBand,
  type KillGateVerdict,
  lineageCoverage,
  modelPredictor,
  parentScoreBaseline,
  type PredictorResult,
  REPORTED_TOP_K,
  type SplitMode,
  STUDY_FEATURE_NAMES,
} from "./lib/surrogateStudy.ts";

/** Where the archive came from — stamped on every report. */
export type ArchiveProvenance = "production" | "container-run" | "synthetic";

/** The provenances a report may be stamped with. */
const PROVENANCES: readonly ArchiveProvenance[] = [
  "production",
  "container-run",
  "synthetic",
];

/** The margin the study reports accuracy at, as the issue states it. */
const DEFAULT_ACCEPT_GAP = 1e-4;

/** Below this an archive cannot support a leave-one-group-out study. */
const MIN_RECORDS = 12;

/** What one split mode produced. */
export interface SplitReport {
  readonly mode: SplitMode;
  readonly rule: string;
  readonly groups: number;
  readonly folds: number;
  /** How many groups were skipped, in total. */
  readonly skipped: number;
  /**
   * Skipped folds counted by reason rather than listed.
   *
   * An archive with a thousand single-creature lineages produces a thousand
   * identical entries; the count is the finding, and the list is only noise
   * that buries the rest of the report.
   */
  readonly skippedByReason: readonly { reason: string; count: number }[];
  readonly results: readonly PredictorResult[];
}

/** The whole Stage 1 study. */
export interface FeasibilityReport {
  readonly provenance: ArchiveProvenance;
  readonly archivePath: string;
  readonly descriptorVersion: number;
  readonly records: number;
  readonly uniqueCreatures: number;
  readonly runs: number;
  readonly withParents: number;
  readonly lineageCoverage: number;
  readonly baselineFallbacks: number;
  readonly acceptGap: number;
  readonly bands: readonly GapBand[];
  readonly features: readonly string[];
  readonly splits: readonly SplitReport[];
  readonly killGate: KillGateVerdict;
}

/** Refuse an archive too small, too uniform, or of the wrong version. */
export function assertStudyable(
  records: readonly EvaluationArchiveRecord[],
): void {
  if (records.length < MIN_RECORDS) {
    throw new Error(
      `the archive holds ${records.length} evaluations; at least ` +
        `${MIN_RECORDS} are needed before a held-out study means anything`,
    );
  }
  for (const record of records) {
    if (record.descriptorVersion !== EVALUATION_DESCRIPTOR_VERSION) {
      throw new Error(
        `record ${record.uuid} carries descriptor version ` +
          `${record.descriptorVersion}, this build studies version ` +
          `${EVALUATION_DESCRIPTOR_VERSION}`,
      );
    }
    if (record.fidelity !== 1) {
      throw new Error(
        `record ${record.uuid} was scored at fidelity ${record.fidelity}; a ` +
          "surrogate fitted to anything but exact scores is fitted to another " +
          "approximation",
      );
    }
    if (!Number.isFinite(record.score)) {
      throw new Error(`record ${record.uuid} has a non-finite score`);
    }
  }
}

/** Count skipped folds by reason, in first-seen order. */
function countByReason(
  skipped: readonly { group: string; reason: string }[],
): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const skip of skipped) {
    counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);
  }
  return [...counts].map(([reason, count]) => ({ reason, count }));
}

/** Run the study over one archive. */
export function runFeasibilityStudy(options: {
  readonly records: readonly EvaluationArchiveRecord[];
  readonly archivePath: string;
  readonly provenance: ArchiveProvenance;
  readonly acceptGap?: number;
}): FeasibilityReport {
  const { records, archivePath, provenance } = options;
  assertStudyable(records);
  const acceptGap = options.acceptGap ?? DEFAULT_ACCEPT_GAP;
  const bands = defaultGapBands(acceptGap);
  const baseline = parentScoreBaseline(records);
  const predictors = [
    ...SURROGATE_FAMILIES.map(modelPredictor),
    baseline,
  ];

  const splits: SplitReport[] = [];
  let lineageResults: readonly PredictorResult[] = [];
  for (const mode of ["lineage", "run"] as const) {
    const split: FoldSplit = buildFolds(records, mode);
    const results = predictors.map((predictor) =>
      evaluatePredictor(split, predictor, bands)
    );
    if (mode === "lineage") lineageResults = results;
    splits.push({
      mode,
      rule: split.rule,
      groups: split.folds.length + split.skipped.length,
      folds: split.folds.length,
      skipped: split.skipped.length,
      skippedByReason: countByReason(split.skipped),
      results,
    });
  }

  const uniqueCreatures = new Set(records.map((record) => record.uuid)).size;
  const coverage = lineageCoverage(records);
  return {
    provenance,
    archivePath,
    descriptorVersion: EVALUATION_DESCRIPTOR_VERSION,
    records: records.length,
    uniqueCreatures,
    runs: new Set(records.map((record) => record.runId)).size,
    withParents: records.filter((record) => (record.parents ?? []).length > 0)
      .length,
    lineageCoverage: coverage,
    baselineFallbacks: baseline.fallbacks(),
    acceptGap,
    bands,
    features: STUDY_FEATURE_NAMES,
    splits,
    // The gate is defined on the lineage-held-out results only. A run-held-out
    // table is reported beside it as corroboration; it is not the gate.
    killGate: assessKillGate(lineageResults, coverage),
  };
}

/** Render a number, or an em dash where there was nothing to measure. */
function cell(value: number | null, digits = 3): string {
  return value === null ? "—" : value.toFixed(digits);
}

/** Render one split's results as a Markdown table. */
function splitTable(split: SplitReport, bands: readonly GapBand[]): string {
  const header = [
    "| Model | folds | ρ | τ | " +
    REPORTED_TOP_K.map((k) => `top-${k}`).join(" | ") + " | " +
    bands.map((band) => band.label).join(" | ") + " |",
    "| --- | ---: | ---: | ---: | " +
    REPORTED_TOP_K.map(() => "---: ").join("| ") + "| " +
    bands.map(() => "---: ").join("| ") + "|",
  ];
  const rows = split.results.map((result) => {
    const name = result.isBaseline ? `**${result.name}**` : result.name;
    const tops = REPORTED_TOP_K.map((k) => cell(result.topK.get(k) ?? null));
    const accuracies = result.bands.map((band) =>
      band.pairs === 0 ? "— (0)" : `${cell(band.accuracy)} (${band.pairs})`
    );
    return `| ${name} | ${result.measuredFolds} | ${cell(result.spearman)} | ` +
      `${cell(result.kendall)} | ${tops.join(" | ")} | ` +
      `${accuracies.join(" | ")} |`;
  });
  return [...header, ...rows].join("\n");
}

/** Render the whole study as Markdown. */
export function markdownReport(report: FeasibilityReport): string {
  const lines: string[] = [];
  lines.push("# Surrogate feasibility, Stage 1 (Issue #3930)");
  lines.push("");
  lines.push(
    `Archive: \`${report.archivePath}\` — **${report.provenance}** ` +
      `provenance, ${report.records} exact evaluations of ` +
      `${report.uniqueCreatures} distinct creatures across ${report.runs} ` +
      `run(s), descriptor v${report.descriptorVersion}, ` +
      `${report.features.length} features.`,
  );
  lines.push("");
  lines.push(
    `${report.withParents} of ${report.records} records name a parent, and ` +
      `${(report.lineageCoverage * 100).toFixed(1)}% name one that is itself ` +
      `in the archive; the baseline fell back to the training mean ` +
      `${report.baselineFallbacks} time(s) across both splits.`,
  );
  lines.push("");
  lines.push(
    "Accuracy cells read `accuracy (pairs)`. Every ordering statistic is " +
      "held out — no cell anywhere in this report was measured on a creature " +
      "its model had seen.",
  );
  for (const split of report.splits) {
    lines.push("");
    lines.push(`## Held out by ${split.mode}`);
    lines.push("");
    lines.push(`Split rule: ${split.rule}.`);
    lines.push("");
    lines.push(
      `${split.groups} group(s), ${split.folds} usable fold(s), ` +
        `${split.skipped} skipped.`,
    );
    lines.push("");
    lines.push(splitTable(split, report.bands));
    if (split.skipped > 0) {
      lines.push("");
      lines.push("Skipped folds, by reason:");
      lines.push("");
      for (const { reason, count } of split.skippedByReason) {
        lines.push(`- ${count} × ${reason}`);
      }
    }
    const failures = split.results.flatMap((result) =>
      result.failedFolds.map((fold) =>
        `${result.name} on \`${fold.group}\`: ${fold.reason}`
      )
    );
    if (failures.length > 0) {
      lines.push("");
      lines.push("Folds a predictor could not be applied to:");
      lines.push("");
      for (const failure of failures) lines.push(`- ${failure}`);
    }
  }
  lines.push("");
  lines.push("## Kill gate");
  lines.push("");
  lines.push(
    `**${report.killGate.passed ? "PASS" : "FAIL"}** — the gate is ` +
      "lineage-held-out top-5 agreement against the parent's-score baseline.",
  );
  lines.push("");
  for (const reason of report.killGate.reasons) lines.push(`- ${reason}`);
  lines.push("");
  if (report.killGate.passed) {
    lines.push(
      "Stage 2 is permitted: a `SurrogateModel` interface with an " +
        "uncertainty estimate beside every point prediction.",
    );
  } else if (report.killGate.best === null) {
    lines.push(
      "Stage 2 is **not** permitted, and this is **not** a measured negative " +
        "either — the gate could not be decided on this archive. The " +
        "distinction matters: a measured negative says structure does not " +
        "predict score, whereas an undecidable gate says the archive cannot " +
        "answer the question yet, and the two call for different work.",
    );
  } else {
    lines.push(
      "Stage 2 is **not** permitted. A negative result here is the correct " +
        "outcome, not a failed study: it says the margins this search accepts " +
        "are not predictable from creature structure, and that effort belongs " +
        "in cheaper exact evaluation instead.",
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** `--name=value`, or `undefined`. */
function stringArg(args: readonly string[], name: string): string | undefined {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/** `--name=<number>`, or `fallback`. */
function numberArg(
  args: readonly string[],
  name: string,
  fallback: number,
): number {
  const raw = stringArg(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} is not a number`);
  return value;
}

/** Validate `--provenance`, which has no default on purpose. */
export function parseProvenance(raw: string | undefined): ArchiveProvenance {
  if (raw === undefined) {
    throw new Error(
      `--provenance=<${PROVENANCES.join("|")}> is required: a correlation ` +
        "table cannot be read without knowing which archive produced it",
    );
  }
  if (!PROVENANCES.includes(raw as ArchiveProvenance)) {
    throw new Error(
      `--provenance must be one of ${PROVENANCES.join(", ")}, got '${raw}'`,
    );
  }
  return raw as ArchiveProvenance;
}

if (import.meta.main) {
  const args = Deno.args;
  const archivePath = stringArg(args, "archive");
  if (archivePath === undefined) {
    throw new Error(
      "--archive=<file.jsonl> is required: this study measures a real " +
        "evaluation archive (Issue #3929)",
    );
  }
  const provenance = parseProvenance(stringArg(args, "provenance"));
  const records = await readEvaluationArchive(archivePath);
  const report = runFeasibilityStudy({
    records,
    archivePath,
    provenance,
    acceptGap: numberArg(args, "accept-gap", DEFAULT_ACCEPT_GAP),
  });
  const markdown = markdownReport(report);
  console.log(markdown);
  const markdownOut = stringArg(args, "markdown");
  if (markdownOut) await Deno.writeTextFile(markdownOut, markdown);
  const jsonOut = stringArg(args, "json");
  if (jsonOut) {
    await Deno.writeTextFile(
      jsonOut,
      JSON.stringify(
        report,
        (_key, value) =>
          value instanceof Map ? Object.fromEntries(value) : value,
        2,
      ),
    );
  }
}
