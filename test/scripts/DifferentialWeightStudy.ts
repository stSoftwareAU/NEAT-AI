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
  assertRejects,
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
  delayedLinearSize,
  deWeightOffspring,
  pairedComparison,
  PREDECLARED_CONTRASTS,
  refineWeights,
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
  WALL_CLOCK_BASE_SEED,
  WALL_CLOCK_BUDGET_MS,
  WALL_CLOCK_RECORD_BUDGET,
  type WallClockBudget,
} from "../../scripts/lib/differentialWeightStudy.ts";
import {
  type CensoredRun,
  collectRun,
  compareContrasts,
  type TimedResult,
} from "../../scripts/lib/differentialWeightContrasts.ts";
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
      if (arm.contraction === "none") {
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

Deno.test("delayedLinearSize holds the base until the delay, then falls linearly to the minimum", () => {
  const common = {
    basePopulationSize: 24,
    minPopulationSize: 4,
    recordBudget: 1000,
    delayFraction: 0.5,
  };
  assertEquals(delayedLinearSize({ ...common, recordsCharged: 0 }), 24);
  assertEquals(delayedLinearSize({ ...common, recordsCharged: 499 }), 24);
  assertEquals(delayedLinearSize({ ...common, recordsCharged: 500 }), 24);
  assertEquals(delayedLinearSize({ ...common, recordsCharged: 750 }), 14);
  assertEquals(delayedLinearSize({ ...common, recordsCharged: 1000 }), 4);
  assertEquals(delayedLinearSize({ ...common, recordsCharged: 1500 }), 4);
  for (const charged of [0, 500, 1000, 5000]) {
    assertEquals(
      delayedLinearSize({
        ...common,
        delayFraction: 1,
        recordsCharged: charged,
      }),
      24,
    );
  }
});

Deno.test("validateSettings refuses a bad lpsrMinPopulationSize", () => {
  validateSettings(DEFAULT_STUDY_SETTINGS);
  for (
    const lpsrMinPopulationSize of [
      SMALL.elitism,
      SMALL.populationSize + 1,
      4.5,
    ]
  ) {
    assertThrows(
      () => validateSettings({ ...SMALL, lpsrMinPopulationSize }),
      Error,
      "lpsrMinPopulationSize",
    );
  }
});

Deno.test("lpsr@reenter holds its size until the delay, then only shrinks", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    const settings = { ...SMALL, recordBudget: 60 * 8 * 30 };
    const arm = STUDY_ARMS.find((x) => x.name === "lpsr@reenter")!;
    const control = STUDY_ARMS.find((x) => x.name === "control@reenter")!;
    const result = await runArm(arm, settings, 5, splits);
    const delay = settings.contractionDelayFraction * settings.recordBudget;
    const before = result.trace.filter((e) => e.recordsCharged < delay);
    assert(before.length > 0);
    for (const entry of before) {
      assertEquals(entry.populationSize, settings.populationSize);
    }
    const sizes = result.trace.map((e) => e.populationSize);
    for (let i = 1; i < sizes.length; i++) assert(sizes[i] <= sizes[i - 1]);
    assert(sizes[sizes.length - 1] < settings.populationSize);
    assert(result.contractionEvents > 0);

    // The arm follows the delayed linear schedule, not the adaptive rule.
    let previous = settings.populationSize;
    for (const entry of result.trace) {
      assertEquals(
        entry.populationSize,
        Math.min(
          previous,
          delayedLinearSize({
            basePopulationSize: settings.populationSize,
            minPopulationSize: settings.lpsrMinPopulationSize,
            recordsCharged: entry.recordsCharged,
            recordBudget: settings.recordBudget,
            delayFraction: settings.contractionDelayFraction,
          }),
        ),
      );
      previous = entry.populationSize;
    }

    const plain = await runArm(control, settings, 5, splits);
    assertEquals(plain.contractionEvents, 0);
    for (const entry of plain.trace) {
      assertEquals(entry.populationSize, settings.populationSize);
    }
  });
});

