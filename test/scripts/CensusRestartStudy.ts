/**
 * The census-restart study harness (Issue #4157).
 *
 * The harness decides whether an offspring-census trigger beats a stagnation
 * trigger, so its arithmetic is tested rather than trusted: the census key
 * merges what it should and nothing else, the window counts exactly, the
 * restart action keeps what it promises, each trigger fires only when it
 * should, and the holdout never guides a run.
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
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import {
  type ArmResult,
  buildSplits,
  type CalibrationRow,
  censusKey,
  CensusWindow,
  chooseCensusSetting,
  DEFAULT_STUDY_SETTINGS,
  pairedComparison,
  partialReseed,
  runArm,
  STUDY_ARMS,
  type StudySettings,
  SUCCESS_CRITERIA,
  validateSettings,
  verdict,
} from "../../scripts/lib/censusRestartStudy.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

const SMALL: StudySettings = {
  ...DEFAULT_STUDY_SETTINGS,
  trainRecords: 60,
  holdoutRecords: 40,
  diversityProbeRecords: 16,
  populationSize: 8,
  elitism: 2,
  recordBudget: 60 * 8 * 30,
  restartCooldownGenerations: 3,
  plateauWindow: 3,
  censusWindowGenerations: 2,
};

const arm = (name: string) => STUDY_ARMS.find((a) => a.name === name)!;

type Exported = ReturnType<Creature["exportJSON"]>;

function base(): Exported {
  return new Creature(2, 1, { layers: [{ count: 2 }] }).exportJSON();
}

/** A copy of `exported` with weights and biases set from `value(index)`. */
function build(
  exported: Exported,
  value: (index: number) => number,
): Creature {
  const copy: Exported = JSON.parse(JSON.stringify(exported));
  let index = 0;
  for (const neuron of copy.neurons) {
    if (neuron.type !== "constant") neuron.bias = value(index++);
  }
  for (const synapse of copy.synapses) synapse.weight = value(index++);
  return Creature.fromJSON(copy);
}

function nudged(exported: Exported, delta: number): Creature {
  const copy: Exported = JSON.parse(JSON.stringify(exported));
  copy.synapses[0].weight += delta;
  return Creature.fromJSON(copy);
}

Deno.test("censusKey merges sub-step weight differences and nothing else", () => {
  // Weights sit on step centres, so a nudge below q/2 cannot cross a boundary.
  const q = 0.1;
  const source = build(base(), (i) => 0.1 * ((i % 7) - 3));
  const exported = source.exportJSON();
  const key = censusKey(source, q);

  assertEquals(censusKey(Creature.fromJSON(exported), q), key);
  assertEquals(censusKey(nudged(exported, 0.03), q), key);
  assertNotEquals(censusKey(nudged(exported, 0.2), q), key);

  const extra = Creature.fromJSON(JSON.parse(JSON.stringify(exported)));
  const outputIndex = extra.neurons.length - 1;
  assertEquals(extra.neurons[outputIndex].type, "output");
  extra.connect(0, outputIndex, 0.3);
  assertNotEquals(censusKey(extra, q), key);
  assertNotEquals(
    CreatureUtil.getTopologyHash(extra),
    CreatureUtil.getTopologyHash(source),
  );

  // A finer step separates what a coarser one merges.
  const close = nudged(exported, 0.04);
  assertEquals(censusKey(close, 1), censusKey(source, 1));
  assertNotEquals(censusKey(close, 0.005), censusKey(source, 0.005));
});

Deno.test("censusKey does not modify the creature", () => {
  const creature = build(base(), (i) => 0.13 * i - 0.5);
  const before = JSON.stringify(creature.exportJSON());
  censusKey(creature, 0.05);
  assertEquals(JSON.stringify(creature.exportJSON()), before);
});

