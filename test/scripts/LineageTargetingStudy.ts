/**
 * The lineage-targeting study harness (Issue #4155).
 *
 * The harness answers a research question, so its arithmetic is tested rather
 * than trusted: the corpus, the per-stratum scoring, the gene diff, the
 * operator history, the leakage policy (holdout never guides), the budget and
 * the paired analysis.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import {
  AFFECTED_GENES_CAP,
  affectedGenes,
  type ArmName,
  type ArmResult,
  ARMS,
  behaviouralDiversity,
  breedPair,
  buildStratifiedCorpus,
  createBreedContext,
  DEFAULT_STUDY_SETTINGS,
  type LineageEdge,
  OperatorHistory,
  pairedComparison,
  runArm,
  type Split,
  STRATUM_COUNT,
  stratumErrors,
  type StudySettings,
  validateSettings,
  verdict,
} from "../../scripts/lib/lineageTargetingStudy.ts";
import { seedPopulation } from "../../scripts/lib/preSelectionAB.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

const SMALL: StudySettings = {
  ...DEFAULT_STUDY_SETTINGS,
  recordsPerSplit: 40,
  populationSize: 6,
  elitism: 2,
  evaluationBudget: 30,
};

const SPLITS: Split[] = ["train", "calibration", "holdout"];

Deno.test("lineage study - the corpus is deterministic, disjoint and stratified", () => {
  const first = buildStratifiedCorpus(SMALL);
  const second = buildStratifiedCorpus(SMALL);
  const seen = new Set<string>();
  for (const split of SPLITS) {
    assertEquals(first[split].length, SMALL.recordsPerSplit);
    const strata = new Set(first[split].map((r) => r.stratum));
    assertEquals(strata.size, STRATUM_COUNT);
    first[split].forEach((record, i) => {
      assertEquals(record.target, second[split][i].target);
      assertEquals(
        Array.from(record.input),
        Array.from(second[split][i].input),
      );
      const key = Array.from(record.input).join(",");
      assert(!seen.has(key), "splits must not share an input pair");
      seen.add(key);
    });
  }
  const other = buildStratifiedCorpus({ ...SMALL, seed: SMALL.seed + 1 });
  assert(other.train.some((r, i) => r.target !== first.train[i].target));
});

Deno.test("lineage study - onlyStratum scores just that stratum", () => {
  const corpus = buildStratifiedCorpus(SMALL);
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const full = stratumErrors(creature, corpus.calibration);
  assertEquals(full.records, SMALL.recordsPerSplit);
  for (let s = 0; s < STRATUM_COUNT; s++) {
    const one = stratumErrors(creature, corpus.calibration, s);
    assertEquals(
      one.records,
      corpus.calibration.filter((r) => r.stratum === s).length,
    );
    assertAlmostEquals(one.overall, full.perStratum[s], 1e-9);
    assertAlmostEquals(one.perStratum[s], full.perStratum[s], 1e-9);
    assert(Number.isNaN(one.perStratum[(s + 1) % STRATUM_COUNT]));
  }
});

Deno.test("lineage study - affectedGenes diffs by UUID identity", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const parent = creature.exportJSON();
  const same = affectedGenes(parent, creature.exportJSON());
  assertEquals([same.added, same.removed, same.changed], [0, 0, 0]);

  const child = structuredClone(parent);
  child.synapses[0].weight += 1;
  const diff = affectedGenes(parent, child);
  assertEquals([diff.added, diff.removed, diff.changed], [0, 0, 1]);
  assertEquals(diff.genes.length, 1);

  const smaller = structuredClone(parent);
  smaller.synapses.pop();
  const removed = affectedGenes(parent, smaller);
  assertEquals(removed.removed, 1);
});

function edge(
  operator: string,
  calibrationDelta: number[],
  overallDelta: number,
): LineageEdge {
  return {
    generation: 1,
    parent: "p",
    child: "c",
    kind: "ordinary",
    operator,
    changed: true,
    affected: { added: 0, removed: 0, changed: 1, genes: [] },
    targetStratum: null,
    parentCalibration: [0, 0, 0, 0],
    calibrationDelta,
    overallDelta,
    trainDelta: 0,
  };
}

Deno.test("lineage study - OperatorHistory averages deltas from edges only", () => {
  const history = new OperatorHistory();
  history.record(edge("A", [-1, 2, 0, 0], -0.5));
  history.record(edge("A", [-3, 4, 0, 0], -1.5));
  history.record(edge("A", [Number.NaN, Infinity, 0, 0], Number.NaN));
  assertEquals(history.meanDelta("A", 0), -2);
  assertEquals(history.meanDelta("A", 1), 3);
  assertEquals(history.meanDelta("A", null), -1);
  assertEquals(history.samples("A"), 3);
  assertEquals(history.meanDelta("B", 0), undefined);
  assertEquals(history.samples("B"), 0);
});

Deno.test("lineage study - breeding never modifies the parent", async () => {
  await withRngTestLock(() => {
    const saved = getRandomNumberGenerator();
    try {
      const corpus = buildStratifiedCorpus(SMALL);
      for (const arm of ARMS) {
        const parent = seedPopulation(SMALL, createSeededRng(7))[2];
        const ctx = createBreedContext(SMALL, corpus.calibration);
        setRandomNumberGenerator(createSeededRng(11));
        const errors = {
          train: stratumErrors(parent, corpus.train),
          calibration: stratumErrors(parent, corpus.calibration),
        };
        const before = JSON.stringify(parent.exportJSON());
        let sawChange = false;
        for (let i = 0; i < 8; i++) {
          const bred = breedPair(arm, parent, errors, ctx, 1);
          assertEquals(bred.length, 2);
          assertEquals(JSON.stringify(parent.exportJSON()), before);
          for (const { child, edge: e } of bred) {
            if (e.changed) {
              sawChange = true;
              assertNotEquals(child.uuid, parent.uuid);
            }
          }
        }
        assert(sawChange, `${arm}: expected at least one real change`);
      }
    } finally {
      setRandomNumberGenerator(saved);
    }
  });
});

/** The train/calibration side of a run, which holdout must not touch. */
function guided(result: ArmResult) {
  return {
    recordsScored: result.recordsScored,
    trace: result.generations.map((g) => [g.bestTrainMse, g.recordsScored]),
    edges: result.edges.map((e) => [e.operator, e.trainDelta, e.targetStratum]),
    diversity: result.generations.map((g) => g.behaviouralDiversity),
  };
}