Deno.test("the study has 12 distinct arms and 11 contrasts that name real arms", () => {
  const names = STUDY_ARMS.map((arm) => arm.name);
  assertEquals(new Set(names).size, 12);
  assertEquals(PREDECLARED_CONTRASTS.length, 11);
  for (const contrast of PREDECLARED_CONTRASTS) {
    assert(names.includes(contrast.arm), contrast.arm);
    assert(names.includes(contrast.control), contrast.control);
  }
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
      lpsrMinPopulationSize: 2,
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
  // The second used range: PR 4165's reported validation.
  assertEquals(usedSeedOverlap([14185, 14186]), [14185]);
});

Deno.test("the default validation seeds are 24156..24185 and overlap neither used range", () => {
  const seeds = Array.from(
    { length: VALIDATION_SEED_COUNT },
    (_, i) => VALIDATION_BASE_SEED + i,
  );
  assertEquals(seeds[0], 24156);
  assertEquals(seeds[seeds.length - 1], 24185);
  assertEquals(USED_SEED_RANGES, [
    [4156, 4185],
    [14156, 14185],
    [34156, 34185],
  ]);
  assertEquals(usedSeedOverlap(seeds), []);
});

/** A clock that advances `step` ms every time it is read. */
function tickingClock(step: number): () => number {
  let t = 0;
  return () => {
    const now = t;
    t += step;
    return now;
  };
}

Deno.test("an equal wall-clock budget stops every arm on the clock, before its record budget", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    const settings = { ...SMALL, recordBudget: 60 * 8 * 1000 };
    for (const arm of STUDY_ARMS) {
      let last = 0;
      const tick = tickingClock(1);
      const wallClock: WallClockBudget = {
        ms: 120,
        now: () => (last = tick()),
      };
      // deno-lint-ignore no-await-in-loop
      const result = await runArm(
        arm,
        settings,
        5,
        splits,
        undefined,
        wallClock,
      );
      assertEquals(result.stoppedBy, "wall-clock", arm.name);
      assert(result.recordsCharged < settings.recordBudget, arm.name);
      assert(result.generations >= 2, arm.name);
      // It stopped only once the budget was spent, not before.
      assert(last >= wallClock.ms, arm.name);
      assert(Number.isFinite(result.finalHoldoutMse), arm.name);
    }
  });
});

Deno.test("a wall-clock budget that never runs out changes nothing; one spent at once evaluates nothing", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    const arm = STUDY_ARMS.find((x) => x.name === "de+lpsr@reenter")!;
    const plain = await runArm(arm, SMALL, 11, splits, 0.05);
    assertEquals(plain.stoppedBy, "records");
    const frozen = await runArm(arm, SMALL, 11, splits, 0.05, {
      ms: 1,
      now: () => 0,
    });
    assertEquals(frozen, plain);

    let reads = 0;
    const spent = await runArm(arm, SMALL, 11, splits, 0.05, {
      ms: 10,
      now: () => (reads++ === 0 ? 0 : 1e9),
    });
    assertEquals(spent.stoppedBy, "wall-clock");
    assertEquals(spent.recordsCharged, 0);
    assertEquals(spent.evaluations, 0);
    assertEquals(spent.generations, 0);
  });
});

Deno.test("under a wall-clock budget lpsr contracts on the elapsed share, not the records share", async () => {
  await withRngTestLock(async () => {
    const splits = buildSplits(SMALL);
    const settings = { ...SMALL, recordBudget: 60 * 8 * 1000 };
    const arm = STUDY_ARMS.find((x) => x.name === "lpsr@reenter")!;
    const result = await runArm(arm, settings, 5, splits, undefined, {
      ms: 300,
      now: tickingClock(1),
    });
    assertEquals(result.stoppedBy, "wall-clock");
    const delay = settings.contractionDelayFraction * settings.recordBudget;
    // The records alone never reach the delay, so only the clock can contract.
    assert(result.recordsCharged < delay);
    assert(result.contractionEvents > 0);
    assert(result.finalPopulationSize < settings.populationSize);
    assertEquals(result.trace[0].populationSize, settings.populationSize);
  });
});

