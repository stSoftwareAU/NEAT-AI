/**
 * The cheap-problem benchmark harness for the surrogate techniques of the
 * Issue #3919 sweep — Issue #3935.
 *
 * Jin (2011) §6 grades surrogate techniques on cheap analytic functions
 * precisely because the "expensive" objective can be called for every point in
 * the design space. This harness is that test bed: it enumerates a small
 * lattice exhaustively and reports four things the GRQ corpus can never
 * answer, because the neighbourhood of a 5,317-neuron creature cannot be
 * enumerated:
 *
 * 1. **Surrogate accuracy against ground truth** — every family of
 *    `scripts/lib/surrogateModels.ts` fitted to a sample and graded on the
 *    whole lattice, including where the true optimum sits in its ordering.
 * 2. **Multi-fidelity rank agreement** — the cheap fidelity of Issue #3926,
 *    scored over a record stride and compared with Issue #3927's rank metrics
 *    against a *complete* ordering.
 * 3. **A deliberate false optimum** — a model fitted to a converged corner of
 *    the design space, exploited by the search, driving Issue #3933's drift
 *    monitor until it fires; and the same model fitted to the whole lattice
 *    and sampled uniformly, where it must stay quiet.
 * 4. **The acquisition path** — mandatory uncertainty, coverage refusal and
 *    the uncertainty floor of Issue #3933, exercised end to end.
 *
 * ```bash
 * deno run --allow-read --allow-env bench/surrogate_cheap_problem.ts \
 *   --surfaces=sphere,rastrigin,rosenbrock --levels=41 --records=64 \
 *   --rates=1,0.5,0.25,0.1 --json=docs/evidence/cheap-problem-3935.json
 * ```
 *
 * **The results are not transferable to GRQ creature scores**, and the report
 * says so on its face — twice, at the top and at the bottom. That is a
 * requirement of Issue #3935, not decoration: the risk this harness carries is
 * that a good number on a toy surface is read as evidence about a 90-day
 * equity objective it says nothing about.
 *
 * @module surrogate_cheap_problem
 */

import {
  type CheapProblem,
  createCheapProblem,
  groundTruth,
  TEST_SURFACES,
  type TestSurface,
} from "./lib/cheapProblem.ts";
import {
  type AcquisitionMeasurement,
  type FalseOptimumScenario,
  type FidelityMeasurement,
  measureAcquisition,
  measureFidelity,
  measureSurrogateAccuracy,
  NON_TRANSFERABLE_NOTICE,
  runFalseOptimumScenario,
  type SurrogateAccuracy,
} from "./lib/cheapProblemStudy.ts";
import { SURROGATE_FAMILIES } from "../scripts/lib/surrogateModels.ts";

/** How the harness is run. */
export interface HarnessOptions {
  /** Which surfaces to build problems from. */
  readonly surfaces: readonly TestSurface[];
  /** Design-space dimensions. */
  readonly dimensions: number;
  /** Lattice levels per dimension. */
  readonly levels: number;
  /** Records the exact score averages over. */
  readonly records: number;
  /** Cheap fidelities to grade, each in `(0, 1]`. */
  readonly rates: readonly number[];
  /** Lattice points every model is fitted to. */
  readonly trainingSize: number;
  /**
   * Fraction of each dimension the false-optimum model is confined to — the
   * converged corner it then extrapolates out of.
   */
  readonly locality: number;
  /** Seed, so the whole report is reproducible. */
  readonly seed: number;
}

/** Everything one run of the harness measured. */
export interface CheapProblemReport {
  /** Restated in the report so a stored JSON cannot lose it. */
  readonly scope: string;
  readonly options: HarnessOptions;
  readonly accuracy: readonly SurrogateAccuracy[];
  readonly fidelity: readonly FidelityMeasurement[];
  readonly falseOptimum: readonly FalseOptimumScenario[];
  readonly acquisition: readonly AcquisitionMeasurement[];
}