Deno.test("lineage study - holdout never guides any decision", async () => {
  await withRngTestLock(() => {
    const corpus = buildStratifiedCorpus(SMALL);
    const shifted = {
      ...corpus,
      holdout: corpus.holdout.map((r) => ({ ...r, target: r.target + 10 })),
    };
    for (const arm of ARMS) {
      const a = runArm(arm, SMALL, corpus);
      const b = runArm(arm, SMALL, shifted);
      assertEquals(guided(a), guided(b), `${arm}: holdout leaked`);
      assertNotEquals(a.finalHoldoutMse, b.finalHoldoutMse);
    }
  });
});

Deno.test("lineage study - runArm restores the caller's generator", async () => {
  await withRngTestLock(() => {
    const original = getRandomNumberGenerator();
    const mine = createSeededRng(123);
    setRandomNumberGenerator(mine);
    try {
      runArm(ARMS[0], SMALL, buildStratifiedCorpus(SMALL));
      assertStrictEquals(getRandomNumberGenerator(), mine);
    } finally {
      setRandomNumberGenerator(original);
    }
  });
});

Deno.test("lineage study - budgets and arm accounting", async () => {
  await withRngTestLock(() => {
    const corpus = buildStratifiedCorpus(SMALL);
    const limit = SMALL.evaluationBudget * 2 * SMALL.recordsPerSplit;
    for (const arm of ARMS) {
      const r: ArmResult = runArm(arm, SMALL, corpus);
      const last = r.generations[r.generations.length - 1];
      assert(last.recordsScored >= limit);
      if (r.generations.length > 1) {
        assert(r.generations[r.generations.length - 2].recordsScored < limit);
      }
      assertEquals(r.recordsScored, last.recordsScored);
      assert(r.diagnosticRecords > 0);
      assertEquals(
        r.recordsScored,
        r.evaluations * 2 * SMALL.recordsPerSplit + r.screenRecords,
      );
      assertEquals(
        r.holdoutRecords,
        r.generations.length * SMALL.recordsPerSplit,
      );
      if (!r.factors.targeting) {
        assertEquals(r.screenRecords, 0);
        assertEquals(r.targetedOffspring, 0);
      } else {
        assert(r.screenRecords > 0);
        assert(r.targetedOffspring > 0);
        for (const e of r.edges.filter((x) => x.kind === "targeted")) {
          let worst = 0;
          e.parentCalibration.forEach((v, s) => {
            if (v > e.parentCalibration[worst]) worst = s;
          });
          assertEquals(e.targetStratum, worst);
        }
      }
    }
  });
});