Deno.test("CensusWindow counts identities exactly", () => {
  const window = new CensusWindow(3);
  // Generation 1: a, a, b in species S. Generation 2: c in S, a in species T.
  window.record(1, "S", "a");
  window.record(1, "S", "a");
  window.record(1, "S", "b");
  window.record(2, "S", "c");
  window.record(2, "T", "a");
  const estimate = window.estimate();
  assertEquals(estimate.n, 5);
  // Identities: S/a x2, S/b, S/c, T/a -> 4 distinct, 3 singletons.
  assertEquals(estimate.distinct, 4);
  assertEquals(estimate.singletons, 3);
  assertAlmostEquals(estimate.unseen, 3 / 5);
  assertAlmostEquals(estimate.collisionRate, 1 / 5);
  assertEquals(window.spannedGenerations(), 2);
});

Deno.test("CensusWindow drops entries older than its window and starts at unseen 1", () => {
  const window = new CensusWindow(2);
  assertEquals(window.estimate(), {
    n: 0,
    distinct: 0,
    singletons: 0,
    unseen: 1,
    collisionRate: 0,
  });
  window.record(1, "S", "a");
  window.record(2, "S", "a");
  assertEquals(window.estimate().n, 2);
  assertEquals(window.estimate().distinct, 1);
  window.record(3, "S", "b");
  // Generation 1 is now out of a two-generation window.
  const estimate = window.estimate();
  assertEquals(estimate.n, 2);
  assertEquals(estimate.distinct, 2);
  assertEquals(estimate.singletons, 2);
  assertEquals(estimate.unseen, 1);
  window.clear();
  assertEquals(window.estimate().unseen, 1);
});

Deno.test("partialReseed keeps the champion and the rarest topology, and never mutates kept creatures", () => {
  withSeededRng(() => {
    // Clones share neuron uuids, hence a topology hash.
    const template = new Creature(2, 1, { layers: [{ count: 1 }] })
      .exportJSON();
    const common = () =>
      Creature.fromJSON(JSON.parse(JSON.stringify(template)));
    const rare = new Creature(2, 1, { layers: [{ count: 3 }] });
    const population: Creature[] = [];
    for (let i = 0; i < 7; i++) {
      const c = common();
      CreatureUtil.makeUUID(c);
      c.score = -1 - i; // champion is population[0] (score -1)
      population.push(c);
    }
    CreatureUtil.makeUUID(rare);
    rare.score = -50; // worst score, unique topology
    population.push(rare);
    assertEquals(population.length, 8);

    const snapshot = population.map((c) => JSON.stringify(c.exportJSON()));
    const uuids = population.map((c) => c.uuid);
    const next = partialReseed(population, 8, 0.5, createSeededRng(3));

    assertEquals(next.length, 8);
    assert(next.includes(population[0]), "champion kept");
    assert(next.includes(rare), "rarest topology kept");
    // (1 - 0.5) * 8 = 4 kept, so 4 fresh unscored creatures.
    const kept = next.filter((c) => population.includes(c));
    assertEquals(kept.length, 4);
    assertEquals(next.filter((c) => c.score === undefined).length, 4);
    assertEquals(
      population.map((c) => JSON.stringify(c.exportJSON())),
      snapshot,
    );
    assertEquals(population.map((c) => c.uuid), uuids);
  });
});

Deno.test("partialReseed picks a novel creature different from the champion", () => {
  withSeededRng(() => {
    const a = new Creature(2, 1, { layers: [{ count: 1 }] });
    const b = new Creature(2, 1, { layers: [{ count: 2 }] });
    CreatureUtil.makeUUID(a);
    CreatureUtil.makeUUID(b);
    a.score = -1;
    b.score = -2;
    const next = partialReseed([a, b], 4, 0.5, createSeededRng(1));
    assertEquals(next.length, 4);
    assert(next.includes(a) && next.includes(b));
  });
});

function withSeededRng(fn: () => void): void {
  const previous = getRandomNumberGenerator();
  try {
    setRandomNumberGenerator(createSeededRng(1));
    fn();
  } finally {
    setRandomNumberGenerator(previous);
  }
}

