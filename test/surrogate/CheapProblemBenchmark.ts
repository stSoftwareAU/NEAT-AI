/**
 * Issue #3935: the cheap-problem benchmark harness.
 *
 * Lives under `test/` rather than beside the harness in `bench/` because
 * `scripts/shard_test_files.ts` — the collector CI's sharded lanes run — globs
 * `test/**` only. A benchmark assertion that CI never executes is not
 * regression coverage, and Issue #3935 asks for regression coverage.
 *
 * The point of the harness is that ground truth is **complete** — every point
 * of the design space is evaluated — so these tests assert against exhaustive
 * enumeration rather than against a held-out sample. Nothing here is timed:
 * wall-clock assertions are flaky under parallel test execution (AGENTS.md),
 * and the numbers this harness exists to publish belong in
 * `docs/evidence/cheap-problem-benchmark-3935.md`.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  approximateScores,
  createCheapProblem,
  enumerateLattice,
  groundTruth,
  MAX_ENUMERATED_POINTS,
  scoreAt,
} from "../../bench/lib/cheapProblem.ts";
import {
  localIndices,
  measureAcquisition,
  measureFidelity,
  measureSurrogateAccuracy,
  NON_TRANSFERABLE_NOTICE,
  runFalseOptimumScenario,
  sampleIndices,
  surrogateFamily,
} from "../../bench/lib/cheapProblemStudy.ts";
import {
  DEFAULT_HARNESS_OPTIONS,
  renderReport,
  runCheapProblemBenchmark,
} from "../../bench/surrogate_cheap_problem.ts";

/** A lattice small enough to enumerate many times over in a unit test. */
const SMALL = { dimensions: 2, levels: 15, records: 24, seed: 3935 } as const;

Deno.test("cheap problem - the lattice is enumerated exhaustively and in bounds", () => {
  const problem = createCheapProblem({ surface: "sphere", ...SMALL });
  const points = enumerateLattice(problem);

  assertEquals(points.length, 15 * 15);
  const seen = new Set(points.map((p) => p.join(",")));
  assertEquals(seen.size, points.length, "every lattice point is distinct");
  for (const point of points) {
    assertEquals(point.length, 2);
    for (const coordinate of point) {
      assert(coordinate >= problem.lower && coordinate <= problem.upper);
    }
  }
  assertEquals(points[0], [problem.lower, problem.lower]);
  assertEquals(points[points.length - 1], [problem.upper, problem.upper]);
});

Deno.test("cheap problem - ground truth names the best point on the lattice", () => {
  const problem = createCheapProblem({ surface: "rastrigin", ...SMALL });
  const truth = groundTruth(problem);

  assertEquals(truth.scores.length, truth.points.length);
  for (let i = 0; i < truth.scores.length; i++) {
    assert(
      truth.scores[i] <= truth.optimumScore,
      `point ${i} beats the reported optimum`,
    );
    assert(truth.scores[i] >= truth.worstScore);
  }
  assertEquals(truth.scores[truth.optimumIndex], truth.optimumScore);
  // The exact score is the mean over every record, so re-deriving it from the
  // problem must reproduce it.
  assertAlmostEquals(
    scoreAt(problem, truth.points[truth.optimumIndex]),
    truth.optimumScore,
    1e-12,
  );
});

Deno.test("cheap problem - an oversized lattice is refused, not enumerated", () => {
  assertThrows(
    () => createCheapProblem({ surface: "sphere", dimensions: 8, levels: 41 }),
    Error,
    String(MAX_ENUMERATED_POINTS),
  );
});

Deno.test("cheap problem - a degenerate problem is refused", () => {
  assertThrows(
    () => createCheapProblem({ surface: "sphere", levels: 1 }),
    Error,
    "levels",
  );
  assertThrows(
    () => createCheapProblem({ surface: "sphere", records: 0 }),
    Error,
    "records",
  );
  assertThrows(
    () => createCheapProblem({ surface: "sphere", lower: 2, upper: 1 }),
    Error,
    "finite range",
  );
});

Deno.test("cheap problem - a point of the wrong width is refused", () => {
  const problem = createCheapProblem({ surface: "sphere", ...SMALL });
  assertThrows(() => scoreAt(problem, [0]), Error, "expected 2");
});

Deno.test("cheap problem - the full-rate stride reproduces the exact score", () => {
  const problem = createCheapProblem({ surface: "rosenbrock", ...SMALL });
  const truth = groundTruth(problem);

  assertEquals(approximateScores(problem, truth.points, 1), [...truth.scores]);
});

