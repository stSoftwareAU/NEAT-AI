/**
 * Issue #3930: the Stage 1 study arithmetic — splitting, rank agreement,
 * gap-stratified accuracy, the parent's-score baseline and the kill gate.
 *
 * The tests that matter most here are the ones that check the study cannot
 * flatter itself: that a lineage fold never leaves a relative of the held-out
 * creature in the training set, that a constant prediction is reported as
 * unmeasurable rather than as a correlation, and that an undecidable gate is
 * not a pass.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import type { EvaluationArchiveRecord } from "@archive/EvaluationArchiveFormat.ts";
import {
  DESCRIPTOR_V1_SCALAR_NAMES,
  EVALUATION_DESCRIPTOR_LENGTH,
  NO_REFERENCE_DISTANCE,
} from "@archive/EvaluationDescriptor.ts";
import {
  assessKillGate,
  buildFolds,
  defaultGapBands,
  evaluatePredictor,
  expandDescriptor,
  gapStratifiedAccuracy,
  lineageCoverage,
  lineageGroups,
  MIN_BASELINE_COVERAGE,
  modelPredictor,
  parentScoreBaseline,
  type PredictorResult,
  rankSummary,
  STUDY_FEATURE_NAMES,
  type StudyPredictor,
} from "../../scripts/lib/surrogateStudy.ts";
import { SURROGATE_FAMILIES } from "../../scripts/lib/surrogateModels.ts";

const REFERENCE_SLOT = DESCRIPTOR_V1_SCALAR_NAMES.indexOf(
  "geneticDistanceToReference",
);

/** A full-length descriptor whose first slots carry the given values. */
function descriptor(...values: number[]): number[] {
  const vector = new Array<number>(EVALUATION_DESCRIPTOR_LENGTH).fill(0);
  vector[REFERENCE_SLOT] = NO_REFERENCE_DISTANCE;
  for (let i = 0; i < values.length; i++) vector[i] = values[i];
  return vector;
}

/** One archive record, with only the fields the study reads. */
function record(
  uuid: string,
  score: number,
  options: {
    runId?: string;
    parents?: string[];
    descriptor?: number[];
    generation?: number;
  } = {},
): EvaluationArchiveRecord {
  return {
    descriptorVersion: 1,
    runId: options.runId ?? "run-a",
    generation: options.generation ?? 1,
    uuid,
    parents: options.parents ?? [],
    operators: [],
    score,
    fidelity: 1,
    recordedAt: "2026-09-10T00:00:00.000Z",
    descriptor: options.descriptor ?? descriptor(score * 10, score * 3),
  };
}

Deno.test("surrogate study - the reference sentinel becomes a value and an indicator", () => {
  const absent = expandDescriptor(descriptor(1, 2));
  assertEquals(absent.length, STUDY_FEATURE_NAMES.length);
  assertEquals(absent[REFERENCE_SLOT], 0);
  assertEquals(absent[absent.length - 1], 0);

  const measured = descriptor(1, 2);
  measured[REFERENCE_SLOT] = 0.42;
  const present = expandDescriptor(measured);
  assertEquals(present[REFERENCE_SLOT], 0.42);
  assertEquals(present[present.length - 1], 1);
});

Deno.test("surrogate study - lineage is transitive, and an absent ancestor joins nothing", () => {
  const records = [
    record("a", 1),
    record("b", 2, { parents: ["a"] }),
    record("c", 3, { parents: ["b"] }),
    record("d", 4, { parents: ["ghost"] }),
  ];
  const groups = lineageGroups(records);
  assertEquals(groups.get("a"), groups.get("b"));
  assertEquals(groups.get("b"), groups.get("c"));
  assert(
    groups.get("d") !== groups.get("a"),
    "a creature whose parent is not archived stands alone",
  );
});

Deno.test("surrogate study - lineage coverage counts only archived parents", () => {
  const records = [
    record("a", 1),
    record("b", 2, { parents: ["a"] }),
    record("c", 3, { parents: ["ghost"] }),
    record("d", 4, { parents: [] }),
  ];
  assertAlmostEquals(lineageCoverage(records), 0.25, 1e-12);
  assertEquals(lineageCoverage([]), 0);
});

Deno.test("surrogate study - no relative of a held-out creature is left in the training set", () => {
  const records = [
    record("a", 1),
    record("b", 2, { parents: ["a"] }),
    record("c", 3, { parents: ["a"] }),
    record("x", 4, { runId: "run-b" }),
    record("y", 5, { runId: "run-b", parents: ["x"] }),
    record("z", 6, { runId: "run-b", parents: ["x"] }),
  ];
  const split = buildFolds(records, "lineage");
  assertEquals(split.folds.length, 2);
  assert(split.rule.includes("lineage"));
  const groups = lineageGroups(records);
  for (const fold of split.folds) {
    const heldOut = new Set(fold.test.map((r) => r.uuid));
    for (const trained of fold.train) {
      assert(
        !heldOut.has(trained.uuid),
        "a held-out creature must not be trained on",
      );
      assert(
        groups.get(trained.uuid) !== fold.group,
        `${trained.uuid} is a relative of the held-out group ${fold.group}`,
      );
    }
  }
});

