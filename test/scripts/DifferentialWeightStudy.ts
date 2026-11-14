/**
 * The differential-weight study harness (Issue #4156).
 *
 * The harness is what answers whether DE offspring and delayed contraction
 * help, so its arithmetic is tested rather than trusted: the DE operator
 * really is `a + F * (b - c)` over homologous genes and touches nothing else,
 * the contraction rule really waits, a run spends its budget and never reads
 * the holdout to decide anything, and the verdict follows the predeclared
 * criteria.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { Genus } from "@neat/Genus.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  type ArmResult,
  behaviouralDiversity,
  buildDeChild,
  buildSplits,
  calibrateTarget,
  contractedSize,
  DEFAULT_STUDY_SETTINGS,
  deWeightOffspring,
  pairedComparison,
  runArm,
  sdRatio,
  STUDY_ARMS,
  type StudySettings,
  SUCCESS_CRITERIA,
  USED_SEED_RANGES,
  usedSeedOverlap,
  validateSettings,
  VALIDATION_BASE_SEED,
  VALIDATION_SEED_COUNT,
  verdict,
} from "../../scripts/lib/differentialWeightStudy.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

const SMALL: StudySettings = {
  ...DEFAULT_STUDY_SETTINGS,
  trainRecords: 60,
  holdoutRecords: 40,
  diversityProbeRecords: 16,
  populationSize: 8,
  elitism: 2,
  recordBudget: 60 * 8 * 6,
  deFraction: 0.5,
  refinementCandidates: 2,
};

type Exported = ReturnType<Creature["exportJSON"]>;

/** A copy of `base` with every weight and bias set from `value(index)`. */
function cloneWith(base: Exported, value: (index: number) => number): Creature {
  const copy: Exported = JSON.parse(JSON.stringify(base));
  let index = 0;
  for (const neuron of copy.neurons) {
    if (neuron.type !== "constant") neuron.bias = value(index++);
  }
  for (const synapse of copy.synapses) synapse.weight = value(index++);
  return Creature.fromJSON(copy);
}

function weightsByKey(creature: Creature): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of creature.exportJSON().synapses) {
    map.set(`${s.fromUUID}|${s.toUUID}|${s.type ?? ""}`, s.weight);
  }
  return map;
}

function biasesByUuid(creature: Creature): Map<string, number> {
  const map = new Map<string, number>();
  for (const n of creature.exportJSON().neurons) {
    if (n.uuid !== undefined) map.set(n.uuid, n.bias);
  }
  return map;
}

function family() {
  const base = new Creature(2, 1, { layers: [{ count: 2 }] }).exportJSON();
  return {
    base,
    target: cloneWith(base, (i) => 0.1 * (i + 1)),
    a: cloneWith(base, (i) => 1 + 0.2 * i),
    b: cloneWith(base, (i) => 2 - 0.3 * i),
    c: cloneWith(base, (i) => -0.5 + 0.05 * i),
  };
}

Deno.test("deWeightOffspring with CR=1 sets every homologous gene to a + F(b - c)", () => {
  const { target, a, b, c } = family();
  const before = [target, a, b, c].map((p) => JSON.stringify(p.exportJSON()));
  const F = 0.5;
  const result = deWeightOffspring(target, a, b, c, F, 1, createSeededRng(1));
  assert(result !== undefined);

  const child = result.child;
  assertEquals(
    child.exportJSON().neurons.map((n) => [n.uuid, n.squash, n.type]),
    target.exportJSON().neurons.map((n) => [n.uuid, n.squash, n.type]),
  );
  const childWeights = weightsByKey(child);
  assertEquals(
    [...childWeights.keys()].sort(),
    [...weightsByKey(target).keys()].sort(),
  );
  const [wa, wb, wc] = [a, b, c].map(weightsByKey);
  for (const [key, weight] of childWeights) {
    assertAlmostEquals(
      weight,
      wa.get(key)! + F * (wb.get(key)! - wc.get(key)!),
    );
  }
  const [ba, bb, bc] = [a, b, c].map(biasesByUuid);
  for (const [uuid, bias] of biasesByUuid(child)) {
    assertAlmostEquals(
      bias,
      ba.get(uuid)! + F * (bb.get(uuid)! - bc.get(uuid)!),
    );
  }
  assertEquals(result.genesChanged, result.homologousGenes);
  assertEquals(
    [target, a, b, c].map((p) => JSON.stringify(p.exportJSON())),
    before,
  );
});

