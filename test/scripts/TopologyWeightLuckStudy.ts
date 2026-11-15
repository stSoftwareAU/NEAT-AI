/**
 * The topology-versus-luck harness (Issue #4162): the draws are reproducible
 * Float32 values, the variants change exactly one thing, the summary and the
 * selection rules say what the criteria say, and selection never sees the
 * holdout.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { buildControlCreature } from "../../scripts/lib/connectivityPriorStudy.ts";
import {
  buildTopologyVariant,
  buildWeightOnlyVariant,
  chooseNewEdge,
  comparePrecision,
  DEFAULT_SETTINGS,
  drawNewEdgeWeights,
  DRAWS,
  type MutationRecord,
  precisionVerdict,
  RULES,
  runStudy,
  summarise,
  validateSettings,
} from "../../scripts/lib/topologyWeightLuckStudy.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

const rule = (name: string) => RULES.find((r) => r.name === name)!;

Deno.test("drawNewEdgeWeights gives reproducible, distinct Float32 values and restores the generator", async () => {
  await withRngTestLock(() => {
    const before = getRandomNumberGenerator();
    const a = drawNewEdgeWeights();
    const b = drawNewEdgeWeights();
    assertEquals(a.length, 8);
    assertEquals(a, b);
    for (const w of a) {
      assertEquals(Math.fround(w), w);
      assertNotEquals(w, 0);
    }
    assert(new Set(a).size > 1, "draws must not all be equal");
    assert(getRandomNumberGenerator() === before);
  });
});

Deno.test("buildTopologyVariant adds exactly one synapse and leaves the parent alone", () => {
  const parent = buildControlCreature(createSeededRng(3));
  const edge = chooseNewEdge(parent, createSeededRng(1));
  const before = JSON.stringify(parent.exportJSON());
  const parentUuid = CreatureUtil.makeUUID(parent);
  const variant = buildTopologyVariant(parent, edge, 0.375);
  assertEquals(variant.synapses.length, parent.synapses.length + 1);
  const added = variant.synapses.filter((s) =>
    s.from === edge.from && s.to === edge.to
  );
  assertEquals(added.length, 1);
  assertEquals(added[0].weight, 0.375);
  assertEquals(JSON.stringify(parent.exportJSON()), before);
  assertNotEquals(CreatureUtil.makeUUID(variant), parentUuid);
});

Deno.test("buildWeightOnlyVariant moves exactly one weight by the matched budget", () => {
  const parent = buildControlCreature(createSeededRng(3));
  for (const s of parent.synapses) s.weight = Math.fround(s.weight);
  const before = JSON.stringify(parent.exportJSON());
  const out = buildWeightOnlyVariant(parent, 0.25, createSeededRng(9));
  const pairs = (c: Creature) => c.synapses.map((s) => `${s.from}>${s.to}`);
  assertEquals(pairs(out.creature), pairs(parent));
  const changed = out.creature.synapses.filter((s, i) =>
    s.weight !== parent.synapses[i].weight
  );
  assertEquals(changed.length, 1);
  const i = out.creature.synapses.indexOf(changed[0]);
  const diff = Math.abs(changed[0].weight - parent.synapses[i].weight);
  assertEquals(diff, out.realisedBudget);
  assert(Math.abs(diff - 0.25) / 0.25 < 1e-6);
  assertEquals(JSON.stringify(parent.exportJSON()), before);
  assertNotEquals(
    CreatureUtil.makeUUID(out.creature),
    CreatureUtil.makeUUID(parent),
  );
});

Deno.test("chooseNewEdge picks an absent forward pair and refuses a full creature", () => {
  const parent = buildControlCreature(createSeededRng(3));
  for (let seed = 1; seed <= 5; seed++) {
    const edge = chooseNewEdge(parent, createSeededRng(seed));
    assert(edge.from < edge.to);
    assert(edge.to >= parent.input);
    assert(!parent.hasConnection(edge.from, edge.to));
  }
  const tiny = (withSynapse: boolean) =>
    Creature.fromJSON({
      neurons: [{
        type: "output",
        uuid: "output-0",
        squash: "IDENTITY",
        bias: 0,
      }],
      synapses: withSynapse
        ? [{ fromUUID: "input-0", toUUID: "output-0", weight: 0.5 }]
        : [],
      input: 1,
      output: 1,
      forwardOnly: true,
    });
  const open = chooseNewEdge(tiny(false), createSeededRng(1));
  assertEquals([open.fromUUID, open.toUUID], ["input-0", "output-0"]);
  assertThrows(
    () => chooseNewEdge(tiny(true), createSeededRng(1)),
    Error,
    "no available forward connection",
  );
});

/** Every corpus shares the same numbers, so one literal set describes a record. */
function record(
  parent: number,
  topo: number[],
  weight: number[],
  holdout?: { topo: number[]; weight: number[] },
): MutationRecord {
  const mse = (v: number, h?: number) => ({
    cheap: v,
    train: v,
    holdout: h ?? v,
  });
  return {
    parentId: "x",
    edge: { fromUUID: "a", toUUID: "b" },
    parentMse: mse(parent),
    topology: topo.map((v, k) => ({
      k,
      weight: 0.5,
      budget: 0.5,
      mse: mse(v, holdout?.topo[k]),
    })),
    weightOnly: weight.map((v, k) => ({
      k,
      synapse: { fromUUID: "a", toUUID: "b" },
      delta: 0.5,
      budget: 0.5,
      mse: mse(v, holdout?.weight[k]),
    })),
    records: { cheap: 0, train: 0, holdout: 0 },
  };
}

