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
import {
  type ArmResult,
  buildSplits,
  calibrateTarget,
  contractedSize,
  DEFAULT_STUDY_SETTINGS,
  deWeightOffspring,
  pairedComparison,
  runArm,
  STUDY_ARMS,
  type StudySettings,
  SUCCESS_CRITERIA,
  validateSettings,
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