/** The harness defaults, small enough that a whole report runs in under a second. */
export const DEFAULT_HARNESS_OPTIONS: HarnessOptions = Object.freeze({
  surfaces: TEST_SURFACES,
  dimensions: 2,
  levels: 41,
  records: 64,
  rates: Object.freeze([1, 0.5, 0.25, 0.1]),
  trainingSize: 80,
  locality: 0.35,
  seed: 3935,
});

/**
 * Run every study over every configured surface.
 *
 * @param options - Partial overrides on {@link DEFAULT_HARNESS_OPTIONS}.
 * @returns The report.
 * @throws {Error} When a surface is unknown, or a study refuses its inputs.
 */
export function runCheapProblemBenchmark(
  options: Partial<HarnessOptions> = {},
): CheapProblemReport {
  const resolved: HarnessOptions = { ...DEFAULT_HARNESS_OPTIONS, ...options };
  for (const surface of resolved.surfaces) {
    if (!TEST_SURFACES.includes(surface)) {
      throw new Error(
        `${JSON.stringify(surface)} is not a test surface; available: ` +
          TEST_SURFACES.join(", "),
      );
    }
  }
  if (resolved.surfaces.length === 0) {
    throw new Error("at least one surface is needed to run the benchmark");
  }
  const accuracy: SurrogateAccuracy[] = [];
  const fidelity: FidelityMeasurement[] = [];
  const falseOptimum: FalseOptimumScenario[] = [];
  const acquisition: AcquisitionMeasurement[] = [];
  for (const surface of resolved.surfaces) {
    const problem: CheapProblem = createCheapProblem({
      surface,
      dimensions: resolved.dimensions,
      levels: resolved.levels,
      records: resolved.records,
      seed: resolved.seed,
    });
    const truth = groundTruth(problem);
    for (const family of SURROGATE_FAMILIES) {
      accuracy.push(
        measureSurrogateAccuracy(problem, truth, {
          family: family.name,
          trainingSize: resolved.trainingSize,
          seed: resolved.seed,
        }),
      );
      // The extrapolating regime: fitted to a converged corner, exploited by
      // the search. The monitor is supposed to fire here.
      falseOptimum.push(
        runFalseOptimumScenario(problem, truth, {
          family: family.name,
          trainingSize: resolved.trainingSize,
          trainingLocality: resolved.locality,
          selection: "exploit",
          seed: resolved.seed,
        }),
      );
      // The well-covered control: the same family fitted to the whole lattice
      // and sampled uniformly. The monitor is supposed to stay quiet, and a
      // monitor that fires here is a false positive, not a detection.
      falseOptimum.push(
        runFalseOptimumScenario(problem, truth, {
          family: family.name,
          trainingSize: resolved.trainingSize,
          trainingLocality: 1,
          selection: "uniform",
          seed: resolved.seed,
        }),
      );
    }
    for (const rate of resolved.rates) {
      fidelity.push(measureFidelity(problem, truth, rate));
    }
    acquisition.push(
      measureAcquisition(problem, truth, {
        trainingSize: resolved.trainingSize,
        seed: resolved.seed,
      }),
    );
  }
  return {
    scope: NON_TRANSFERABLE_NOTICE,
    options: resolved,
    accuracy,
    fidelity,
    falseOptimum,
    acquisition,
  };
}