Deno.test("deWeightOffspring with CR=0 changes exactly one gene", () => {
  const { target, a, b, c } = family();
  const result = deWeightOffspring(target, a, b, c, 0.5, 0, createSeededRng(2));
  assert(result !== undefined);
  assertEquals(result.genesChanged, 1);

  let differing = 0;
  const [tw, cw] = [weightsByKey(target), weightsByKey(result.child)];
  for (const [key, weight] of tw) if (cw.get(key) !== weight) differing++;
  const [tb, cb] = [biasesByUuid(target), biasesByUuid(result.child)];
  for (const [uuid, bias] of tb) if (cb.get(uuid) !== bias) differing++;
  assertEquals(differing, 1);
});

Deno.test("deWeightOffspring leaves a target-only synapse alone and shares only the genes all four carry", () => {
  const base = new Creature(2, 1, { layers: [{ count: 2 }] });
  const exported = base.exportJSON();
  const donors = [0, 1, 2].map((k) => cloneWith(exported, (i) => k + 0.1 * i));
  const target = cloneWith(exported, (i) => 0.1 * (i + 1));
  const outputIndex = target.neurons.length - 1;
  assertEquals(target.neurons[outputIndex].type, "output");
  target.connect(0, outputIndex, 0.777);

  const result = deWeightOffspring(
    target,
    donors[0],
    donors[1],
    donors[2],
    0.5,
    1,
    createSeededRng(3),
  );
  assert(result !== undefined);
  const extra = [...weightsByKey(target).keys()].filter((key) =>
    !weightsByKey(donors[0]).has(key)
  );
  assertEquals(extra.length, 1);
  assertEquals(weightsByKey(result.child).get(extra[0]), 0.777);

  // Donors from an unrelated creature share no hidden uuid and no synapse.
  const stranger = () => new Creature(2, 1, { layers: [{ count: 2 }] });
  const wholly = deWeightOffspring(
    target,
    stranger(),
    stranger(),
    stranger(),
    0.5,
    1,
    createSeededRng(5),
  );
  // The shared output bias is homologous; every hidden gene is not.
  assert(wholly !== undefined);
  assertEquals(wholly.homologousGenes, 1);
});

const CONTRACTION = {
  contractionDelayFraction: 0.5,
  contractionHighDiversityThreshold: 0.8,
  plateauWindow: 5,
  plateauMinImprovement: 0.01,
};
const FLAT = [-1, -1, -1, -1, -1];

Deno.test("contractedSize waits for the delay, then shrinks only on a diverse plateau", () => {
  const common = {
    basePopulationSize: 24,
    currentSize: 24,
    recordBudget: 100,
    settings: CONTRACTION,
  };
  assertEquals(
    contractedSize({
      ...common,
      speciesCount: 24,
      scoreHistory: FLAT,
      recordsCharged: 10,
    }),
    24,
  );
  const after = contractedSize({
    ...common,
    speciesCount: 24,
    scoreHistory: FLAT,
    recordsCharged: 60,
  });
  assert(after < 24, `expected a shrink, got ${after}`);

  // Threshold 0: any post-delay plateau shrinks, whatever the species count.
  const open = contractedSize({
    ...common,
    settings: { ...CONTRACTION, contractionHighDiversityThreshold: 0 },
    speciesCount: 5,
    scoreHistory: FLAT,
    recordsCharged: 60,
  });
  assert(open < 24, `expected a shrink at threshold 0, got ${open}`);
  // Threshold 0.8 with low species diversity leaves the size alone.
  assertEquals(
    contractedSize({
      ...common,
      speciesCount: 5,
      scoreHistory: FLAT,
      recordsCharged: 60,
    }),
    24,
  );

  // Low diversity would make the adaptive rule grow; this one never does.
  assertEquals(
    contractedSize({
      ...common,
      speciesCount: 2,
      scoreHistory: FLAT,
      recordsCharged: 60,
    }),
    24,
  );
  // Still improving: not a plateau.
  assertEquals(
    contractedSize({
      ...common,
      speciesCount: 24,
      scoreHistory: [-5, -4, -3, -2, -1],
      recordsCharged: 60,
    }),
    24,
  );
});