const withoutWall = (r: ArmResult) => ({ ...r, wallMs: 0 });

Deno.test("runArm is deterministic per seed and restores the caller's generator", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    setRandomNumberGenerator(createSeededRng(77));
    const caller = getRandomNumberGenerator();
    const first = await runArm(arm("census"), SMALL, 11, splits, 0.05);
    assert(getRandomNumberGenerator() === caller);
    const second = await runArm(arm("census"), SMALL, 11, splits, 0.05);
    assertEquals(withoutWall(first), withoutWall(second));
  });
});

Deno.test("no arm exceeds the budget, and a restart arm spends all of it where breeding stalls", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    for (const a of STUDY_ARMS) {
      // deno-lint-ignore no-await-in-loop
      const result = await runArm(a, SMALL, 5, splits);
      assert(result.recordsCharged <= SMALL.recordBudget, a.name);
      assert(
        result.recordsCharged >= SMALL.trainRecords * SMALL.populationSize,
      );
      assert(result.generations >= 2, a.name);
    }
    // At this seed the population converges, breeding is declined and `none`
    // has nothing left to spend on; the stagnation restart keeps it going.
    const restarted = await runArm(arm("stagnation"), SMALL, 5, splits);
    assert(
      restarted.recordsCharged > SMALL.recordBudget - SMALL.trainRecords,
    );
  });
});

Deno.test("the none arm never restarts but still measures the stagnation signal", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    const result = await runArm(arm("none"), SMALL, 5, splits);
    assertEquals(result.restarts, 0);
    assertEquals(result.firstRestartRecords, null);
    assertEquals(result.restartDelayRecords, null);
    assert(result.trace.every((e) => !e.restarted));
    // Elites keep the best score from falling, so a small run plateaus.
    assert(result.firstStagnationSignalRecords !== null);
  });
});

Deno.test("the stagnation arm restarts only after the plateau signal, respecting cooldown", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    const result = await runArm(arm("stagnation"), SMALL, 5, splits);
    assert(result.restarts > 0, "expected a stagnation restart on this seed");
    assert(result.firstStagnationSignalRecords !== null);
    assert(
      result.firstRestartRecords! >= result.firstStagnationSignalRecords!,
    );
    assertEquals(
      result.restartDelayRecords,
      result.firstRestartRecords! - result.firstStagnationSignalRecords!,
    );
    const restartGenerations = result.trace.filter((e) => e.restarted).map((
      e,
    ) => e.generation);
    for (let i = 1; i < restartGenerations.length; i++) {
      assert(
        restartGenerations[i] - restartGenerations[i - 1] >=
          SMALL.restartCooldownGenerations,
      );
    }
  });
});

Deno.test("the census trigger restarts at a threshold near 1 and never at a tiny one", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    // A coarse step collapses weights, so offspring of one topology collide.
    const loose = {
      ...SMALL,
      censusQuantisation: 100,
      censusUnseenThreshold: 0.999,
    };
    const eager = await runArm(arm("census"), loose, 5, splits);
    assert(eager.restarts > 0, "positive control: expected a census restart");
    const generations = eager.trace.filter((e) => e.restarted).map((e) =>
      e.generation
    );
    for (let i = 1; i < generations.length; i++) {
      assert(
        generations[i] - generations[i - 1] >=
          SMALL.restartCooldownGenerations,
      );
    }
    assertEquals(
      eager.trace.filter((e) => e.restarted).length,
      eager.restarts,
    );

    const never = await runArm(
      arm("census"),
      { ...SMALL, censusUnseenThreshold: 1e-9 },
      5,
      splits,
    );
    assertEquals(never.restarts, 0, "negative control");
    assertEquals(never.firstRestartRecords, null);
  });
});

