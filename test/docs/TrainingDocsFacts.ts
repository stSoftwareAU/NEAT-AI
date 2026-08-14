/**
 * Issue #3694 — fact-check guard for the training docs.
 *
 * `docs/api/TRAINING.md` and `docs/config/TRAINING.md` describe the surface a
 * caller programs against when training a creature. These tests pin the facts
 * those docs publish:
 *
 * - the `BackPropagationOptions` defaults (`generations`, `learningRate`, …),
 * - the full `learningRateStrategy` union, including `"warm_restart"`,
 * - that `syntheticSynapses` lives on `TrainOptions` only — it is not a
 *   `NeatOptions` field, so `createNeatConfig()` drops it.
 *
 * These are "what" tests: every assertion comes from calling the real factory
 * or the real training entry point — not from grepping source or docs.
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  type BackPropagationOptions,
  createBackPropagationConfig,
  MAX_RANDOM_GENERATIONS,
} from "@propagate/BackPropagation.ts";
import { Creature } from "@creature";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { createNeatConfig, type NeatOptions } from "../../mod.ts";
import {
  getRandomNumberGenerator,
  type RandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { train } from "../TrainTestOnlyUtil.ts";
import { initWasmForTests } from "../_initWasm.ts";

await initWasmForTests();

/** RNG that always returns `value`, so a documented random branch is pinned. */
function constantRng(value: number): RandomNumberGenerator {
  return {
    random: () => value,
    randomInt: (min: number, max: number) =>
      Math.min(max, min + Math.floor(value * (max - min + 1))),
    choice: <T>(array: readonly T[]): T => {
      assert(array.length > 0, "choice() needs a non-empty array");
      return array[
        Math.min(array.length - 1, Math.floor(value * array.length))
      ];
    },
    seeded: true,
    seed: null,
  };
}

function withGlobalRng(rng: RandomNumberGenerator, fn: () => void): void {
  const previous = getRandomNumberGenerator();
  try {
    setRandomNumberGenerator(rng);
    fn();
  } finally {
    setRandomNumberGenerator(previous);
  }
}

Deno.test("docs/api/TRAINING.md: BackPropagationOptions defaults are as published", () => {
  const config = createBackPropagationConfig();

  // Issue #1437 replaced the random learning rate with a fixed 0.01.
  assertEquals(config.learningRate, 0.01);
  assertEquals(config.initialLearningRate, 0.01);
  assertEquals(config.learningRateDecay, 0.95);
  assertEquals(config.batchSize, 64);
  assertEquals(config.sparseRatio, 1);
  assertEquals(config.plankConstant, 0.000_000_1);
  assertEquals(config.maximumBiasAdjustmentScale, 1);
  assertEquals(config.maximumWeightAdjustmentScale, 1);
  assertEquals(config.limitBiasScale, 10_000);
  assertEquals(config.limitWeightScale, 100_000);
  assertFalse(config.disableBiasAdjustment);
  assertFalse(config.disableWeightAdjustment);
  assertFalse(config.disableRandomSamples);
});

Deno.test("docs/api/TRAINING.md: generations defaults to a random 1–MAX_RANDOM_GENERATIONS", () => {
  // Issue #1436 reduced the published range from 1–100 to 1–10.
  assertEquals(MAX_RANDOM_GENERATIONS, 10);

  for (const draw of [0, 0.25, 0.5, 0.75, 0.999]) {
    withGlobalRng(constantRng(draw), () => {
      const config = createBackPropagationConfig();
      assert(
        config.generations >= 1 &&
          config.generations <= MAX_RANDOM_GENERATIONS,
        `generations ${config.generations} outside 1–${MAX_RANDOM_GENERATIONS}`,
      );
    });
  }

  // An explicit value is honoured unchanged.
  assertEquals(createBackPropagationConfig({ generations: 3 }).generations, 3);
});

Deno.test("docs/api/TRAINING.md: learningRateStrategy accepts every documented value", () => {
  const strategies: NonNullable<
    BackPropagationOptions["learningRateStrategy"]
  >[] = ["fixed", "decay", "adaptive", "warm_restart"];

  for (const strategy of strategies) {
    const config = createBackPropagationConfig({
      learningRateStrategy: strategy,
    });
    assertEquals(config.learningRateStrategy, strategy);
  }
});

Deno.test("docs/api/TRAINING.md: the random default strategy can select warm_restart", () => {
  // The default selector maps [0.55, 0.75) to "warm_restart".
  withGlobalRng(constantRng(0.6), () => {
    assertEquals(
      createBackPropagationConfig().learningRateStrategy,
      "warm_restart",
    );
  });
});

Deno.test("docs/config/TRAINING.md: syntheticSynapses is not a NeatOptions field", () => {
  const requested = {
    trainPerGen: 10,
    trainingBatchSize: 100,
    trainingSampleRate: 1,
    // A caller following the old doc sample passed this key; it is not part of
    // NeatOptions, so createNeatConfig() never carries it into the config.
    syntheticSynapses: false,
  } as unknown as NeatOptions;

  const config = createNeatConfig(requested);

  assertEquals(config.trainPerGen, 10);
  assertEquals(config.trainingBatchSize, 100);
  assertFalse(
    "syntheticSynapses" in config,
    "syntheticSynapses must not appear on a resolved NeatConfig",
  );
});

Deno.test("docs/api/TRAINING.md: syntheticSynapses is opt-in on the training options", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const options: TrainOptions = {
    iterations: 2,
    disableRandomSamples: true,
    syntheticSynapses: true,
  };

  const result = train(creature, dataSet, options);
  assert(Number.isFinite(result.error), "training error should be finite");
});
