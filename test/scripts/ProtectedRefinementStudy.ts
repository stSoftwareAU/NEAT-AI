/**
 * The protected-refinement study harness (Issue #4158).
 *
 * The verdict the study reports is only as trustworthy as its parts, so the
 * parts are tested: the mutation classifier, the refinement round's safety
 * guarantees, each arm's accounting, the budget ceiling, the separation of the
 * holdout from selection, and the verdict rule on literal fixtures.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import {
  ARMS,
  buildStudyCorpus,
  chooseRefineRounds,
  classifyMutation,
  DEFAULT_REFINEMENT_SETTINGS,
  pairedComparison,
  type RefinementArm,
  type RefinementRunResult,
  type RefinementSettings,
  refineRound,
  runArm,
  validateSettings,
  verdict,
} from "../../scripts/lib/protectedRefinementStudy.ts";
import { scoreCreature } from "../../scripts/lib/preSelectionAB.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

const SMALL: RefinementSettings = {
  ...DEFAULT_REFINEMENT_SETTINGS,
  populationSize: 8,
  budgetRecords: 8_000,
  trainRecords: 60,
  holdoutRecords: 60,
  penCapacity: 2,
  refineRounds: 2,
};

const SEEDS = [4158, 4159, 4160, 4161];

function base(): CreatureExport {
  return new Creature(2, 1, { layers: [{ count: 2 }] }).exportJSON();
}

function clone(json: CreatureExport): CreatureExport {
  return JSON.parse(JSON.stringify(json));
}

Deno.test("classifyMutation: a new hidden neuron is a major addNeuron", () => {
  const before = base();
  const after = clone(before);
  after.neurons.push({
    type: "hidden",
    uuid: crypto.randomUUID(),
    bias: 0,
    squash: "TANH",
  });
  const kind = classifyMutation(before, after);
  assertEquals(kind.addNeuron, true);
  assertEquals(kind.major, true);
});

Deno.test("classifyMutation: a changed squash is a major activation change", () => {
  const before = base();
  const after = clone(before);
  after.neurons[0].squash = after.neurons[0].squash === "TANH"
    ? "LOGISTIC"
    : "TANH";
  const kind = classifyMutation(before, after);
  assertEquals(kind, {
    addNeuron: false,
    rewiring: false,
    activation: true,
    major: true,
  });
});

Deno.test("classifyMutation: adding or removing a synapse is rewiring", () => {
  const before = base();
  const removed = clone(before);
  removed.synapses.pop();
  assertEquals(classifyMutation(before, removed).rewiring, true);
  assertEquals(classifyMutation(before, removed).major, true);

  const added = clone(before);
  added.synapses.push(
    {
      weight: 0.1,
      fromUUID: before.synapses[4].fromUUID,
      toUUID: before.synapses[3].fromUUID,
    } as CreatureExport["synapses"][number],
  );
  assertEquals(classifyMutation(before, added).rewiring, true);
});

Deno.test("classifyMutation: weight and bias changes alone are not major", () => {
  const before = base();
  const after = clone(before);
  after.neurons[0].bias = (after.neurons[0].bias ?? 0) + 0.5;
  after.synapses[0].weight += 0.5;
  assertEquals(classifyMutation(before, after), {
    addNeuron: false,
    rewiring: false,
    activation: false,
    major: false,
  });
});

Deno.test("refineRound keeps structure, never worsens, charges, and does not touch its input", () => {
  const corpus = buildStudyCorpus(SMALL);
  const subsample = corpus.train.filter((_, i) => i % 10 === 0);
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const beforeJson = JSON.stringify(creature.exportJSON());
  const startScore = scoreCreature(creature, subsample).score;
  const structure = (c: Creature) => ({
    neurons: c.neurons.length,
    keys: c.synapses.map((s) => `${s.from}|${s.to}|${s.type}`),
  });
  const rng = createSeededRng(7);
  let current = creature;
  let known: number | undefined;
  let spent = 0;
  for (let i = 0; i < 5; i++) {
    const out = refineRound(current, subsample, 0.15, rng, known);
    assertEquals(structure(out.creature), structure(creature));
    assert(out.score >= startScore);
    spent += out.records;
    current = out.creature;
    known = out.score;
  }
  assert(spent > 0);
  assertEquals(JSON.stringify(creature.exportJSON()), beforeJson);
});

async function run(
  arm: RefinementArm,
  seed: number,
  settings = SMALL,
): Promise<RefinementRunResult> {
  return await runArm(arm, seed, settings, buildStudyCorpus(settings));
}

const withoutWall = (r: RefinementRunResult) => ({ ...r, wallMs: 0 });

Deno.test("runArm is deterministic and restores the caller's rng", async () => {
  await withRngTestLock(async () => {
    const mine = createSeededRng(99);
    setRandomNumberGenerator(mine);
    const a = await run("protect-refine", 4158);
    assertEquals(getRandomNumberGenerator(), mine);
    const b = await run("protect-refine", 4158);
    assertEquals(withoutWall(a), withoutWall(b));
  });
});

Deno.test("every arm stays within the budget and accounts its phases", async () => {
  await withRngTestLock(async () => {
    for (const arm of ARMS) {
      for (const seed of SEEDS.slice(0, 2)) {
        // Sequential: each run seeds the global generator.
        // deno-lint-ignore no-await-in-loop
        const r = await run(arm, seed);
        assert(r.recordsCharged <= SMALL.budgetRecords, `${arm} ${seed}`);
        assertEquals(
          r.recordsByPhase.evaluation + r.recordsByPhase.refinement,
          r.recordsCharged,
        );
      }
    }
  });
});

Deno.test("each arm spends refinement and pen capacity as designed", async () => {
  await withRngTestLock(async () => {
    const totals = new Map<RefinementArm, {
      refinement: number;
      penPeak: number;
      maxPen: number;
    }>();
    for (const arm of ARMS) {
      const t = { refinement: 0, penPeak: 0, maxPen: 0 };
      for (const seed of SEEDS) {
        // deno-lint-ignore no-await-in-loop
        const r = await run(arm, seed);
        t.refinement += r.recordsByPhase.refinement;
        t.penPeak += r.penPeak;
        t.maxPen = Math.max(t.maxPen, r.penPeak);
      }
      totals.set(arm, t);
    }
    assertEquals(totals.get("immediate")!.refinement, 0);
    assertEquals(totals.get("immediate")!.penPeak, 0);
    assertEquals(totals.get("protect-only")!.refinement, 0);
    assert(totals.get("protect-only")!.penPeak >= 1);
    assert(totals.get("protect-only")!.maxPen <= SMALL.penCapacity);
    assert(totals.get("protect-refine")!.maxPen <= SMALL.penCapacity);
    assert(totals.get("protect-refine")!.refinement > 0);
    assert(totals.get("refine-only")!.refinement > 0);
    assertEquals(totals.get("refine-only")!.penPeak, 0);
    assert(totals.get("matched-ordinary")!.refinement > 0);
  });
});

Deno.test("the holdout never guides the run", async () => {
  await withRngTestLock(async () => {
    const corpus = buildStudyCorpus(SMALL);
    const altered = {
      train: corpus.train,
      holdout: corpus.holdout.map((r) => ({ ...r, target: r.target + 5 })),
    };
    const a = await runArm("protect-refine", 4158, SMALL, corpus);
    const b = await runArm("protect-refine", 4158, SMALL, altered);
    assertEquals(a.trainMse, b.trainMse);
    assertEquals(a.recordsCharged, b.recordsCharged);
    assertEquals(a.generations, b.generations);
    assertNotEquals(a.holdoutMse, b.holdoutMse);
  });
});

function result(
  seed: number,
  holdoutMse: number,
  speciesCount = 5,
): RefinementRunResult {
  return {
    arm: "protect-refine",
    seed,
    trainMse: 0,
    holdoutMse,
    recordsCharged: 0,
    recordsByPhase: { evaluation: 0, refinement: 0 },
    generations: 1,
    wallMs: 0,
    majorProduced: 0,
    majorByKind: { addNeuron: 0, rewiring: 0, activation: 0 },
    majorCompeted: 4,
    majorRetained: 1,
    ordinaryCompeted: 0,
    ordinaryRetained: 0,
    penPeak: 0,
    speciesCount,
    meanGeneticDistance: 0,
    championHiddenNeurons: 0,
    stalled: false,
  };
}

const seedsTo = (n: number) => Array.from({ length: n }, (_, i) => i);

Deno.test("verdict: a clear benefit", () => {
  const arm = seedsTo(10).map((s) => result(s, 0.1 + s * 0.001));
  const baseline = seedsTo(10).map((s) => result(s, 0.2 + s * 0.001));
  const c = pairedComparison(arm, baseline, "benefit");
  assertEquals(c.wins, 10);
  assertEquals(c.verdict, "benefit");
  assertEquals(c.retainedFractionArm, 0.25);
});

Deno.test("verdict: a clear harm", () => {
  const arm = seedsTo(10).map((s) => result(s, 0.3 + s * 0.001));
  const baseline = seedsTo(10).map((s) => result(s, 0.2 + s * 0.001));
  const c = pairedComparison(arm, baseline, "harm");
  assertEquals(c.losses, 10);
  assertEquals(c.verdict, "harm");
});

Deno.test("verdict: mixed differences are no-benefit", () => {
  const arm = seedsTo(10).map((s) => result(s, 0.2 + (s % 2 ? 0.01 : -0.01)));
  const baseline = seedsTo(10).map((s) => result(s, 0.2));
  const c = pairedComparison(arm, baseline, "none");
  assertEquals(c.verdict, "no-benefit");
});

Deno.test("verdict: a benefit with a species ratio under 0.8 is no-benefit", () => {
  const arm = seedsTo(10).map((s) => result(s, 0.1 + s * 0.001, 3));
  const baseline = seedsTo(10).map((s) => result(s, 0.2 + s * 0.001, 5));
  const c = pairedComparison(arm, baseline, "collapse");
  assertEquals(c.speciesRatio, 0.6);
  assert(c.ci95.upper < 0);
  assertEquals(c.verdict, "no-benefit");
  assertEquals(
    verdict({
      ci95: { lower: -2, upper: -1 },
      winFraction: 0.59,
      speciesRatio: 1,
    }),
    "no-benefit",
  );
});

Deno.test("validateSettings accepts the defaults and names the offending field", () => {
  validateSettings(DEFAULT_REFINEMENT_SETTINGS);
  const bad = (patch: Partial<RefinementSettings>, field: string) =>
    assertThrows(
      () => validateSettings({ ...DEFAULT_REFINEMENT_SETTINGS, ...patch }),
      Error,
      field,
    );
  bad({ populationSize: 0 }, "populationSize");
  bad({ trainRecords: 1.5 }, "trainRecords");
  bad({ refineRounds: 11 }, "refineRounds");
  bad({ refineSigma: 0 }, "refineSigma");
  bad({ penCapacity: 20 }, "penCapacity");
  bad({ budgetRecords: 100 }, "budgetRecords");
});

Deno.test("chooseRefineRounds picks the lowest median train MSE, ties to the first", () => {
  assertEquals(
    chooseRefineRounds([
      { refineRounds: 2, medianTrainMse: 0.3 },
      { refineRounds: 3, medianTrainMse: 0.1 },
      { refineRounds: 4, medianTrainMse: 0.2 },
    ]),
    3,
  );
  assertEquals(
    chooseRefineRounds([
      { refineRounds: 2, medianTrainMse: 0.1 },
      { refineRounds: 3, medianTrainMse: 0.1 },
    ]),
    2,
  );
});