Deno.test("runArm refuses a wall-clock budget that is not a positive finite number", async () => {
  const splits = buildSplits(SMALL);
  const arm = STUDY_ARMS[0];
  for (const ms of [0, -5, Infinity, Number.NaN]) {
    // deno-lint-ignore no-await-in-loop
    await assertRejects(
      () => runArm(arm, SMALL, 1, splits, undefined, { ms, now: () => 0 }),
      Error,
      `wallClock.ms must be a positive finite number, got ${ms}`,
    );
  }
});

Deno.test("the equal-wall-clock phase uses fresh seeds 44156..44185, 600 ms, and a tenfold record budget", () => {
  const seeds = Array.from(
    { length: VALIDATION_SEED_COUNT },
    (_, i) => WALL_CLOCK_BASE_SEED + i,
  );
  assertEquals(seeds[0], 44156);
  assertEquals(seeds[seeds.length - 1], 44185);
  assertEquals(usedSeedOverlap(seeds), []);
  const validation = Array.from(
    { length: VALIDATION_SEED_COUNT },
    (_, i) => VALIDATION_BASE_SEED + i,
  );
  assertEquals(seeds.filter((seed) => validation.includes(seed)), []);
  assertEquals(WALL_CLOCK_BUDGET_MS, 600);
  assertEquals(
    WALL_CLOCK_RECORD_BUDGET,
    10 * DEFAULT_STUDY_SETTINGS.recordBudget,
  );
  // A record budget the clock binds must still be a valid setting.
  assertEquals(
    validateSettings({
      ...DEFAULT_STUDY_SETTINGS,
      recordBudget: WALL_CLOCK_RECORD_BUDGET,
    }),
    undefined,
  );
});

Deno.test("refineWeights stops before the next candidate once told to, keeping what it scored", () => {
  const rng = createSeededRng(3);
  const parent = new Creature(2, 1, { layers: [{ count: 2 }] });
  parent.score = 0;
  const scores = [5, 9, 7, 8];

  let calls = 0;
  const full = refineWeights(parent, 4, 0.1, rng, () => scores[calls++]);
  assertEquals(full.candidatesScored, 4);
  assertEquals(full.best?.score, 9);

  // Stop asked before every candidate; it says yes from the second on.
  calls = 0;
  let asked = 0;
  const partial = refineWeights(
    parent,
    4,
    0.1,
    createSeededRng(3),
    () => scores[calls++],
    () => asked++ >= 1,
  );
  assertEquals(partial.candidatesScored, 1);
  assertEquals(partial.best?.score, 5);

  // Stopped before the first candidate: nothing scored, nothing kept.
  calls = 0;
  const none = refineWeights(
    parent,
    4,
    0.1,
    createSeededRng(3),
    () => scores[calls++],
    () => true,
  );
  assertEquals(none.candidatesScored, 0);
  assertEquals(none.best, undefined);
  // The parent was never modified.
  assertEquals(parent.score, 0);
});

/**
 * A clock that reads 0 for its first `reads` reads and is spent from then on.
 * One generation of a no-contraction arm reads the clock once at the start,
 * once at the top of the loop, once per creature scored, once before
 * refinement, then once before each refinement candidate.
 */
function clockSpentAfter(reads: number): WallClockBudget {
  let n = 0;
  return { ms: 10, now: () => (n++ < reads ? 0 : 1e9) };
}