Deno.test("surrogate study - a repeated creature is de-duplicated, not held out beside its twin", () => {
  const records = [
    record("a", 1),
    // The same creature, scored again in a later generation.
    record("a", 1, { generation: 2 }),
    record("b", 2),
    record("c", 3),
    record("d", 4, { runId: "run-b" }),
    record("e", 5, { runId: "run-b" }),
    record("f", 6, { runId: "run-b" }),
  ];
  const split = buildFolds(records, "run");
  assertEquals(split.folds.length, 2);
  for (const fold of split.folds) {
    // Six distinct creatures from seven records: the twin is gone, and no
    // creature is in both halves of a fold.
    assertEquals(fold.train.length + fold.test.length, 6);
    const uuids = [...fold.train, ...fold.test].map((r) => r.uuid);
    assertEquals(new Set(uuids).size, 6);
  }
});

Deno.test("surrogate study - a fold too small to rank is skipped with its reason", () => {
  const records = [
    record("a", 1, { runId: "solo" }),
    record("b", 2, { runId: "many" }),
    record("c", 3, { runId: "many" }),
    record("d", 4, { runId: "many" }),
    record("e", 5, { runId: "other" }),
    record("f", 6, { runId: "other" }),
    record("g", 7, { runId: "other" }),
  ];
  const split = buildFolds(records, "run");
  assertEquals(split.folds.map((fold) => fold.group), ["many", "other"]);
  assertEquals(split.skipped.length, 1);
  assertEquals(split.skipped[0].group, "solo");
  assert(split.skipped[0].reason.includes("no ordering"));
});

Deno.test("surrogate study - rank agreement is measured, and a constant prediction is not", () => {
  const truth = [0.1, 0.2, 0.3, 0.4];
  const perfect = rankSummary(truth, [1, 2, 3, 4]);
  assertAlmostEquals(perfect.spearman ?? Number.NaN, 1, 1e-12);
  assertAlmostEquals(perfect.kendall ?? Number.NaN, 1, 1e-12);
  assertEquals(perfect.topK.get(1), 1);
  assertEquals(perfect.topK.get(3), 1);

  const reversed = rankSummary(truth, [4, 3, 2, 1]);
  assertAlmostEquals(reversed.spearman ?? Number.NaN, -1, 1e-12);
  assertEquals(reversed.topK.get(1), 0);

  const flat = rankSummary(truth, [7, 7, 7, 7]);
  assertEquals(flat.spearman, null);
  assertEquals(flat.kendall, null);
  assert(
    (flat.unmeasurable ?? "").includes("constant"),
    `a flat prediction must say why it is unmeasurable: ${flat.unmeasurable}`,
  );
});

Deno.test("surrogate study - top-k beyond the held-out set is unmeasurable, not zero", () => {
  const summary = rankSummary([1, 2, 3], [1, 2, 3]);
  assertEquals(summary.topK.get(5), null);
  assert((summary.unmeasurable ?? "").includes("top-5"));
});

Deno.test("surrogate study - pair accuracy is counted per gap band, and a predicted tie is wrong", () => {
  // Gaps: a-b 1e-5, a-c 1.1e-4, b-c 1e-4.
  const truth = [0, 1e-5, 1.1e-4];
  const bands = defaultGapBands(1e-4);
  const perfect = gapStratifiedAccuracy(truth, [0, 1, 2], bands);
  assertEquals(perfect[0].pairs, 1);
  assertEquals(perfect[0].accuracy, 1);
  assertEquals(
    perfect[2].pairs,
    2,
    "the cumulative band holds both fine pairs",
  );
  assertEquals(perfect[3].pairs, 1);

  const tied = gapStratifiedAccuracy(truth, [5, 5, 9], bands);
  assertEquals(tied[0].correct, 0);
  assertEquals(tied[0].accuracy, 0);

  const empty = gapStratifiedAccuracy([1, 1], [2, 3], bands);
  assertEquals(empty[0].pairs, 0);
  assertEquals(empty[0].accuracy, null);

  assertThrows(() => defaultGapBands(0), Error, "positive");
  assertThrows(
    () => gapStratifiedAccuracy([1, 2], [1], bands),
    Error,
    "differ in length",
  );
});

