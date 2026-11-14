/**
 * The connectivity-prior harness (Issue #4160): the builders produce exactly
 * the connectivity they claim, a run is reproducible and never selects on the
 * holdout, and the verdict arithmetic says what the criteria say.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { createSeededRng } from "@utils/RandomNumberGenerator.ts";
import {
  type ArmRun,
  ARMS,
  buildControlCreature,
  buildPriorCreature,
  buildSelfLoopCreature,
  buildStudyCorpus,
  chooseCell,
  compareToControl,
  connectivityStats,
  countSelfLoops,
  DEFAULT_SETTINGS,
  pairedBootstrapCi,
  runArm,
  scoreRecurrentAware,
  SELF_LOOP_ARM,
  type StudySettings,
  validateCell,
  verdict,
} from "../../scripts/lib/connectivityPriorStudy.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

const SMALL: StudySettings = {
  ...DEFAULT_SETTINGS,
  budgetRecords: 6_000,
  populationSize: 6,
  trainRecords: 60,
  holdoutRecords: 60,
};

const CELL = (name: string) => ARMS.find((a) => a.arm === name)!;

for (
  const [inDegree, fanOut] of [[2, 2], [1.5, 1], [3, 3]] as [number, number][]
) {
  Deno.test(`buildPriorCreature d${inDegree}-f${fanOut} has the exact connectivity`, () => {
    const creature = buildPriorCreature(
      inDegree,
      fanOut,
      createSeededRng(7),
      "t",
    );
    const stats = connectivityStats(creature);
    assertEquals(stats.meanHiddenInDegree, inDegree);
    assertEquals(stats.meanInputFanOut, fanOut);
    assert(stats.reachable);
    const pairs = new Set<string>();
    for (const s of creature.synapses) {
      assert(s.from < s.to, "synapse must be forward");
      const key = `${s.from}>${s.to}`;
      assert(!pairs.has(key), "duplicate synapse");
      pairs.add(key);
    }
  });
}

Deno.test("buildControlCreature is fully connected", () => {
  const stats = connectivityStats(buildControlCreature(createSeededRng(3)));
  assertEquals(stats.meanHiddenInDegree, 4);
  assertEquals(stats.meanInputFanOut, 8);
  assert(stats.reachable);
});

Deno.test("validateCell refuses the impossible and accepts the possible", () => {
  assertThrows(() => validateCell(1, 3), Error, "d1-f3");
  assertThrows(() => validateCell(2, 0), Error, "d2-f0");
  assertThrows(() => validateCell(2, 9), Error, "d2-f9");
  validateCell(1.5, 3);
});

Deno.test("buildPriorCreature is deterministic in the seed", () => {
  const json = (seed: number) =>
    JSON.stringify(
      buildPriorCreature(2, 2, createSeededRng(seed), "t").exportJSON(),
    );
  assertEquals(json(1), json(1));
  assertNotEquals(json(1), json(2));
});

Deno.test("runArm is reproducible and restores global state", async () => {
  await withRngTestLock(() => {
    const corpus = buildStudyCorpus(4160, 60, 60);
    const before = getRandomNumberGenerator();
    const uuidBefore = crypto.randomUUID;
    const a = runArm(CELL("d2-f2"), 11, SMALL, corpus);
    const b = runArm(CELL("d2-f2"), 11, SMALL, corpus);
    assertEquals(a, b);
    assert(getRandomNumberGenerator() === before);
    assert(crypto.randomUUID === uuidBefore);
    assert(a.recordsScored <= SMALL.budgetRecords);
    assert(a.recordsScored > 0);
  });
});

Deno.test("the holdout never guides selection", async () => {
  await withRngTestLock(() => {
    const corpus = buildStudyCorpus(4160, 60, 60);
    const flipped = {
      train: corpus.train,
      holdout: corpus.holdout.map((r) => ({ ...r, target: -r.target - 5 })),
    };
    const a = runArm(CELL("control"), 5, SMALL, corpus);
    const b = runArm(CELL("control"), 5, SMALL, flipped);
    assertEquals(a.trainMse, b.trainMse);
    assertEquals(a.recordsScored, b.recordsScored);
    assertEquals(a.generations, b.generations);
    assertNotEquals(a.holdoutMse, b.holdoutMse);
  });
});

Deno.test("recordsToThreshold reads the first pass or null", async () => {
  await withRngTestLock(() => {
    const corpus = buildStudyCorpus(4160, 60, 60);
    const easy = runArm(CELL("control"), 5, {
      ...SMALL,
      threshold: Infinity,
    }, corpus);
    assertEquals(easy.recordsToThreshold, SMALL.populationSize * 60);
    const never = runArm(CELL("control"), 5, {
      ...SMALL,
      threshold: -1,
    }, corpus);
    assertEquals(never.recordsToThreshold, null);
  });
});

Deno.test("verdict follows the criteria", () => {
  assertEquals(verdict({ low: -2, high: -1 }, 1, 2, 3, 4), "benefit");
  assertEquals(verdict({ low: -2, high: -1 }, 1, 2, 4, 4), "no-benefit");
  assertEquals(verdict({ low: 1, high: 2 }, 1, 2, 3, 4), "harm");
  assertEquals(verdict({ low: -1, high: 1 }, 1, 2, 3, 4), "no-benefit");
});

const run = (arm: string, seed: number, trainMse: number, h = 1): ArmRun => ({
  arm,
  seed,
  trainMse,
  holdoutMse: h,
  recordsScored: 0,
  recordsToThreshold: null,
  generations: 1,
  stalled: false,
  initial: { meanHiddenInDegree: 0, meanInputFanOut: 0, reachable: true },
  final: { meanHiddenInDegree: 0, meanInputFanOut: 0, reachable: true },
  selfLoops: { initial: 0, final: 0 },
});

Deno.test("chooseCell picks the lowest median train MSE, ties to ARMS order", () => {
  const runs = [
    run("d1.5-f1", 1, 0.5),
    run("d2-f2", 1, 0.2),
    run("d3-f3", 1, 0.9),
    run("control", 1, 0.0),
  ];
  assertEquals(chooseCell(runs), "d2-f2");
  const tied = [run("d3-f1", 1, 0.3), run("d2-f1", 1, 0.3)];
  assertEquals(chooseCell(tied), "d2-f1");
});

Deno.test("compareToControl pairs by seed", () => {
  assertThrows(() =>
    compareToControl([run("control", 1, 0)], [run("d2-f2", 2, 0)])
  );
  const c = compareToControl(
    [run("control", 1, 0, 2), run("control", 2, 0, 2)],
    [run("d2-f2", 1, 0, 1), run("d2-f2", 2, 0, 1)],
    100,
    1,
  );
  assertEquals(c.wins, 2);
  assertEquals(c.verdict, "benefit");
});

Deno.test("pairedBootstrapCi is deterministic and ordered", () => {
  const diffs = [-1, 0.5, -0.2, 0.1, -0.7];
  const a = pairedBootstrapCi(diffs, 500, 9);
  assertEquals(a, pairedBootstrapCi(diffs, 500, 9));
  assert(a.low <= a.mean && a.mean <= a.high);
  assertAlmostEquals(a.mean, -0.26);
  assertThrows(() => pairedBootstrapCi([], 10, 1));
});

Deno.test("every grid cell builds with exact connectivity for several seeds", () => {
  for (const arm of ARMS) {
    if (arm.kind !== "prior") continue;
    for (const seed of [1, 2, 3, 4, 5]) {
      const stats = connectivityStats(
        buildPriorCreature(
          arm.inDegree,
          arm.fanOut,
          createSeededRng(seed),
          "g",
        ),
      );
      assertEquals(stats.meanHiddenInDegree, arm.inDegree, arm.arm);
      assertEquals(stats.meanInputFanOut, arm.fanOut, arm.arm);
      assert(stats.reachable, arm.arm);
    }
  }
});

Deno.test("buildSelfLoopCreature is the control plus one self-loop per hidden neuron", () => {
  const creature = buildSelfLoopCreature(createSeededRng(3));
  assertEquals(creature.forwardOnly, false);
  assertEquals(countSelfLoops(creature), 8);
  const hidden = new Set(
    creature.neurons.filter((n) => n.type === "hidden").map((n) => n.index),
  );
  for (const s of creature.synapses) {
    if (s.from === s.to) assert(hidden.has(s.from), "self-loop on hidden only");
    else assert(s.from < s.to, "every other synapse is forward");
  }
  const stats = connectivityStats(creature);
  // The self-loop counts as an inward synapse: 4 inputs plus itself.
  assertEquals(stats.meanHiddenInDegree, 5);
  assertEquals(stats.meanInputFanOut, 8);
  assert(stats.reachable);
});

Deno.test("the control carries no self-loops", () => {
  assertEquals(countSelfLoops(buildControlCreature(createSeededRng(3))), 0);
});

Deno.test("the self-loop arm runs on the recurrent path and is reproducible", async () => {
  await withRngTestLock(() => {
    const corpus = buildStudyCorpus(4160, 60, 60);
    const a = runArm(CELL(SELF_LOOP_ARM), 11, SMALL, corpus);
    const b = runArm(CELL(SELF_LOOP_ARM), 11, SMALL, corpus);
    assertEquals(a, b);
    assertEquals(a.selfLoops.initial, 8);
    assert(Number.isFinite(a.trainMse));
    assert(Number.isFinite(a.holdoutMse));
    assert(a.recordsScored > 0 && a.recordsScored <= SMALL.budgetRecords);
    const control = runArm(CELL("control"), 11, SMALL, corpus);
    assertEquals(control.selfLoops.initial, 0);
  });
});

Deno.test("the self-loop arm is never a calibration candidate", () => {
  const runs = [
    run(SELF_LOOP_ARM, 1, 0.01),
    run("d2-f2", 1, 0.5),
  ];
  assertEquals(chooseCell(runs), "d2-f2");
  assertThrows(() => chooseCell([run(SELF_LOOP_ARM, 1, 0.01)]));
});

Deno.test("self-loops change the score on the recurrent path and are inert statelessly", () => {
  const corpus = buildStudyCorpus(4160, 60, 60).train;
  const withLoops = buildSelfLoopCreature(createSeededRng(3));
  const exported = withLoops.exportJSON();
  const without = () =>
    Creature.fromJSON({
      ...exported,
      synapses: exported.synapses.filter((s) => s.fromUUID !== s.toUUID),
    });
  assertEquals(countSelfLoops(without()), 0);
  assert(countSelfLoops(withLoops) > 0);

  const recurrentWith = scoreRecurrentAware(withLoops, corpus, true);
  const recurrentWithout = scoreRecurrentAware(without(), corpus, true);
  assert(Number.isFinite(recurrentWith) && Number.isFinite(recurrentWithout));
  assertNotEquals(recurrentWith, recurrentWithout);

  // The stateless path zeroes the state before every record, so it cannot
  // see a self-loop: this is why the arm must not be scored that way.
  assertEquals(
    scoreRecurrentAware(withLoops, corpus, false),
    scoreRecurrentAware(without(), corpus, false),
  );
});

Deno.test("the forward-only control scores the same in either mode", () => {
  const corpus = buildStudyCorpus(4160, 60, 60).train;
  const control = buildControlCreature(createSeededRng(3));
  assertEquals(
    scoreRecurrentAware(control, corpus, true),
    scoreRecurrentAware(control, corpus, false),
  );
});