Deno.test("lineage study - a run is deterministic", async () => {
  await withRngTestLock(() => {
    const corpus = buildStratifiedCorpus(SMALL);
    for (const arm of ["ordinary", "history-targeted"] as ArmName[]) {
      const a = runArm(arm, SMALL, corpus);
      const b = runArm(arm, SMALL, corpus);
      assertEquals(a.finalTrainMse, b.finalTrainMse);
      assertEquals(
        a.edges.map((e) => e.operator),
        b.edges.map((e) => e.operator),
      );
    }
  });
});

/** A minimal result for the analysis tests. */
function fake(seed: number, holdout: number, diversity: number): ArmResult {
  return {
    seed,
    finalHoldoutMse: holdout,
    meanBehaviouralDiversity: diversity,
    toTarget: null,
  } as unknown as ArmResult;
}

Deno.test("lineage study - pairedComparison and verdict", () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const control = seeds.map((s) => fake(s, 1, 0.5));
  const better = pairedComparison(control, seeds.map((s) => fake(s, 0.9, 0.5)));
  assertEquals(better.wins, 10);
  assertEquals(verdict(better), "benefit");

  const worse = pairedComparison(control, seeds.map((s) => fake(s, 1.1, 0.5)));
  assertEquals(verdict(worse), "harm");

  const mixed = pairedComparison(
    control,
    seeds.map((s) => fake(s, s % 2 === 0 ? 0.5 : 1.5, 0.5)),
  );
  assertEquals(verdict(mixed), "no-benefit");

  const collapsed = pairedComparison(
    control,
    seeds.map((s) => fake(s, 0.9, 0.25)),
  );
  assertAlmostEquals(collapsed.diversityRatio, 0.5, 1e-9);
  assertNotEquals(verdict(collapsed), "benefit");

  assertThrows(() =>
    pairedComparison(control, seeds.map((s) => fake(s + 1, 0.9, 0.5)))
  );
});

Deno.test("lineage study - behaviouralDiversity measures output differences", () => {
  const probe = buildStratifiedCorpus(SMALL).calibration;
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  const clone = Creature.fromJSON(c.exportJSON());
  assertEquals(behaviouralDiversity([c, clone], probe), 0);
  assertEquals(behaviouralDiversity([c], probe), 0);
  assertEquals(behaviouralDiversity([], probe), 0);

  const shifted = Creature.fromJSON(c.exportJSON());
  const output = shifted.neurons.find((n) => n.type === "output")!;
  output.bias += 1;
  assert(behaviouralDiversity([c, shifted], probe) > 0);
});

Deno.test("lineage study - edges carry the affected gene keys", async () => {
  const corpus = buildStratifiedCorpus(SMALL);
  const result = await withRngTestLock(() => runArm("history", SMALL, corpus));
  assert(
    result.edges.some((e) =>
      e.changed && e.affected.genes.length > 0 &&
      e.affected.genes.length <= AFFECTED_GENES_CAP
    ),
    "expected a changed edge that names its genes",
  );
  for (const e of result.edges) {
    const { added, removed, changed, genes } = e.affected;
    assert(genes.length <= AFFECTED_GENES_CAP);
    assertEquals(
      genes.length,
      Math.min(AFFECTED_GENES_CAP, added + removed + changed),
    );
  }
});