Deno.test("surrogate study - the baseline reads the parent's real score and counts its fallbacks", () => {
  const records = [
    record("p1", 0.5),
    record("p2", 0.9),
    record("p3", 0.3),
    record("kid-a", 0.51, { runId: "run-b", parents: ["p1"] }),
    record("kid-b", 0.91, { runId: "run-b", parents: ["p2"] }),
    record("orphan", 0.7, { runId: "run-b" }),
  ];
  const baseline = parentScoreBaseline(records);
  const split = buildFolds(records, "run");
  const fold = split.folds.find((f) => f.group === "run-b");
  assert(fold !== undefined, "run-b must be a usable fold");
  const predictions = baseline.predict(fold);
  const byUuid = new Map(
    fold.test.map((r, i) => [r.uuid, predictions[i]] as const),
  );
  // The parents are in the held-out fold's *training* set here, but the point
  // stands either way: the baseline reports the parent's exact archived score.
  assertEquals(byUuid.get("kid-a"), 0.5);
  assertEquals(byUuid.get("kid-b"), 0.9);
  assertEquals(baseline.fallbacks(), 1);
  // The orphan falls back to the mean of the three training scores.
  assertAlmostEquals(
    byUuid.get("orphan") ?? Number.NaN,
    (0.5 + 0.9 + 0.3) / 3,
    1e-12,
  );
});

Deno.test("surrogate study - a fold a model cannot be fitted to is recorded, not scored as zero", () => {
  const records = [
    record("a", 1),
    record("b", 2),
    record("c", 3),
    record("d", 4, { runId: "run-b" }),
    record("e", 5, { runId: "run-b" }),
    record("f", 6, { runId: "run-b" }),
  ];
  const split = buildFolds(records, "run");
  assertEquals(split.folds.length, 2);
  const exploding: StudyPredictor = {
    name: "always-throws",
    isBaseline: false,
    predict: () => {
      throw new Error("this fold is not fittable");
    },
  };
  const result = evaluatePredictor(split, exploding, defaultGapBands(1e-4));
  assertEquals(result.measuredFolds, 0);
  assertEquals(result.failedFolds.length, split.folds.length);
  assert(result.failedFolds[0].reason.includes("not fittable"));
  assertEquals(result.spearman, null);
});

Deno.test("surrogate study - a model predictor answers exactly the held-out creatures", () => {
  const records: EvaluationArchiveRecord[] = [];
  for (let i = 0; i < 24; i++) {
    const value = i / 24;
    records.push(record(`c${i}`, value, {
      runId: i < 12 ? "run-a" : "run-b",
      descriptor: descriptor(value, value * value, i % 5),
    }));
  }
  const split = buildFolds(records, "run");
  const predictor = modelPredictor(SURROGATE_FAMILIES[0]);
  for (const fold of split.folds) {
    const predictions = predictor.predict(fold);
    assertEquals(predictions.length, fold.test.length);
    for (const prediction of predictions) {
      assert(Number.isFinite(prediction), "a prediction must be a number");
    }
  }
});

/** A result stub, so the gate can be tested without fitting anything. */
function result(
  name: string,
  isBaseline: boolean,
  top5: number | null,
): PredictorResult {
  return {
    name,
    isBaseline,
    measuredFolds: 3,
    failedFolds: [],
    spearman: 0.5,
    kendall: 0.4,
    topK: new Map([[1, 0.5], [3, 0.5], [5, top5]]),
    bands: [],
  };
}

Deno.test("surrogate study - the gate passes only when a model actually beats the baseline", () => {
  const passed = assessKillGate([
    result("model", false, 0.8),
    result("parent-score-baseline", true, 0.6),
  ], 1);
  assertEquals(passed.passed, true);
  assertEquals(passed.best?.name, "model");

  const failed = assessKillGate([
    result("model", false, 0.6),
    result("parent-score-baseline", true, 0.6),
  ], 1);
  assertEquals(failed.passed, false, "a tie is not a win");
  assert(failed.reasons.join(" ").includes("the gate fails"));
});

Deno.test("surrogate study - an undecidable gate is a stop, never a pass", () => {
  const sparse = assessKillGate([
    result("model", false, 0.9),
    result("parent-score-baseline", true, 0.2),
  ], MIN_BASELINE_COVERAGE / 2);
  assertEquals(sparse.passed, false);
  assert(sparse.reasons.join(" ").includes("undecidable"));

  const unmeasurableBaseline = assessKillGate([
    result("model", false, 0.9),
    result("parent-score-baseline", true, null),
  ], 1);
  assertEquals(unmeasurableBaseline.passed, false);

  const unmeasurableModels = assessKillGate([
    result("model", false, null),
    result("parent-score-baseline", true, 0.5),
  ], 1);
  assertEquals(unmeasurableModels.passed, false);
  assert(unmeasurableModels.reasons.join(" ").includes("not measurable"));

  assertThrows(
    () => assessKillGate([result("model", false, 0.9)], 1),
    Error,
    "baseline is missing",
  );
});