Deno.test("runArm is deterministic per seed and restores the caller's generator", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    const arm = STUDY_ARMS.find((x) => x.name === "de+contraction@reenter")!;
    setRandomNumberGenerator(createSeededRng(77));
    const caller = getRandomNumberGenerator();
    const first = await runArm(arm, SMALL, 11, splits, 0.05);
    assert(getRandomNumberGenerator() === caller);
    const second = await runArm(arm, SMALL, 11, splits, 0.05);
    assertEquals(first, second);
  });
});

Deno.test("every arm spends its budget without exceeding it, and reports its own mechanisms", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    const slack = SMALL.trainRecords * (1 + SMALL.refinementCandidates);
    for (const arm of STUDY_ARMS) {
      // deno-lint-ignore no-await-in-loop
      const result = await runArm(arm, SMALL, 5, splits);
      assert(result.recordsCharged <= SMALL.recordBudget, arm.name);
      assert(result.recordsCharged > SMALL.recordBudget - slack, arm.name);
      assert(result.generations >= 2, arm.name);
      if (!arm.refinementReenters) assertEquals(result.refinedReentered, 0);
      if (arm.de) {
        assert(result.deOffspring + result.deFallbacks > 0, arm.name);
      } else {
        assertEquals(result.deOffspring, 0, arm.name);
      }
      if (!arm.delayedContraction) {
        assertEquals(result.contractionEvents, 0, arm.name);
        assertEquals(result.finalPopulationSize, SMALL.populationSize);
      }
    }
  });
});

Deno.test("contraction@reenter really contracts after the delay; the control never does", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    const settings = { ...SMALL, recordBudget: 60 * 8 * 30 };
    const arm = STUDY_ARMS.find((x) => x.name === "contraction@reenter")!;
    const control = STUDY_ARMS.find((x) => x.name === "control@reenter")!;
    const result = await runArm(arm, settings, 5, splits);
    assert(result.contractionEvents > 0);
    assert(result.finalPopulationSize < settings.populationSize);
    assert(
      result.firstContractionRecords! >=
        settings.contractionDelayFraction * settings.recordBudget,
    );
    const plain = await runArm(control, settings, 5, splits);
    assertEquals(plain.contractionEvents, 0);
  });
});

Deno.test("breeding tops the population up to its target size", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    const settings = { ...SMALL, recordBudget: 60 * 8 * 30 };
    for (const name of ["control@reenter", "de@reenter"]) {
      const arm = STUDY_ARMS.find((x) => x.name === name)!;
      // deno-lint-ignore no-await-in-loop
      const result = await runArm(arm, settings, 5, splits);
      assert(result.slotsRequested > 0, name);
      assert(result.unfilledSlots <= result.slotsRequested, name);
      // The shortfall is accounted for slot by slot: every empty slot shows up
      // as a gap between the target and the assembled population.
      const gaps = result.trace.slice(0, -1).map((entry) =>
        entry.populationSize - entry.assembledSize
      );
      // The final entry may or may not have bred (the budget can end exactly
      // on a generation boundary), so it can account for up to one generation.
      const gapTotal = gaps.reduce((a, b) => a + b, 0);
      assert(gapTotal <= result.unfilledSlots, name);
      assert(
        result.unfilledSlots - gapTotal <= settings.populationSize,
        name,
      );
      if (result.unfilledSlots === 0) {
        for (const entry of result.trace.slice(0, -1)) {
          assertEquals(entry.assembledSize, entry.populationSize, name);
        }
      }
      // Observed at these settings (seed 5): de@reenter leaves 6 of 177 slots
      // empty (3.4%). control@reenter leaves 474 of 529: its population
      // converges to the two elites, `Offspring.breed` then returns clones and
      // declines them, so no amount of retrying fills the slots.
      if (name === "de@reenter") {
        assert(result.unfilledSlots < 0.1 * result.slotsRequested, name);
      }
    }
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
    for (const name of ["control@reenter", "de+contraction@isolated"]) {
      const arm = STUDY_ARMS.find((x) => x.name === name)!;
      // deno-lint-ignore no-await-in-loop
      const plain = await runArm(arm, SMALL, 9, splits);
      // deno-lint-ignore no-await-in-loop
      const moved = await runArm(arm, SMALL, 9, shifted);
      assertEquals(moved.trace, plain.trace);
      assertEquals(moved.finalTrainMse, plain.finalTrainMse);
      assertEquals(moved.recordsCharged, plain.recordsCharged);
      assertNotEquals(moved.finalHoldoutMse, plain.finalHoldoutMse);
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
  assertThrows(() => validateSettings({ ...SMALL, deCR: 1.5 }), Error, "deCR");
  assertThrows(
    () => validateSettings({ ...SMALL, elitism: SMALL.populationSize }),
    Error,
    "elitism",
  );
  assertThrows(
    () => validateSettings({ ...SMALL, contractionHighDiversityThreshold: 1 }),
    Error,
    "contractionHighDiversityThreshold",
  );
  assertThrows(
    () => validateSettings({ ...SMALL, recordBudget: 10 }),
    Error,
    "recordBudget",
  );
});

