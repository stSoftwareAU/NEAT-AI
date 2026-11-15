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
  distribution,
  drawNewEdgeWeights,
  DRAWS,
  type MutationRecord,
  precisionVerdict,
  ruleOutcome,
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

/**
 * The cheap and train corpora share the same numbers unless `train` gives the
 * full train set its own; the holdout does likewise through `holdout`.
 */
function record(
  parent: number,
  topo: number[],
  weight: number[],
  holdout?: { topo: number[]; weight: number[] },
  train?: { topo: number[]; weight: number[] },
): MutationRecord {
  const mse = (
    v: number,
    h?: number,
    t?: number,
  ) => ({
    cheap: v,
    train: t ?? v,
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
      mse: mse(v, holdout?.topo[k], train?.topo[k]),
    })),
    weightOnly: weight.map((v, k) => ({
      k,
      synapse: { fromUUID: "a", toUUID: "b" },
      delta: 0.5,
      budget: 0.5,
      mse: mse(v, holdout?.weight[k], train?.weight[k]),
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

/**
 * Cheap shape `cheap`, holdout confirmed or not. The train shape follows the
 * cheap one unless `train` names another.
 */
function shaped(
  cheap: number[],
  holdoutConfirmed: boolean,
  train: number[] = cheap,
): MutationRecord {
  const r = record(1, cheap, FLAT);
  const h = holdoutConfirmed ? GENUINE : BAD;
  for (let k = 0; k < DRAWS; k++) {
    r.topology[k].mse.holdout = h[k];
    r.topology[k].mse.train = train[k];
  }
  return r;
}

function many(n: number, make: () => MutationRecord): MutationRecord[] {
  return Array.from({ length: n }, make);
}

const LATE = [1.5, 0.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5];

/**
 * Fourteen mutations where the cheap shape and the holdout shape disagree.
 * Train follows the cheap shape; the holdout gain is +0.5 when confirmed and
 * -0.5 when not.
 *   3 x GENUINE cheap, holdout confirmed
 *   2 x GENUINE cheap, holdout not confirmed
 *   4 x LUCKY cheap, holdout confirmed
 *   1 x LUCKY cheap, holdout not confirmed
 *   2 x LATE cheap (late luck), holdout confirmed
 *   2 x BAD cheap, holdout confirmed
 */
function disagreeing(holdoutFlip = false): MutationRecord[] {
  const h = (confirmed: boolean) => holdoutFlip ? !confirmed : confirmed;
  return [
    ...many(3, () => shaped(GENUINE, h(true))),
    ...many(2, () => shaped(GENUINE, h(false))),
    ...many(4, () => shaped(LUCKY, h(true))),
    ...many(1, () => shaped(LUCKY, h(false))),
    ...many(2, () => shaped(LATE, h(true))),
    ...many(2, () => shaped(BAD, h(true))),
  ];
}

Deno.test("ruleOutcome counts, precisions, mean gain and cost match a hand calculation", () => {
  const records = disagreeing();
  assertEquals(records.length, 14);
  const outcome = (name: string) => ruleOutcome(rule(name), records, 10);

  // single-draw selects on the first draw: GENUINE (5) and LUCKY (5), not LATE.
  const single = outcome("single-draw");
  assertEquals(single.rule, "single-draw");
  assertEquals(single.selected, 10);
  assertEquals(single.confirmedTrain, 5); // the GENUINE ones
  assertEquals(single.confirmedHoldout, 7); // 3 GENUINE + 4 LUCKY
  assertAlmostEquals(single.precisionTrain!, 0.5);
  assertAlmostEquals(single.precisionHoldout!, 0.7);
  // (3 x 0.5 - 2 x 0.5 + 4 x 0.5 - 1 x 0.5) / 10
  assertAlmostEquals(single.meanHoldoutGainSelected!, 0.2);
  assertEquals(single.selectionCostRecords, 14 * 2 * 10);

  // best-draw also takes the two LATE mutations.
  const best = outcome("best-draw");
  assertEquals(best.selected, 12);
  assertEquals(best.confirmedTrain, 5);
  assertEquals(best.confirmedHoldout, 9);
  assertAlmostEquals(best.precisionTrain!, 5 / 12);
  assertAlmostEquals(best.precisionHoldout!, 0.75);
  assertAlmostEquals(best.meanHoldoutGainSelected!, 0.25);
  assertEquals(best.selectionCostRecords, 14 * 16 * 10);

  // median-paired takes only the five GENUINE ones; holdout confirms three.
  const med = outcome("median-paired");
  assertEquals(med.selected, 5);
  assertEquals(med.confirmedTrain, 5);
  assertEquals(med.confirmedHoldout, 3);
  assertAlmostEquals(med.precisionTrain!, 1);
  assertAlmostEquals(med.precisionHoldout!, 0.6);
  assertAlmostEquals(med.meanHoldoutGainSelected!, 0.1);
  assertEquals(med.selectionCostRecords, 14 * 16 * 10);
});

Deno.test("ruleOutcome reports null precision and gain when nothing is selected, and still charges the cost", () => {
  const none = ruleOutcome(
    rule("median-paired"),
    many(3, () => shaped(BAD, true)),
    10,
  );
  assertEquals(none.selected, 0);
  assertEquals(none.confirmedTrain, 0);
  assertEquals(none.confirmedHoldout, 0);
  assertEquals(none.precisionTrain, null);
  assertEquals(none.precisionHoldout, null);
  assertEquals(none.meanHoldoutGainSelected, null);
  assertEquals(none.selectionCostRecords, 3 * 16 * 10);
});

Deno.test("ruleOutcome selection ignores the holdout but the holdout figures follow it", () => {
  const a = ruleOutcome(rule("median-paired"), disagreeing(), 10);
  const b = ruleOutcome(rule("median-paired"), disagreeing(true), 10);
  // Selection and every train figure are identical.
  assertEquals(b.selected, a.selected);
  assertEquals(b.confirmedTrain, a.confirmedTrain);
  assertEquals(b.precisionTrain, a.precisionTrain);
  assertEquals(b.selectionCostRecords, a.selectionCostRecords);
  // With the holdout flipped, the five GENUINE picks are confirmed 2 of 5.
  assertEquals(a.confirmedHoldout, 3);
  assertEquals(b.confirmedHoldout, 2);
  assertAlmostEquals(b.precisionHoldout!, 0.4);
  assertAlmostEquals(b.meanHoldoutGainSelected!, -0.1);
});

Deno.test("ruleOutcome selects on the cheap sample and confirms on the train set", () => {
  // Cheap says GENUINE (selected by median-paired), train says BAD.
  const cheapGood = many(3, () => shaped(GENUINE, true, BAD));
  // Cheap says BAD (not selected), train says GENUINE.
  const trainGood = many(2, () => shaped(BAD, true, GENUINE));
  // Cheap and train both say GENUINE.
  const both = many(4, () => shaped(GENUINE, false));
  const records = [...cheapGood, ...trainGood, ...both];
  const out = ruleOutcome(rule("median-paired"), records, 10);
  // Selected follows the cheap shape: 3 + 4.
  assertEquals(out.selected, 7);
  // Confirmed train follows the train shape: only the 4 that agree.
  assertEquals(out.confirmedTrain, 4);
  assertAlmostEquals(out.precisionTrain!, 4 / 7);
  // Holdout confirms the 3 cheapGood and none of the 4 unconfirmed.
  assertEquals(out.confirmedHoldout, 3);
  assertAlmostEquals(out.precisionHoldout!, 3 / 7);
  assertEquals(out.selectionCostRecords, 9 * 16 * 10);

  // The same data, compared by precision, uses the cheap selection too.
  const cmp = comparePrecision(
    records,
    rule("median-paired"),
    rule("single-draw"),
    50,
    1,
  );
  // single-draw selects the same 7 (first draw wins on cheap) so no difference.
  assertEquals(cmp.observed, 0);
});

Deno.test("distribution gives the histogram and fractions by hand", () => {
  const records = disagreeing();
  // Cheap: 5 GENUINE win 8 draws; 5 LUCKY and 2 LATE win 1; 2 BAD win 0.
  const cheap = distribution(records, "cheap", 200);
  assertEquals(cheap.n, 14);
  assertEquals(cheap.signConsistencyHistogram, [2, 7, 0, 0, 0, 0, 0, 0, 5]);
  assertAlmostEquals(cheap.fractionConsistent!, 5 / 14);
  // LUCKY and LATE: best draw wins, median does not: 7 of 14.
  assertAlmostEquals(cheap.fractionLuckOnly!, 0.5);
  // Nine medians of -0.5 and five of +0.5.
  assertEquals(cheap.medianOfMedianPairedGain, -0.5);
  assert(cheap.medianCi!.low <= cheap.medianCi!.high);

  // Holdout: the three confirmed shapes win 8 draws, the others win 0.
  const holdout = distribution(records, "holdout", 200);
  assertEquals(holdout.signConsistencyHistogram, [3, 0, 0, 0, 0, 0, 0, 0, 11]);
  assertAlmostEquals(holdout.fractionConsistent!, 11 / 14);
  assertEquals(holdout.fractionLuckOnly, 0);
  assertEquals(holdout.medianOfMedianPairedGain, 0.5);
});

Deno.test("distribution of no records is null with an all-zero histogram", () => {
  const empty = distribution([], "holdout", 50);
  assertEquals(empty.n, 0);
  assertEquals(empty.medianOfMedianPairedGain, null);
  assertEquals(empty.medianCi, null);
  assertEquals(empty.fractionConsistent, null);
  assertEquals(empty.fractionLuckOnly, null);
  assertEquals(empty.signConsistencyHistogram, new Array(9).fill(0));
});

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
      // One parent score plus eight topology and eight weight-only draws,
      // each on 17 corpus passes of the cheap, train and holdout sets.
      assertEquals(m.records, {
        cheap: 17 * TINY.cheapRecords,
        train: 17 * TINY.trainRecords,
        holdout: 17 * TINY.holdoutRecords,
      });
    }
    const sum = (pick: (m: MutationRecord) => number) =>
      a.mutations.reduce((t, m) => t + pick(m), 0);
    assertEquals(a.cost.cheapRecords, sum((m) => m.records.cheap));
    assertEquals(a.cost.trainRecords, sum((m) => m.records.train));
    assertEquals(a.cost.holdoutRecords, sum((m) => m.records.holdout));
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
