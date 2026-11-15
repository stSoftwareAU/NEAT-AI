/**
 * The budget-conditioned harness (Issue #4161): expression keeps exactly what
 * it claims, the search charges what it spends, validation never guides a
 * decision, a run is reproducible, and the verdict arithmetic says what the
 * criteria say.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import {
  ARM_NAMES,
  type ArmName,
  type BudgetStudySettings,
  budgetSynapses,
  budgetVerdict,
  DEFAULT_SETTINGS,
  EVAL_BUDGETS,
  evolve,
  expressGenome,
  type Genome,
  HIDDEN,
  runArmSeed,
  runStudy,
  SOURCE_METHOD,
  studyOutcome,
  SYNAPSE_COUNT,
  TRAINING_BUDGETS,
  validateSettings,
} from "../../scripts/lib/budgetConditionedStudy.ts";
import { buildStudyCorpus } from "../../scripts/lib/connectivityPriorStudy.ts";
import { createSeededRng } from "@utils/RandomNumberGenerator.ts";

const SMALL: BudgetStudySettings = {
  ...DEFAULT_SETTINGS,
  mu: 4,
  lambda: 4,
  budgetRecords: 4_000,
  calibrationRecords: 40,
  validationRecords: 40,
};

const corpusOf = (s: BudgetStudySettings) =>
  buildStudyCorpus(4161, s.calibrationRecords, s.validationRecords);

/** A genome whose priorities rank `order` first, in that order. */
function genomeRanking(order: number[]): Genome {
  const priorities = new Array<number>(SYNAPSE_COUNT).fill(0);
  order.forEach((idx, rank) => priorities[idx] = 1 - rank * 0.01);
  const weights = Array.from(
    { length: SYNAPSE_COUNT },
    (_, i) => 0.1 + i / 100,
  );
  return { weights, priorities, biases: new Array(HIDDEN + 1).fill(0.1) };
}

Deno.test("budgetSynapses rounds and refuses bad budgets", () => {
  assertEquals(
    EVAL_BUDGETS.map(budgetSynapses),
    [11, 17, 22, 33, 44],
  );
  for (const bad of [0, -0.1, 1.5, NaN]) {
    assertThrows(() => budgetSynapses(bad), Error, String(bad));
  }
  assertThrows(() => budgetSynapses(0.001), Error, "0.001");
});

Deno.test("expression keeps exactly the top-k by priority", () => {
  const order = [5, 40, 12, 33, 0, 7, 20, 41, 3, 30, 42, 1, 2, 4];
  const genome = genomeRanking(order);
  const at = (b: number) => expressGenome(genome, b, "priority").kept;
  assertEquals(at(0.25), order.slice(0, 11));
  assertEquals(at(0.375).length, 17);
  // The 14 ranked candidates come first; ties then fall to the lowest index.
  assertEquals(new Set(at(0.375)), new Set([...order, 6, 8, 9]));
  const k25 = new Set(at(0.25));
  const k50 = new Set(at(0.5));
  const k100 = new Set(at(1));
  assertEquals(k50.size, 22);
  assertEquals(k100.size, 44);
  for (const i of k25) assert(k50.has(i));
  for (const i of k50) assert(k100.has(i));
});