Deno.test("cheap problem - a record stride is a different estimator", () => {
  const problem = createCheapProblem({ surface: "rastrigin", ...SMALL });
  const truth = groundTruth(problem);
  const cheap = approximateScores(problem, truth.points, 0.25);

  assertEquals(cheap.length, truth.scores.length);
  assert(
    cheap.some((value, i) => value !== truth.scores[i]),
    "a quarter of the records must score at least one point differently",
  );
});

Deno.test("cheap problem - the study is reproducible from its seed", () => {
  const problem = createCheapProblem({ surface: "rastrigin", ...SMALL });
  const truth = groundTruth(problem);
  const options = { family: "quadratic-polynomial", trainingSize: 40, seed: 7 };

  assertEquals(
    measureSurrogateAccuracy(problem, truth, options),
    measureSurrogateAccuracy(problem, truth, options),
  );
  assertEquals(sampleIndices(100, 10, 7), sampleIndices(100, 10, 7));
});

Deno.test("cheap problem - accuracy is graded against every lattice point", () => {
  const problem = createCheapProblem({ surface: "sphere", ...SMALL });
  const truth = groundTruth(problem);
  const accuracy = measureSurrogateAccuracy(problem, truth, {
    family: "quadratic-polynomial",
    trainingSize: 40,
  });

  assertEquals(accuracy.evaluated, truth.points.length);
  assert(accuracy.trueOptimumRank >= 0);
  assert(accuracy.falseOptimumRegret >= 0 && accuracy.falseOptimumRegret <= 1);
  assert(accuracy.rmse >= 0);
  // A sphere is a quadratic, so a quadratic polynomial reconstructs it: this
  // is the sanity check that the grading is against ground truth and not
  // against the model's own training residuals.
  assert(
    accuracy.spearmanRho > 0.99,
    `a quadratic should recover a sphere, ρ was ${accuracy.spearmanRho}`,
  );
  assertEquals(accuracy.trueOptimumRank, 0);
});

Deno.test("cheap problem - an unknown surrogate family is refused", () => {
  assertThrows(() => surrogateFamily("no-such-model"), Error, "no-such-model");
});

Deno.test("cheap problem - a training draw larger than the pool is refused", () => {
  assertThrows(() => sampleIndices(10, 11, 1), Error, "11 index/indices");
});

Deno.test("cheap problem - fidelity 1 preserves the ordering exactly", () => {
  const problem = createCheapProblem({ surface: "rastrigin", ...SMALL });
  const truth = groundTruth(problem);
  const full = measureFidelity(problem, truth, 1);

  assertEquals(full.rate, 1);
  assertEquals(full.records, problem.records.length);
  assertAlmostEquals(full.spearmanRho, 1, 1e-12);
  assertAlmostEquals(full.kendallTau, 1, 1e-12);
  assertEquals(full.topKAgreement, 1);
  assertEquals(full.gapResolution, 0);
  assertEquals(full.trueOptimumRank, 0);
});

Deno.test("cheap problem - a cheaper fidelity uses fewer records and loses resolution", () => {
  const problem = createCheapProblem({ surface: "rastrigin", ...SMALL });
  const truth = groundTruth(problem);
  const cheap = measureFidelity(problem, truth, 0.25);

  assert(cheap.records < problem.records.length);
  assert(cheap.spearmanRho <= 1);
  assert(
    cheap.gapResolution > 0,
    "a quarter of the records must invert at least one pair the full set orders",
  );
});

Deno.test("cheap problem - an invalid fidelity is refused", () => {
  const problem = createCheapProblem({ surface: "sphere", ...SMALL });
  const truth = groundTruth(problem);
  assertThrows(() => measureFidelity(problem, truth, 0), Error, "sample rate");
  assertThrows(() => measureFidelity(problem, truth, 2), Error, "sample rate");
});

Deno.test("cheap problem - a model fitted to a corner extrapolates and the monitor fires", () => {
  const problem = createCheapProblem({ surface: "rastrigin", ...SMALL });
  const truth = groundTruth(problem);
  const scenario = runFalseOptimumScenario(problem, truth, {
    family: "quadratic-polynomial",
    trainingSize: 20,
    trainingLocality: 0.35,
    selection: "exploit",
    candidatesPerGeneration: 12,
    generations: 8,
  });

  assertEquals(scenario.escalated, true);
  assert(
    scenario.escalatedAtGeneration !== null &&
      scenario.escalatedAtGeneration <= 8,
  );
  assert(
    Math.abs(scenario.generationBiasRatio ?? 0) >= 0.5,
    `the residuals must be one-directional, ratio was ` +
      `${scenario.generationBiasRatio}`,
  );
  // The refusal to extrapolate of Issue #3933 would have caught the same
  // candidates before the monitor ever saw a residual.
  assert(
    scenario.coverageRefusals > 0,
    "candidates outside the fitted corner must be refused by the coverage region",
  );
  assertEquals(scenario.observedResiduals, 12 * 8);
  assertEquals(scenario.readings.length, 8);
});