Deno.test("calibrateTarget is the median final training MSE and refuses an empty set", () => {
  const stub = (finalTrainMse: number) => ({ finalTrainMse }) as ArmResult;
  assertEquals(calibrateTarget([stub(3), stub(1), stub(2)]), 2);
  assertEquals(calibrateTarget([stub(1), stub(3)]), 2);
  assertThrows(() => calibrateTarget([]), Error);
});

Deno.test("sdRatio gives the known ratio of spreads, brackets it, and refuses bad input", () => {
  const control = Array.from({ length: 20 }, (_, i) => 1 + 0.3 * i);

  // The arm at twice the control's spread, on the same seeds: every resample
  // of paired values has a ratio of exactly 2, so the interval collapses on it.
  const doubled = control.map((v) => 2 * v);
  const exact = sdRatio(doubled, control, 500, 1);
  assertAlmostEquals(exact.ratio, 2, 1e-9);
  assertAlmostEquals(exact.ci95[0], 2, 1e-9);
  assertAlmostEquals(exact.ci95[1], 2, 1e-9);

  // Half the spread gives 0.5.
  assertAlmostEquals(
    sdRatio(control.map((v) => v / 2), control, 500, 1).ratio,
    0.5,
    1e-9,
  );

  // With independent wobble the ratio is not exact, and the interval brackets it.
  const wobbly = control.map((v, i) => 2 * v + (i % 3 === 0 ? 1.5 : -0.75));
  const loose = sdRatio(wobbly, control, 2000, 1);
  assert(loose.ratio > 1.8 && loose.ratio < 2.3, `ratio ${loose.ratio}`);
  assert(loose.ci95[0] <= loose.ratio, `${loose.ci95} vs ${loose.ratio}`);
  assert(loose.ratio <= loose.ci95[1], `${loose.ci95} vs ${loose.ratio}`);
  assert(loose.ci95[0] < loose.ci95[1]);

  assertThrows(
    () => sdRatio([1, 2, 3], [1, 2], 10, 1),
    Error,
    "paired samples differ in length: 3 vs 2",
  );
  assertThrows(
    () => sdRatio([], [], 10, 1),
    Error,
    "paired comparison of zero seeds",
  );
});

/** A creature that answers `output(input)` and nothing else. */
function stubCreature(output: (input: ArrayLike<number>) => number): Creature {
  return {
    activate: (input: ArrayLike<number>) => [output(input)],
  } as unknown as Creature;
}

Deno.test("behaviouralDiversity is the mean pairwise RMS output difference", () => {
  const probe = [0, 1, 2, 3].map((x) => ({
    input: Float32Array.from([x, 0]),
    target: 0,
  }));
  const zero = () => stubCreature(() => 0);

  // Identical creatures do not differ.
  assertEquals(behaviouralDiversity([zero(), zero(), zero()], probe), 0);

  // Outputs 0, 3 and 0 everywhere: pair RMS differences are 3, 0 and 3.
  assertAlmostEquals(
    behaviouralDiversity([zero(), stubCreature(() => 3), zero()], probe),
    2,
    1e-12,
  );

  // Two creatures that differ by 1 on half the records and 3 on none else:
  // the RMS of [1, 1, 0, 0] is sqrt(2 / 4).
  assertAlmostEquals(
    behaviouralDiversity([
      zero(),
      stubCreature((input) => (input[0] < 2 ? 1 : 0)),
    ], probe),
    Math.sqrt(0.5),
    1e-12,
  );

  // A creature with a non-finite output is left out, not averaged in.
  assertAlmostEquals(
    behaviouralDiversity([
      zero(),
      stubCreature(() => 3),
      zero(),
      stubCreature((input) => (input[0] === 2 ? Number.NaN : 100)),
      stubCreature(() => Infinity),
    ], probe),
    2,
    1e-12,
  );

  // Fewer than two usable creatures, or nothing to probe, is zero.
  assertEquals(behaviouralDiversity([], probe), 0);
  assertEquals(behaviouralDiversity([zero()], probe), 0);
  assertEquals(
    behaviouralDiversity([zero(), stubCreature(() => Number.NaN)], probe),
    0,
  );
  assertEquals(behaviouralDiversity([zero(), stubCreature(() => 3)], []), 0);
});