Deno.test("a deadline that expires during refinement scores no further candidate and keeps the one scored", async () => {
  await withRngTestLock(async () => {
    const candidates = 4;
    const settings: StudySettings = {
      ...SMALL,
      refinementCandidates: candidates,
      // Room for one generation of scoring and one full refinement batch.
      recordBudget: SMALL.trainRecords * (SMALL.populationSize + candidates),
    };
    const splits = buildSplits(settings);
    const perEvaluation = settings.trainRecords;
    const P = settings.populationSize;
    for (const name of ["control@reenter", "control@isolated"]) {
      const arm = STUDY_ARMS.find((x) => x.name === name)!;

      // Control: the clock never runs out, so every candidate is scored.
      // deno-lint-ignore no-await-in-loop
      const open = await runArm(arm, settings, 5, splits, undefined, {
        ms: 10,
        now: () => 0,
      });
      assertEquals(open.stoppedBy, "records", name);
      assertEquals(open.evaluations, P + candidates, name);
      assertEquals(open.recordsCharged, perEvaluation * (P + candidates), name);

      // Spent at the check before refinement: the population is scored, no
      // candidate is.
      // deno-lint-ignore no-await-in-loop
      const before = await runArm(
        arm,
        settings,
        5,
        splits,
        undefined,
        clockSpentAfter(P + 3),
      );
      assertEquals(before.stoppedBy, "wall-clock", name);
      assertEquals(before.evaluations, P, name);
      assertEquals(before.recordsCharged, perEvaluation * P, name);
      assertEquals(before.refinementsAccepted, 0, name);

      // Spent once the first candidate is scored: exactly that one more
      // evaluation is charged, and it is the creature that ships.
      // deno-lint-ignore no-await-in-loop
      const during = await runArm(
        arm,
        settings,
        5,
        splits,
        undefined,
        clockSpentAfter(P + 4),
      );
      assertEquals(during.stoppedBy, "wall-clock", name);
      assertEquals(during.evaluations, P + 1, name);
      assertEquals(during.recordsCharged, perEvaluation * (P + 1), name);
      assertEquals(during.generations, 1, name);
      assertEquals(during.refinementsAccepted, 1, name);
      assertEquals(during.refinedReentered, name.endsWith("@reenter") ? 1 : 0);
      assert(during.finalTrainMse < before.finalTrainMse, name);
      assertEquals(during.deOffspring, 0, name);
      assertEquals(during.slotsRequested, 0, name);
    }
  });
});

async function oneRun(
  armName: string,
  seed: number,
  wallClock?: WallClockBudget,
): Promise<TimedResult> {
  const arm = STUDY_ARMS.find((x) => x.name === armName)!;
  const result = await runArm(
    arm,
    SMALL,
    seed,
    buildSplits(SMALL),
    undefined,
    wallClock,
  );
  return { result, wallMs: 1 };
}

Deno.test("a run with no scored candidate is censored, kept out of every paired statistic, and not called no-benefit", async () => {
  await withRngTestLock(async () => {
    const seeds = [1, 2];
    const runs = new Map<string, Map<number, TimedResult>>();
    const censored: CensoredRun[] = [];
    for (const arm of STUDY_ARMS) {
      runs.set(arm.name, new Map());
      for (const seed of seeds) {
        // The control's second seed, and every `de@isolated` seed, run out of
        // clock before anything is scored.
        const spent = (arm.name === "control@reenter" && seed === 2) ||
          arm.name === "de@isolated";
        // deno-lint-ignore no-await-in-loop
        const timed = await oneRun(
          arm.name,
          seed,
          spent ? { ms: 10, now: clockSpentAfter(1).now } : undefined,
        );
        collectRun(runs.get(arm.name)!, censored, timed);
      }
    }

    // Three censored runs, each with its reason and costs.
    assertEquals(
      censored.map((run) => `${run.arm}#${run.seed}`).sort(),
      ["control@reenter#2", "de@isolated#1", "de@isolated#2"],
    );
    for (const run of censored) {
      assertEquals(run.stoppedBy, "wall-clock");
      assertEquals(run.evaluations, 0);
      assertEquals(run.recordsCharged, 0);
      assertEquals(run.generations, 0);
      assertEquals(
        run.reason,
        "no creature was scored before the wall-clock budget ended",
      );
    }
    assertEquals(runs.get("control@reenter")!.size, 1);
    assertEquals(runs.get("de@isolated")!.size, 0);
    assertEquals(runs.get("de@reenter")!.size, 2);

    const byLabel = new Map(
      compareContrasts(runs, seeds).map((c) => [c.label, c]),
    );
    // Paired only where both completed: seed 1.
    const lpsr = byLabel.get("lpsr@reenter vs control@reenter")!;
    assertEquals(lpsr.seeds, 1);
    assertEquals(lpsr.attempted, 2);
    if (!("heldOutMse" in lpsr)) throw new Error("expected a paired result");
    assertEquals(lpsr.heldOutMse.n, 1);
    assert(Number.isFinite(lpsr.heldOutMse.meanDiff));
    assert(lpsr.heldOutMse.ci95.every(Number.isFinite));

    // No paired seed at all: nothing to conclude.
    const de = byLabel.get("de@isolated vs control@isolated")!;
    assertEquals(de.seeds, 0);
    assertEquals(de.attempted, 2);
    assertEquals(de.verdict, "insufficient-data");
    assertEquals("heldOutMse" in de, false);

    // A contrast that lost no seed is complete, and its diversity was measured
    // on every paired seed, so it carries a conclusive verdict.
    const full = byLabel.get("lpsr@isolated vs control@isolated")!;
    assertEquals(full.seeds, 2);
    assertEquals(full.attempted, 2);
    if (!("diversitySeeds" in full)) {
      throw new Error("expected a paired result");
    }
    assertEquals(full.diversitySeeds, 2);
    assertEquals(full.speciesSeeds, 2);
    assert(Number.isFinite(full.diversityRatio));
    assertNotEquals(full.verdict, "insufficient-data");
    assertEquals("reason" in full, false);
  });
});