Deno.test("the holdout never guides a run", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    const shifted = {
      ...splits,
      holdout: splits.holdout.map((r) => ({
        input: r.input,
        target: r.target + 1,
      })),
    };
    for (const name of ["none", "stagnation", "census"]) {
      // deno-lint-ignore no-await-in-loop
      const plain = await runArm(arm(name), SMALL, 9, splits);
      // deno-lint-ignore no-await-in-loop
      const moved = await runArm(arm(name), SMALL, 9, shifted);
      assertEquals(
        moved.trace.map((e) => e.bestTrainMse),
        plain.trace.map((e) => e.bestTrainMse),
        name,
      );
      assertEquals(moved.restarts, plain.restarts, name);
      assertEquals(moved.finalTrainMse, plain.finalTrainMse, name);
      assertEquals(moved.recordsCharged, plain.recordsCharged, name);
      assertNotEquals(moved.finalHoldoutMse, plain.finalHoldoutMse, name);
    }
  });
});

Deno.test("pairedComparison and verdict follow the predeclared criteria", () => {
  const control = Array.from({ length: 20 }, (_, i) => 1 + 0.05 * i);
  const better = control.map((v, i) => v - 0.5 - 0.001 * i);
  const worse = control.map((v) => v + 0.5);
  const noisy = control.map((v, i) => v + (i % 2 === 0 ? 0.5 : -0.5));

  const benefit = pairedComparison(better, control, 2000, 1);
  assertEquals(benefit.n, 20);
  assertEquals(benefit.wins, 20);
  assert(benefit.meanDiff < 0);
  assertEquals(verdict(benefit, 1, SUCCESS_CRITERIA), "benefit");
  assertEquals(verdict(benefit, 0.5, SUCCESS_CRITERIA) === "benefit", false);
  assertEquals(
    verdict(pairedComparison(worse, control, 2000, 1), 1, SUCCESS_CRITERIA),
    "harm",
  );
  assertEquals(
    verdict(pairedComparison(noisy, control, 2000, 1), 1, SUCCESS_CRITERIA),
    "no-benefit",
  );
  assertThrows(() => pairedComparison([1, 2], [1], 10, 1), Error, "length");
  assertThrows(() => pairedComparison([], [], 10, 1), Error);
});

Deno.test("validateSettings names the offending field", () => {
  validateSettings(SMALL);
  for (
    const [patch, field] of [
      [{ reseedFraction: 0 }, "reseedFraction"],
      [{ reseedFraction: 1.5 }, "reseedFraction"],
      [{ restartCooldownGenerations: 0 }, "restartCooldownGenerations"],
      [{ censusWindowGenerations: 1.5 }, "censusWindowGenerations"],
      [{ censusQuantisation: 0 }, "censusQuantisation"],
      [{ censusUnseenThreshold: 1 }, "censusUnseenThreshold"],
      [{ censusUnseenThreshold: 0 }, "censusUnseenThreshold"],
      [{ plateauWindow: 0 }, "plateauWindow"],
      [{ elitism: SMALL.populationSize }, "elitism"],
      [{ recordBudget: 10 }, "recordBudget"],
    ] as const
  ) {
    assertThrows(
      () => validateSettings({ ...SMALL, ...patch }),
      Error,
      field,
    );
  }
});

Deno.test("chooseCensusSetting picks the lowest median train MSE, ties to the first", () => {
  const row = (q: number, w: number, mse: number): CalibrationRow => ({
    q,
    w,
    medianFinalTrainMse: mse,
    medianRestarts: 0,
    medianFirstRestartRecords: null,
    meanCollisionRate: 0,
    meanUnseenEstimate: 1,
  });
  const chosen = chooseCensusSetting([
    row(0.01, 3, 0.5),
    row(0.01, 6, 0.2),
    row(0.05, 3, 0.2),
    row(0.05, 6, 0.9),
  ]);
  assertEquals([chosen.q, chosen.w], [0.01, 6]);
  assertThrows(() => chooseCensusSetting([]), Error);
});