function table(header: string[], rows: string[][]): string {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

const ratio = (value: number | null) =>
  value === null ? "undecidable" : value.toFixed(3);

/**
 * Render a report as Markdown, opening and closing with the scope notice.
 *
 * @param report - What {@link runCheapProblemBenchmark} produced.
 * @returns The Markdown body.
 */
export function renderReport(report: CheapProblemReport): string {
  const sections: string[] = [
    "# Cheap-problem surrogate benchmark (Issue #3935)",
    "",
    `> **${report.scope}**`,
    "",
    "## Surrogate accuracy against enumerated ground truth",
    "",
    table(
      [
        "Problem",
        "Family",
        "ρ",
        "τ-b",
        "top-10",
        "true optimum rank",
        "false-optimum regret",
        "signed bias",
        "bias ratio",
      ],
      report.accuracy.map((a) => [
        a.problem,
        a.family,
        a.spearmanRho.toFixed(3),
        a.kendallTau.toFixed(3),
        a.topKAgreement.toFixed(2),
        `${a.trueOptimumRank} / ${a.evaluated}`,
        a.falseOptimumRegret.toFixed(4),
        a.signedBias.toExponential(2),
        ratio(a.biasRatio),
      ]),
    ),
    "",
    "## Multi-fidelity rank agreement (record stride)",
    "",
    table(
      [
        "Problem",
        "Rate",
        "Records",
        "ρ",
        "τ-b",
        "top-10",
        "gap resolution",
        "true optimum rank",
      ],
      report.fidelity.map((f) => [
        f.problem,
        String(f.rate),
        String(f.records),
        f.spearmanRho.toFixed(4),
        f.kendallTau.toFixed(4),
        f.topKAgreement.toFixed(2),
        f.gapResolution.toExponential(2),
        String(f.trueOptimumRank),
      ]),
    ),
    "",
    "## False optimum — does the drift monitor fire when it should?",
    "",
    table(
      [
        "Problem",
        "Family",
        "Regime",
        "Coverage refusals",
        "Per-generation bias ratio",
        "Fired",
        "Generation",
        "Model-optimum regret",
      ],
      report.falseOptimum.map((s) => [
        s.problem,
        s.family,
        s.selection === "exploit"
          ? "extrapolating + exploit"
          : "covered + uniform",
        `${s.coverageRefusals} / ${s.generations * s.candidatesPerGeneration}`,
        ratio(s.generationBiasRatio),
        s.escalated ? "**yes**" : "no",
        s.escalatedAtGeneration === null
          ? "—"
          : String(s.escalatedAtGeneration),
        s.modelOptimumRegret.toFixed(4),
      ]),
    ),
    "",
    "## Acquisition path (mandatory uncertainty, coverage, floor)",
    "",
    table(
      [
        "Problem",
        "Family",
        "Candidates",
        "Slots",
        "OOD rate",
        "Uncertainty allocation",
        "Floor",
        "Allocation regret",
      ],
      report.acquisition.map((a) => [
        a.problem,
        a.family,
        String(a.candidates),
        String(a.slots),
        `${(a.outOfDistributionRate * 100).toFixed(1)}%`,
        `${(a.uncertaintyFraction * 100).toFixed(1)}%`,
        `${(a.floor * 100).toFixed(1)}%`,
        a.allocationRegret.toFixed(4),
      ]),
    ),
    "",
    "---",
    "",
    `**${report.scope}**`,
    "",
  ];
  return sections.join("\n");
}

function numberArg(args: string[], name: string, fallback: number): number {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const value = Number(hit.slice(name.length + 3));
  if (!Number.isFinite(value)) throw new Error(`--${name} is not a number`);
  return value;
}

function listArg(args: string[], name: string): string[] | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3).split(",");
}

if (import.meta.main) {
  const args = Deno.args;
  const surfaces = listArg(args, "surfaces") as TestSurface[] | undefined;
  const rates = listArg(args, "rates")?.map(Number);
  const report = runCheapProblemBenchmark({
    ...(surfaces === undefined ? {} : { surfaces }),
    ...(rates === undefined ? {} : { rates }),
    dimensions: numberArg(
      args,
      "dimensions",
      DEFAULT_HARNESS_OPTIONS.dimensions,
    ),
    levels: numberArg(args, "levels", DEFAULT_HARNESS_OPTIONS.levels),
    records: numberArg(args, "records", DEFAULT_HARNESS_OPTIONS.records),
    trainingSize: numberArg(
      args,
      "training",
      DEFAULT_HARNESS_OPTIONS.trainingSize,
    ),
    locality: numberArg(args, "locality", DEFAULT_HARNESS_OPTIONS.locality),
    seed: numberArg(args, "seed", DEFAULT_HARNESS_OPTIONS.seed),
  });
  console.log(renderReport(report));
  const jsonPath = args.find((a) => a.startsWith("--json="));
  if (jsonPath !== undefined) {
    await Deno.writeTextFile(
      jsonPath.slice("--json=".length),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
}