Deno.test("cheap problem - honouring the coverage refusal withholds the refused residuals", () => {
  const problem = createCheapProblem({ surface: "rastrigin", ...SMALL });
  const truth = groundTruth(problem);
  const shared = {
    family: "quadratic-polynomial",
    trainingSize: 20,
    trainingLocality: 0.35,
    selection: "exploit" as const,
    candidatesPerGeneration: 12,
    generations: 8,
  };
  const ignored = runFalseOptimumScenario(problem, truth, {
    ...shared,
    coveragePolicy: "ignore",
  });
  const honoured = runFalseOptimumScenario(problem, truth, {
    ...shared,
    coveragePolicy: "honour",
  });

  // The same candidates are refused either way — the policy decides only
  // whether the monitor is shown a residual for them.
  assertEquals(honoured.coverageRefusals, ignored.coverageRefusals);
  assertEquals(
    honoured.observedResiduals,
    ignored.observedResiduals - ignored.coverageRefusals,
  );
  assert(
    honoured.observedResiduals < ignored.observedResiduals,
    "honouring the refusal must withhold at least one residual here",
  );
  // Production honours the refusal, so the monitor is not the defence that
  // catches a model extrapolating this far — the refusal is, first.
  assertEquals(honoured.escalated, false);
});

Deno.test("cheap problem - selection and extrapolation are varied one at a time", () => {
  const problem = createCheapProblem({ surface: "rastrigin", ...SMALL });
  const truth = groundTruth(problem);
  const base = {
    family: "quadratic-polynomial",
    trainingSize: 20,
    candidatesPerGeneration: 12,
    generations: 8,
  };
  const exploitingCorner = runFalseOptimumScenario(problem, truth, {
    ...base,
    trainingLocality: 0.35,
    selection: "exploit",
  });
  const uniformCorner = runFalseOptimumScenario(problem, truth, {
    ...base,
    trainingLocality: 0.35,
    selection: "uniform",
  });

  // Same model, same coverage region, same number of residuals — the only
  // difference is which candidates the generation drew.
  assertEquals(
    uniformCorner.trainingLocality,
    exploitingCorner.trainingLocality,
  );
  assertEquals(
    uniformCorner.observedResiduals,
    exploitingCorner.observedResiduals,
  );
  assert(
    uniformCorner.generationBiasRatio !== exploitingCorner.generationBiasRatio,
    "exploiting the model must move the bias ratio, or the pair says nothing",
  );
});

Deno.test("cheap problem - a scenario the lattice cannot supply is refused", () => {
  const problem = createCheapProblem({ surface: "sphere", ...SMALL });
  const truth = groundTruth(problem);
  assertThrows(
    () =>
      runFalseOptimumScenario(problem, truth, {
        trainingSize: 20,
        candidatesPerGeneration: 100,
        generations: 100,
      }),
    Error,
    "unevaluated lattice points",
  );
});

Deno.test("cheap problem - a training set larger than its locality window is refused", () => {
  const problem = createCheapProblem({ surface: "sphere", ...SMALL });
  const truth = groundTruth(problem);
  assertThrows(
    () =>
      runFalseOptimumScenario(problem, truth, {
        trainingSize: 200,
        trainingLocality: 0.35,
      }),
    Error,
    "training locality",
  );
});

Deno.test("cheap problem - an empty training window is refused", () => {
  const problem = createCheapProblem({ surface: "sphere", ...SMALL });
  const truth = groundTruth(problem);
  assertThrows(
    () => localIndices(problem, truth.points, 0),
    Error,
    "locality",
  );
});

Deno.test("cheap problem - the acquisition path honours the uncertainty floor", () => {
  const problem = createCheapProblem({ surface: "rastrigin", ...SMALL });
  const truth = groundTruth(problem);
  const measurement = measureAcquisition(problem, truth, {
    trainingSize: 30,
    candidates: 40,
    slots: 10,
  });

  assertEquals(measurement.family, "gaussian-process");
  assert(measurement.slots > 0);
  assert(
    measurement.uncertaintyFraction >= measurement.floor,
    `uncertainty allocation ${measurement.uncertaintyFraction} fell below the ` +
      `floor ${measurement.floor}`,
  );
  assert(
    measurement.allocationRegret >= 0 && measurement.allocationRegret <= 1,
  );
});