Deno.test("priority ties go to the lower index", () => {
  const genome = genomeRanking([]);
  assertEquals(
    expressGenome(genome, 0.25, "priority").kept,
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});

Deno.test("magnitude ranking keeps the largest absolute weights", () => {
  const genome = genomeRanking([0, 1, 2]);
  genome.weights = genome.weights.map((_, i) =>
    i % 2 === 0 ? i / 100 : -i / 100
  );
  const kept = expressGenome(genome, 0.25, "magnitude").kept;
  assertEquals(kept, [43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33]);
});

Deno.test("a hidden neuron without an outbound synapse is dropped", () => {
  const kept = [0, 1, 2, 3, 33, 34, 40, 41, 42, 43, 8];
  const e = expressGenome(genomeRanking(kept), 0.25, "priority");
  assertEquals(
    [...e.kept].sort((a, b) => a - b),
    [...kept].sort((a, b) => a - b),
  );
  assertEquals(e.keptSynapses, 11);
  assertEquals(e.effectiveSynapses, 8);
  assert(e.effectiveSynapses < e.keptSynapses);
  const uuids = e.creature.neurons.map((n) => n.uuid);
  assert(!uuids.includes("hidden-0"));
  assert(!uuids.includes("hidden-3"));
  assert(uuids.includes("hidden-1"));
  assert(uuids.includes("hidden-2"));
  assert(e.valid);
  assertEquals(e.invalidReason, null);
});

Deno.test("validateSettings names the field and accepts the defaults", () => {
  validateSettings(DEFAULT_SETTINGS);
  validateSettings(SMALL);
  assertThrows(
    () => validateSettings({ ...SMALL, mu: 0 }),
    Error,
    "settings.mu",
  );
  assertThrows(
    () => validateSettings({ ...SMALL, calibrationRecords: 1.5 }),
    Error,
    "settings.calibrationRecords",
  );
  assertThrows(
    () => validateSettings({ ...SMALL, geneMutationRate: 0 }),
    Error,
    "settings.geneMutationRate",
  );
  assertThrows(
    () => validateSettings({ ...SMALL, mutationSigma: -1 }),
    Error,
    "settings.mutationSigma",
  );
});

Deno.test("evolve charges within budget and stops when nothing more fits", () => {
  const corpus = corpusOf(SMALL);
  const cost = corpus.train.length * TRAINING_BUDGETS.length;
  const r = evolve(
    TRAINING_BUDGETS,
    "priority",
    SMALL.budgetRecords,
    SMALL,
    corpus,
    createSeededRng(1),
  );
  assert(r.recordsCharged <= SMALL.budgetRecords);
  assert(SMALL.budgetRecords - r.recordsCharged < cost);
  assertEquals(r.evaluations * cost, r.recordsCharged);
  assertEquals(cost, 3 * corpus.train.length);
  assertThrows(
    () =>
      evolve(
        TRAINING_BUDGETS,
        "priority",
        cost * (SMALL.mu - 1),
        SMALL,
        corpus,
        createSeededRng(1),
      ),
    Error,
    "initial genomes",
  );
});

Deno.test("every arm stays within the budget", () => {
  const corpus = corpusOf(SMALL);
  for (const arm of ARM_NAMES) {
    const run = runArmSeed(arm, 3, SMALL, corpus);
    assert(run.recordsCharged <= SMALL.budgetRecords, arm);
    assert(run.recordsCharged > 0, arm);
    assertEquals(run.budgets.length, EVAL_BUDGETS.length);
  }
});

Deno.test("validation never guides the search", () => {
  const corpus = corpusOf(SMALL);
  const other = {
    train: corpus.train,
    holdout: corpus.holdout.map((r) => ({ ...r, target: -r.target - 5 })),
  };
  for (const arm of ARM_NAMES) {
    const a = runArmSeed(arm, 9, SMALL, corpus);
    const b = runArmSeed(arm, 9, SMALL, other);
    assertEquals(a.recordsCharged, b.recordsCharged);
    for (let i = 0; i < a.budgets.length; i++) {
      assertEquals(a.budgets[i].calibrationMse, b.budgets[i].calibrationMse);
      assertEquals(a.budgets[i].keptSynapses, b.budgets[i].keptSynapses);
      assertNotEquals(a.budgets[i].validationMse, b.budgets[i].validationMse);
    }
  }
});

Deno.test("the same seed reproduces exactly and another seed differs", () => {
  const corpus = corpusOf(SMALL);
  const a = runArmSeed("conditioned", 5, SMALL, corpus);
  assertEquals(a, runArmSeed("conditioned", 5, SMALL, corpus));
  assertNotEquals(a, runArmSeed("conditioned", 6, SMALL, corpus));
});

Deno.test("budgetVerdict follows the criteria", () => {
  assertEquals(budgetVerdict(4, { low: -2, high: -1 }), "insufficient-data");
  assertEquals(budgetVerdict(5, { low: -2, high: -1 }), "benefit");
  assertEquals(budgetVerdict(5, { low: 1, high: 2 }), "harm");
  assertEquals(budgetVerdict(5, { low: -1, high: 1 }), "no-benefit");
});

Deno.test("studyOutcome succeeds only when every condition holds", () => {
  const v = (
    verdict: "benefit" | "harm" | "no-benefit" | "insufficient-data",
  ) => ({
    verdict,
  });
  assertEquals(
    studyOutcome({
      vsIndependent: v("benefit"),
      vsPruned: v("benefit"),
      fullSize: v("no-benefit"),
    }),
    { outcome: "success", reasons: [] },
  );
  const harm = studyOutcome({
    vsIndependent: v("benefit"),
    vsPruned: v("benefit"),
    fullSize: v("harm"),
  });
  assertEquals(harm.outcome, "failure");
  assertEquals(harm.reasons.length, 1);
  const a = studyOutcome({
    vsIndependent: v("no-benefit"),
    vsPruned: v("benefit"),
    fullSize: v("no-benefit"),
  });
  assertEquals(a.outcome, "failure");
  assertEquals(a.reasons.length, 1);
  const b = studyOutcome({
    vsIndependent: v("benefit"),
    vsPruned: v("insufficient-data"),
    fullSize: v("harm"),
  });
  assertEquals(b.reasons.length, 2);
});

Deno.test("a small study completes every run at the budgeted size", () => {
  const study = runStudy({
    seedCount: 2,
    baseSeed: 100,
    settings: SMALL,
  });
  assertEquals(study.coverage.expectedRuns, 2 * ARM_NAMES.length);
  assertEquals(study.coverage.completedRuns, 6);
  assertEquals(study.coverage.failures.length, 0);
  for (const run of study.runs) {
    assert(ARM_NAMES.includes(run.arm as ArmName));
    for (const b of run.budgets) {
      assertEquals(b.keptSynapses, budgetSynapses(b.budget));
      assertEquals(b.latencyMicros, null);
    }
  }
  assertEquals(study.primary.vsIndependent.verdict, "insufficient-data");
});

Deno.test("the manifest pins the source method it maps onto", () => {
  const study = runStudy({ seedCount: 1, baseSeed: 100, settings: SMALL });
  const paper = study.manifest.paper;
  assertEquals(paper, SOURCE_METHOD);
  assertEquals(paper.arxivId, "2611.06895");
  assertEquals(paper.version, "v1");
  assert(paper.elements.length > 0);
  for (const element of paper.elements) {
    assert(element.paper.length > 0);
    assert(element.study.length > 0);
    assert(["same", "analogue", "departs"].includes(element.fidelity));
  }
  // The generator that takes the condition as an input is the paper's core
  // mechanism; this study does not reproduce it, and the manifest says so.
  assert(paper.elements.some((e) => e.fidelity === "departs"));
});