Deno.test("lineage study - mean behavioural diversity excludes generation 1", async () => {
  const corpus = buildStratifiedCorpus(SMALL);
  const result = await withRngTestLock(() => runArm("ordinary", SMALL, corpus));
  const later = result.generations.filter((g) => g.generation >= 2);
  assert(later.length > 0, "expected more than one generation");
  assertAlmostEquals(
    result.meanBehaviouralDiversity,
    later.reduce((s, g) => s + g.behaviouralDiversity, 0) / later.length,
    1e-12,
  );
});

Deno.test("lineage study - validateSettings names the offending setting", () => {
  validateSettings(DEFAULT_STUDY_SETTINGS);
  validateSettings(SMALL);
  assertThrows(
    () => validateSettings({ ...SMALL, candidatesPerTarget: 0 }),
    Error,
    "candidatesPerTarget",
  );
  assertThrows(
    () => validateSettings({ ...SMALL, historyExploration: 1.5 }),
    Error,
    "historyExploration",
  );
});

Deno.test("lineage study - history selects the lowest delta for the relevant stratum", async () => {
  await withRngTestLock(() => {
    const saved = getRandomNumberGenerator();
    try {
      const settings = {
        ...SMALL,
        historyExploration: 0,
        historyProposals: 100,
        candidatesPerTarget: 1,
      };
      const corpus = buildStratifiedCorpus(settings);
      const parent = seedPopulation(settings, createSeededRng(7))[2];
      const errors = {
        train: stratumErrors(parent, corpus.train),
        calibration: stratumErrors(parent, corpus.calibration),
      };
      const history = new OperatorHistory();
      // Weight changes win overall; bias changes win in every individual
      // stratum, including this parent's worst one.
      history.record(edge("MOD_WEIGHT", [1, 1, 1, 1], -2));
      history.record(edge("MOD_BIAS", [-2, -2, -2, -2], 1));
      const breed = (arm: ArmName, prior: OperatorHistory) => {
        const ctx = createBreedContext(settings, corpus.calibration, prior);
        setRandomNumberGenerator(createSeededRng(11));
        return breedPair(arm, parent, errors, ctx, 1)[1];
      };
      assertEquals(breed("history", history).edge.operator, "MOD_WEIGHT");
      assertEquals(
        breed("history-targeted", history).edge.operator,
        "MOD_BIAS",
      );
      const ordinary = breed("ordinary", history);
      const unsteered = breed("ordinary", new OperatorHistory());
      assertEquals(ordinary.edge.operator, unsteered.edge.operator);
      assertEquals(
        stratumErrors(ordinary.child, corpus.calibration),
        stratumErrors(unsteered.child, corpus.calibration),
      );
    } finally {
      setRandomNumberGenerator(saved);
    }
  });
});

Deno.test("lineage study - best-of-R screening improves the targeted child and charges every candidate", async () => {
  await withRngTestLock(() => {
    const saved = getRandomNumberGenerator();
    try {
      const corpus = buildStratifiedCorpus(SMALL);
      const parent = seedPopulation(SMALL, createSeededRng(7))[2];
      const errors = {
        train: stratumErrors(parent, corpus.train),
        calibration: stratumErrors(parent, corpus.calibration),
      };
      let improvements = 0;
      for (const seed of [11, 12, 13, 14, 15]) {
        const breed = (candidatesPerTarget: number) => {
          const ctx = createBreedContext(
            { ...SMALL, candidatesPerTarget },
            corpus.calibration,
          );
          setRandomNumberGenerator(createSeededRng(seed));
          const child = breedPair("targeted", parent, errors, ctx, 1)[1];
          const stratum = child.edge.targetStratum!;
          const scored = stratumErrors(
            child.child,
            corpus.calibration,
            stratum,
          );
          assertEquals(ctx.screenRecords, candidatesPerTarget * scored.records);
          return { stratum, error: scored.overall };
        };
        const first = breed(1);
        const best = breed(8);
        assertEquals(best.stratum, first.stratum);
        assert(
          best.error <= first.error,
          `seed ${seed}: ${best.error} > ${first.error}`,
        );
        if (best.error < first.error) improvements++;
      }
      assert(
        improvements > 0,
        "screening must improve at least one seeded child",
      );
    } finally {
      setRandomNumberGenerator(saved);
    }
  });
});