Deno.test("summarise computes the paired arithmetic by hand", () => {
  const s = summarise(
    record(
      1,
      [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      [1, 1, 1, 1, 1, 1, 0.25, 0.25],
    ),
    "cheap",
  );
  assertEquals(s.pairedDiffs, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.25, -0.25]);
  assertEquals(s.medianPairedGain, 0.5);
  assertEquals(s.signConsistency, 6);
  assertEquals(s.medianTopologyGain, 0.5);
  // weight gains: 0 x6, 0.75 x2 -> median 0
  assertEquals(s.medianWeightGain, 0);
  // best topology gain 0.5, best weight gain 0.75
  assertEquals(s.bestDrawGain, -0.25);
  assertEquals(s.firstDrawGain, 0.5);
  assert(rule("median-paired").selects(s));
  assert(rule("single-draw").selects(s));
  assert(!rule("best-draw").selects(s));
});

Deno.test("a lucky draw is selected by best-draw but not by median-paired", () => {
  const weight = [1, 1, 1, 1, 1, 1, 1, 1];
  const lucky = summarise(
    record(1, [0.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5], weight),
    "cheap",
  );
  assertEquals(lucky.medianPairedGain, -0.5);
  assertEquals(lucky.signConsistency, 1);
  assertEquals(lucky.bestDrawGain, 0.5);
  assert(rule("best-draw").selects(lucky));
  assert(!rule("median-paired").selects(lucky));
  assert(rule("single-draw").selects(lucky));
  const lateLuck = summarise(
    record(1, [1.5, 0.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5], weight),
    "cheap",
  );
  assert(rule("best-draw").selects(lateLuck));
  assert(!rule("single-draw").selects(lateLuck));
  assert(!rule("median-paired").selects(lateLuck));
});

const GENUINE = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
const BAD = [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5];
const LUCKY = [0.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5];
const FLAT = [1, 1, 1, 1, 1, 1, 1, 1];

/** Cheap shape `cheap`, holdout confirmed or not. */
function shaped(cheap: number[], holdoutConfirmed: boolean): MutationRecord {
  const r = record(1, cheap, FLAT);
  const h = holdoutConfirmed ? GENUINE : BAD;
  for (let k = 0; k < DRAWS; k++) r.topology[k].mse.holdout = h[k];
  return r;
}