Deno.test("runs stopped inside their first generation keep their held-out MSE but give no conclusive verdict", async () => {
  await withRngTestLock(async () => {
    const seeds = [1, 2];
    const runs = new Map<string, Map<number, TimedResult>>();
    const censored: CensoredRun[] = [];
    for (const arm of STUDY_ARMS) {
      runs.set(arm.name, new Map());
      for (const seed of seeds) {
        // Spent once the first population is scored and before any refinement:
        // creatures are scored, but there is no second generation to average.
        // deno-lint-ignore no-await-in-loop
        const timed = await oneRun(arm.name, seed, {
          ms: 10,
          now: clockSpentAfter(SMALL.populationSize + 3).now,
        });
        assertEquals(timed.result.stoppedBy, "wall-clock", arm.name);
        assertEquals(timed.result.generations, 1, arm.name);
        assert(Number.isNaN(timed.result.meanBehaviouralDiversity), arm.name);
        assert(Number.isNaN(timed.result.meanSpeciesCount), arm.name);
        collectRun(runs.get(arm.name)!, censored, timed);
      }
    }

    // Scored, so collected rather than censored.
    assertEquals(censored, []);
    for (const arm of STUDY_ARMS) assertEquals(runs.get(arm.name)!.size, 2);

    for (const c of compareContrasts(runs, seeds)) {
      if (!("heldOutMse" in c)) throw new Error("expected a paired result");
      // The valid held-out measurement is preserved ...
      assertEquals(c.seeds, 2, c.label);
      assertEquals(c.heldOutMse.n, 2, c.label);
      assert(Number.isFinite(c.heldOutMse.meanDiff), c.label);
      assert(c.heldOutMse.ci95.every(Number.isFinite), c.label);
      // ... the coverage of the missing metrics is reported ...
      assertEquals(c.diversitySeeds, 0, c.label);
      assertEquals(c.speciesSeeds, 0, c.label);
      // ... and no benefit or harm is claimed without them.
      assertEquals(c.verdict, "insufficient-data", c.label);
      assertEquals(
        "reason" in c && c.reason,
        "a required measurement is unavailable: behavioural diversity measured on 0 of 2 paired seeds; species count measured on 0 of 2 paired seeds",
        c.label,
      );
    }
  });
});

Deno.test("a completed run is collected, not censored", async () => {
  await withRngTestLock(async () => {
    const completed = new Map<number, TimedResult>();
    const censored: CensoredRun[] = [];
    const timed = await oneRun("control@reenter", 7);
    collectRun(completed, censored, timed);
    assertEquals(censored, []);
    assertEquals([...completed.keys()], [7]);
    assertEquals(completed.get(7), timed);
  });
});