Deno.test("time to target is read against every creature that can ship", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    for (const arm of STUDY_ARMS) {
      // deno-lint-ignore no-await-in-loop
      const plain = await runArm(arm, SMALL, 5, splits);
      assertEquals(plain.timeToTargetRecords, null, arm.name);

      // A generous target is met as soon as anything scores.
      // deno-lint-ignore no-await-in-loop
      const easy = await runArm(arm, SMALL, 5, splits, 1e9);
      assert(easy.timeToTargetRecords !== null, arm.name);
      assertEquals(easy.timeToTargetRecords, SMALL.trainRecords, arm.name);
      assert(easy.timeToTargetRecords <= easy.recordsCharged, arm.name);

      // An unreachable target never is.
      // deno-lint-ignore no-await-in-loop
      const never = await runArm(arm, SMALL, 5, splits, -1);
      assertEquals(never.timeToTargetRecords, null, arm.name);

      // The run ships a creature at `finalTrainMse`, so a target at that level
      // must have been reached, no later than the run ended.
      // deno-lint-ignore no-await-in-loop
      const own = await runArm(arm, SMALL, 5, splits, plain.finalTrainMse);
      assert(own.timeToTargetRecords !== null, arm.name);
      assert(own.timeToTargetRecords <= own.recordsCharged, arm.name);
      assertEquals(own.finalTrainMse, plain.finalTrainMse, arm.name);
    }
  });
});

Deno.test("an isolated refined descendant that alone reaches the target counts", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    const arm = STUDY_ARMS.find((x) => x.name === "control@isolated")!;
    let fixtures = 0;
    for (let seed = 1; seed <= 40; seed++) {
      // deno-lint-ignore no-await-in-loop
      const plain = await runArm(arm, SMALL, seed, splits);
      const populationBest = Math.min(
        ...plain.trace.map((entry) => entry.bestTrainMse),
      );
      // The shipped creature beats every population best ever seen, so it can
      // only be an isolated refinement (or the last generation's best).
      if (!(plain.finalTrainMse < populationBest)) continue;
      fixtures++;
      // deno-lint-ignore no-await-in-loop
      const result = await runArm(
        arm,
        SMALL,
        seed,
        splits,
        plain.finalTrainMse,
      );
      assert(result.timeToTargetRecords !== null, `seed ${seed}`);
      assert(result.timeToTargetRecords <= result.recordsCharged);
    }
    assert(fixtures > 0, "no seed shipped an isolated refinement");
  });
});

const BIG: StudySettings = {
  ...DEFAULT_STUDY_SETTINGS,
  trainRecords: 60,
  holdoutRecords: 40,
  diversityProbeRecords: 16,
  populationSize: 24,
  elitism: 2,
  recordBudget: 60 * 24 * 5,
  deFraction: 0.25,
  refinementCandidates: 2,
};

Deno.test("a DE arm turns about deFraction of its offspring slots into DE children", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(BIG);
    const arm = STUDY_ARMS.find((x) => x.name === "de@isolated")!;
    const result = await runArm(arm, BIG, 5, splits);
    // Every requested DE slot is either a DE child or a counted fallback.
    assertEquals(
      result.deOffspring + result.deFallbacks,
      result.deSlotsRequested,
    );
    // The share of slots asked for is deFraction, to within rounding.
    assert(result.deSlotsRequested > 0);
    assert(
      Math.abs(
        result.deSlotsRequested - BIG.deFraction * result.slotsRequested,
      ) <=
        0.5 * result.generations,
      `${result.deSlotsRequested} DE slots of ${result.slotsRequested}`,
    );
    // Species of four exist at this size, so DE children are really built.
    assert(result.deOffspring > 0, "no DE child was ever built");

    const control = STUDY_ARMS.find((x) => x.name === "control@isolated")!;
    const plain = await runArm(control, BIG, 5, splits);
    assertEquals(plain.deSlotsRequested, 0);
    assertEquals(plain.deOffspring + plain.deFallbacks, 0);
  });
});