function many(n: number, make: () => MutationRecord): MutationRecord[] {
  return Array.from({ length: n }, make);
}

Deno.test("comparePrecision reports benefit, harm and no-benefit", () => {
  const median = rule("median-paired");
  const best = rule("best-draw");
  const benefit = [
    ...many(20, () => shaped(GENUINE, true)),
    ...many(20, () => shaped(LUCKY, false)),
  ];
  const b = comparePrecision(benefit, median, best, 500, 1);
  assertEquals(b.verdict, "benefit");
  assertAlmostEquals(b.observed!, 0.5);
  assert(b.ci!.low > 0);

  const harm = [
    ...many(20, () => shaped(GENUINE, false)),
    ...many(20, () => shaped(LUCKY, true)),
  ];
  const h = comparePrecision(harm, median, best, 500, 1);
  assertEquals(h.verdict, "harm");
  assert(h.ci!.high < 0);

  const same = [
    ...many(10, () => shaped(GENUINE, true)),
    ...many(10, () => shaped(GENUINE, false)),
    ...many(5, () => shaped(BAD, true)),
  ];
  const s = comparePrecision(same, median, best, 500, 1);
  assertEquals(s.observed, 0);
  assertEquals(s.verdict, "no-benefit");

  const none = comparePrecision(
    many(5, () => shaped(BAD, true)),
    median,
    best,
    50,
    1,
  );
  assertEquals(none.ci, null);
  assertEquals(none.undefinedResamples, 50);
  assertEquals(none.verdict, "no-benefit");
  assertEquals(precisionVerdict({ low: -1, high: 1 }), "no-benefit");
});

Deno.test("validateSettings names the field it refuses", () => {
  validateSettings(DEFAULT_SETTINGS);
  assertThrows(
    () => validateSettings({ ...DEFAULT_SETTINGS, cheapRecords: 400 }),
    Error,
    "cheapRecords",
  );
  assertThrows(
    () => validateSettings({ ...DEFAULT_SETTINGS, populationSize: 0 }),
    Error,
    "populationSize",
  );
  assertThrows(
    () => validateSettings({ ...DEFAULT_SETTINGS, mutationRate: 0 }),
    Error,
    "mutationRate",
  );
});

const TINY = {
  parentRuns: 1,
  parentsPerRun: 2,
  populationSize: 4,
  generations: 2,
  trainRecords: 40,
  holdoutRecords: 40,
  cheapRecords: 10,
};

Deno.test("a tiny study is complete, reproducible and never selects on the holdout", async () => {
  await withRngTestLock(() => {
    const a = runStudy({ settings: TINY, bootstrapResamples: 200 });
    const b = runStudy({ settings: TINY, bootstrapResamples: 200 });
    assertEquals(a.coverage.failures, []);
    assertEquals(a.coverage.targetParents, 2);
    assert(a.coverage.actualParents >= 1);
    assertEquals(a.coverage.mutationsEvaluated, a.coverage.actualParents);
    assertEquals(a.mutations.length, a.coverage.mutationsEvaluated);
    for (const m of a.mutations) {
      assertEquals(m.topology.length, 8);
      assertEquals(m.weightOnly.length, 8);
    }
    assertEquals(a.mutations, b.mutations);
    assertEquals(a.rules, b.rules);

    const wider = runStudy({
      settings: { ...TINY, holdoutRecords: 60 },
      bootstrapResamples: 200,
    });
    assertEquals(wider.coverage.failures, []);
    assertEquals(
      wider.rules.map((r) => r.selected),
      a.rules.map((r) => r.selected),
    );
    assertEquals(
      wider.mutations.map((m) => summarise(m, "cheap")),
      a.mutations.map((m) => summarise(m, "cheap")),
    );
  });
});