Deno.test("cheap problem - a family with no uncertainty cannot drive the acquisition rule", () => {
  const problem = createCheapProblem({ surface: "sphere", ...SMALL });
  const truth = groundTruth(problem);
  assertThrows(
    () =>
      measureAcquisition(problem, truth, {
        family: "quadratic-polynomial",
        trainingSize: 30,
        candidates: 40,
        slots: 10,
      }),
    Error,
    "reports no uncertainty",
  );
});

Deno.test("cheap problem - the report states its own limits on its face", () => {
  const report = runCheapProblemBenchmark({
    surfaces: ["sphere"],
    levels: 15,
    records: 24,
    trainingSize: 20,
    rates: [1, 0.5],
  });
  const rendered = renderReport(report);

  assertEquals(report.scope, NON_TRANSFERABLE_NOTICE);
  assert(rendered.startsWith("# Cheap-problem surrogate benchmark"));
  assert(
    rendered.indexOf(NON_TRANSFERABLE_NOTICE) <
      rendered.lastIndexOf(NON_TRANSFERABLE_NOTICE),
    "the scope notice must open and close the report",
  );
  assert(
    rendered.includes("not transferable") ||
      rendered.includes("Nothing measured here transfers"),
  );
});

Deno.test("cheap problem - every configured surface and family reaches the report", () => {
  const report = runCheapProblemBenchmark({
    surfaces: ["sphere", "rastrigin"],
    levels: 15,
    records: 24,
    trainingSize: 20,
    rates: [1, 0.25],
  });

  assertEquals(report.accuracy.length, 2 * 4);
  assertEquals(report.fidelity.length, 2 * 2);
  assertEquals(report.falseOptimum.length, 2 * 4 * 5);
  // Every regime of the shipped grid is present for every family, so a
  // firing can be attributed to a knob rather than to a pair of them.
  for (const family of new Set(report.falseOptimum.map((s) => s.family))) {
    const rows = report.falseOptimum.filter((s) => s.family === family);
    assertEquals(
      new Set(
        rows.map((s) =>
          `${s.trainingLocality < 1}|${s.selection}|${s.coveragePolicy}`
        ),
      ).size,
      5,
    );
  }
  assertEquals(report.acquisition.length, 2);
  assertEquals(
    new Set(report.accuracy.map((a) => a.family)).size,
    4,
    "every surrogate family must appear in the accuracy table",
  );
});

Deno.test("cheap problem - the shipped grid fires on a production-reachable path and never on the control", () => {
  // The two claims Issue #3935 asks the harness to stand behind, asserted over
  // the grid the evidence file is generated from rather than over a fixture:
  // the monitor is seen to fire where the model is fully covered and merely
  // exploited — a path production can take — and it never fires on the
  // control, where the same models are sampled uniformly.
  const report = runCheapProblemBenchmark();
  const covered = report.falseOptimum.filter((s) =>
    s.trainingLocality === 1 && s.coveragePolicy === "ignore"
  );
  const exploited = covered.filter((s) => s.selection === "exploit");
  const control = covered.filter((s) => s.selection === "uniform");

  assert(exploited.length > 0 && control.length === exploited.length);
  assert(
    exploited.some((s) => s.escalated),
    "a monitor that has never been seen to fire is not a monitor",
  );
  for (const scenario of control) {
    assertEquals(
      scenario.escalated,
      false,
      `the control fired, which is a false positive: ${scenario.line}`,
    );
  }
});

Deno.test("cheap problem - an unknown surface is refused rather than skipped", () => {
  assertThrows(
    () =>
      runCheapProblemBenchmark({
        surfaces: ["ackley" as unknown as "sphere"],
      }),
    Error,
    "is not a test surface",
  );
  assertThrows(
    () => runCheapProblemBenchmark({ surfaces: [] }),
    Error,
    "at least one surface",
  );
});

Deno.test("cheap problem - the shipped defaults are the ones the docs quote", () => {
  assertEquals(DEFAULT_HARNESS_OPTIONS.dimensions, 2);
  assertEquals(DEFAULT_HARNESS_OPTIONS.levels, 41);
  assertEquals(DEFAULT_HARNESS_OPTIONS.records, 64);
  assertEquals([...DEFAULT_HARNESS_OPTIONS.rates], [1, 0.5, 0.25, 0.1]);
  assertEquals(DEFAULT_HARNESS_OPTIONS.seed, 3935);
});