Deno.test("with no species of four, every DE slot falls back and is counted", async () => {
  await withRngTestLock(async () => {
    const tiny: StudySettings = {
      ...SMALL,
      populationSize: 3,
      elitism: 1,
      recordBudget: 60 * 3 * 8,
      deFraction: 0.5,
    };
    const splits = buildSplits(tiny);
    const arm = STUDY_ARMS.find((x) => x.name === "de@isolated")!;
    const result = await runArm(arm, tiny, 5, splits);
    assert(result.deSlotsRequested > 0);
    assertEquals(result.deOffspring, 0);
    assertEquals(result.deFallbacks, result.deSlotsRequested);
  });
});

Deno.test("buildDeChild draws its donors only from the parent's own species", () => {
  const settings = { ...SMALL, deF: 0.5, deCR: 1 };
  const makeMember = (hidden: number, value: number): Creature => {
    const creature = new Creature(2, 1, { layers: [{ count: hidden }] });
    for (const neuron of creature.neurons) {
      if (neuron.type !== "input") neuron.bias = value;
    }
    for (const synapse of creature.synapses) synapse.weight = value;
    delete creature.uuid;
    CreatureUtil.makeUUID(creature);
    creature.score = -value;
    return creature;
  };
  const base = new Creature(2, 1, { layers: [{ count: 2 }] }).exportJSON();
  const sibling = (value: number): Creature => {
    const creature = cloneWith(base, () => value);
    delete creature.uuid;
    CreatureUtil.makeUUID(creature);
    creature.score = -value;
    return creature;
  };

  // Species A: five creatures with the same genes at different values.
  const members = [1, 2, 3, 4, 5].map(sibling);
  // Species B: a different architecture whose weights are huge, so any donor
  // taken from it would show in the child.
  const others = [1000, 2000, 3000, 4000].map((v) => makeMember(1, v));
  const genus = new Genus();
  for (const creature of [...members, ...others]) genus.addCreature(creature);
  assertNotEquals(
    genus.creatureToSpeciesMap.get(members[0].uuid!),
    genus.creatureToSpeciesMap.get(others[0].uuid!),
  );

  const parent = members[0];
  const child = buildDeChild(parent, genus, settings, createSeededRng(7));
  assert(child !== undefined);
  // With CR = 1 every gene is a + 0.5 (b - c) of three values from {2,3,4,5};
  // with donors from species B the values would be in the hundreds or more.
  const values = [
    ...weightsByKey(child).values(),
    ...biasesByUuid(child).values(),
  ];
  assert(values.length > 0);
  for (const value of values) {
    assert(
      value >= 2 + 0.5 * (2 - 5) && value <= 5 + 0.5 * (5 - 2),
      `${value}`,
    );
  }

  // A species of three has two donors besides the parent: no DE child, even
  // though the population holds plenty of creatures from another species.
  const small = new Genus();
  for (const creature of [...members.slice(0, 3), ...others]) {
    small.addCreature(creature);
  }
  assertEquals(
    buildDeChild(members[0], small, settings, createSeededRng(7)),
    undefined,
  );
});

Deno.test("the default validation seeds overlap no range an earlier run used", () => {
  const seeds = Array.from(
    { length: VALIDATION_SEED_COUNT },
    (_, i) => VALIDATION_BASE_SEED + i,
  );
  assertEquals(usedSeedOverlap(seeds), []);
});

Deno.test("a validation range inside or touching a used range is reported", () => {
  const [first, last] = USED_SEED_RANGES[0];
  // The old CLI default, in full.
  const old = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  assertEquals(usedSeedOverlap(old), old);
  // A range that straddles the edge reports only the seeds inside it.
  assertEquals(usedSeedOverlap([first - 1, first, last, last + 1]), [
    first,
    last,
  ]);
  assertEquals(usedSeedOverlap([]), []);
});
