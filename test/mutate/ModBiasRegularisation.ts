/**
 * Tests for bias regularisation during mutation (Issue #1416).
 *
 * This test suite verifies that:
 * 1. Hard limits on absolute bias values are enforced
 * 2. Hard limits on bias changes per mutation are enforced
 * 3. L2-style regularisation biases mutations towards smaller biases
 * 4. Small change preference reduces mutation magnitude
 * 5. Regularisation is configurable and can be disabled
 */
import {
  assert,
  assertEquals,
  assertGreaterOrEqual,
  assertLess,
} from "@std/assert";
import { Creature } from "@creature";
import { ModBias } from "@mutate/ModBias.ts";
import {
  DEFAULT_BIAS_REGULARISATION_CONFIG,
  type RequiredBiasRegularisationConfig,
} from "@config/BiasRegularisationConfig.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Creates a simple creature with a known bias for testing.
 */
function createTestCreature(initialBias: number): Creature {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: initialBias,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };
  return Creature.fromJSON(json, true);
}

Deno.test("ModBias - respects maxAbsoluteBias hard limit", () => {
  const maxBias = 50;
  const config: RequiredBiasRegularisationConfig = {
    ...DEFAULT_BIAS_REGULARISATION_CONFIG,
    enabled: true,
    maxAbsoluteBias: maxBias,
  };

  // Create creature with bias at the limit
  const creature = createTestCreature(maxBias);
  const modBias = new ModBias(creature, config);

  // Run many mutations to test the limit is not exceeded
  for (let i = 0; i < 500; i++) {
    modBias.mutate();
    const bias = creature.neurons[creature.input].bias;
    assert(
      Math.abs(bias) <= maxBias,
      `Bias ${bias} exceeded maxAbsoluteBias ${maxBias}`,
    );
  }
});

Deno.test("ModBias - respects maxBiasChange hard limit", () => {
  const maxChange = 2;
  const initialBias = 10;
  const config: RequiredBiasRegularisationConfig = {
    ...DEFAULT_BIAS_REGULARISATION_CONFIG,
    enabled: true,
    maxBiasChange: maxChange,
    maxAbsoluteBias: 1000, // High limit to not interfere
  };

  const creature = createTestCreature(initialBias);
  const modBias = new ModBias(creature, config);

  // Run many mutations and verify change per mutation is bounded
  for (let i = 0; i < 200; i++) {
    const beforeBias = creature.neurons[creature.input].bias;
    modBias.mutate();
    const afterBias = creature.neurons[creature.input].bias;
    const change = Math.abs(afterBias - beforeBias);

    assert(
      change <= maxChange + 0.0001, // Small epsilon for floating point
      `Bias change ${change} exceeded maxBiasChange ${maxChange}`,
    );
  }
});

/**
 * Issue #3998: the L2 assertions are driven by a seeded RNG so the outcome is
 * reproducible from the test alone, and the thresholds are derived from the
 * operator's own arithmetic rather than hand-picked.
 *
 * With `l2Strength = 0.8`, `preferSmallChanges` disabled and a bias of 50 the
 * quantum is 10, so one mutation is
 * `0.2 * (2*u1 - 1) * 10 - 0.64 * 50 * u2`. The pull towards zero only loses
 * when `(2*u1 - 1) * 2 > 32 * u2`, i.e. `u2 < (2*u1 - 1) / 16` with `u1 > 0.5`
 * — probability `(1/16) * integral(0.5..1, 2u - 1) du = 1.6%`. A floor of 90%
 * towards zero therefore sits far outside the sampling noise: across 3000
 * seeds the worst run pulled towards zero 481 of 500 times (96.2%).
 *
 * The previous assertion sampled a *drifting* walk instead. The bias collapses
 * to well under 1 within a few steps, and there the L2 pull is negligible next
 * to the noise term, so the towards/away count is close to a coin flip — which
 * is why an unseeded run could report 221 vs 279 and fail.
 */
const L2_SEED = 3998;
const L2_SAMPLES = 500;
const L2_START_BIAS = 50;
/** Minimum share of draws that must pull towards zero (analytic mean 98.4%). */
const L2_MIN_TOWARDS_ZERO = 0.9;

const L2_CONFIG: RequiredBiasRegularisationConfig = {
  ...DEFAULT_BIAS_REGULARISATION_CONFIG,
  enabled: true,
  l2Strength: 0.8, // Strong regularisation
  maxAbsoluteBias: 1000,
  maxBiasChange: 1000,
  preferSmallChanges: false, // Disable to isolate L2 effect
};

/**
 * Counts how many of `L2_SAMPLES` mutations move the bias towards zero when
 * every draw starts from the same large bias.
 *
 * Resetting the bias each iteration is what makes the measurement meaningful:
 * it samples the L2 pull at a fixed magnitude rather than following a walk
 * that has already settled near zero.
 */
function countPullsTowardsZero(): number {
  const creature = createTestCreature(L2_START_BIAS);
  const modBias = new ModBias(creature, L2_CONFIG);

  let towardsZero = 0;
  for (let i = 0; i < L2_SAMPLES; i++) {
    creature.neurons[creature.input].bias = L2_START_BIAS;
    modBias.mutate();
    if (Math.abs(creature.neurons[creature.input].bias) < L2_START_BIAS) {
      towardsZero++;
    }
  }
  return towardsZero;
}

/** Runs an unreset walk from `L2_START_BIAS` and returns the final magnitude. */
function walkFinalMagnitude(): number {
  const creature = createTestCreature(L2_START_BIAS);
  const modBias = new ModBias(creature, L2_CONFIG);

  for (let i = 0; i < L2_SAMPLES; i++) {
    modBias.mutate();
  }
  return Math.abs(creature.neurons[creature.input].bias);
}

Deno.test("ModBias - L2 regularisation biases towards smaller biases", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      setRandomNumberGenerator(createSeededRng(L2_SEED));

      const towardsZero = countPullsTowardsZero();
      assertGreaterOrEqual(
        towardsZero,
        L2_SAMPLES * L2_MIN_TOWARDS_ZERO,
        `L2 regularisation should pull a bias of ${L2_START_BIAS} towards ` +
          `zero on at least ${L2_MIN_TOWARDS_ZERO * 100}% of draws. ` +
          `TowardsZero: ${towardsZero} of ${L2_SAMPLES}`,
      );

      // And the pull compounds: an unreset walk collapses from 50 to under 1.
      assertLess(
        walkFinalMagnitude(),
        1,
        `L2 regularisation should shrink a bias of ${L2_START_BIAS} to under 1 ` +
          `over ${L2_SAMPLES} mutations`,
      );
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

/**
 * Issue #3998: seeds 695, 1491 and 1593 each drove the old drifting-walk
 * assertion below its `towardsZero > awayFromZero * 0.8` threshold. The
 * fixed-magnitude measurement holds comfortably on every one of them.
 */
Deno.test("ModBias - L2 pull holds under the seeds that broke the old sample", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      for (const seed of [695, 1491, 1593]) {
        setRandomNumberGenerator(createSeededRng(seed));
        const towardsZero = countPullsTowardsZero();
        assertGreaterOrEqual(
          towardsZero,
          L2_SAMPLES * L2_MIN_TOWARDS_ZERO,
          `Seed ${seed}: TowardsZero ${towardsZero} of ${L2_SAMPLES}`,
        );
      }
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

Deno.test("ModBias - preferSmallChanges reduces mutation magnitude", () => {
  // Compare mutation magnitudes with and without small change preference.
  // We reset the bias before each mutation to prevent drift from
  // changing the quantum and confounding the comparison.
  const initialBias = 10;

  const configWithSmallChanges: RequiredBiasRegularisationConfig = {
    ...DEFAULT_BIAS_REGULARISATION_CONFIG,
    enabled: true,
    preferSmallChanges: true,
    smallChangeScale: 0.3, // Strong preference for small changes
    l2Strength: 0, // Disable L2 to isolate effect
    maxAbsoluteBias: 1000,
    maxBiasChange: 1000,
  };

  const configWithoutSmallChanges: RequiredBiasRegularisationConfig = {
    ...DEFAULT_BIAS_REGULARISATION_CONFIG,
    enabled: true,
    preferSmallChanges: false,
    l2Strength: 0, // Disable L2 to isolate effect
    maxAbsoluteBias: 1000,
    maxBiasChange: 1000,
  };

  // Collect change magnitudes with small change preference
  const changesWithPref: number[] = [];
  const creatureWithPref = createTestCreature(initialBias);
  const modBiasWithPref = new ModBias(creatureWithPref, configWithSmallChanges);

  for (let i = 0; i < 500; i++) {
    creatureWithPref.neurons[creatureWithPref.input].bias = initialBias;
    modBiasWithPref.mutate();
    const after = creatureWithPref.neurons[creatureWithPref.input].bias;
    changesWithPref.push(Math.abs(after - initialBias));
  }

  // Collect change magnitudes without small change preference
  const changesWithoutPref: number[] = [];
  const creatureWithoutPref = createTestCreature(initialBias);
  const modBiasWithoutPref = new ModBias(
    creatureWithoutPref,
    configWithoutSmallChanges,
  );

  for (let i = 0; i < 500; i++) {
    creatureWithoutPref.neurons[creatureWithoutPref.input].bias = initialBias;
    modBiasWithoutPref.mutate();
    const after = creatureWithoutPref.neurons[creatureWithoutPref.input].bias;
    changesWithoutPref.push(Math.abs(after - initialBias));
  }

  // Calculate mean changes
  const meanWithPref = changesWithPref.reduce((a, b) => a + b, 0) /
    changesWithPref.length;
  const meanWithoutPref = changesWithoutPref.reduce((a, b) => a + b, 0) /
    changesWithoutPref.length;

  // Changes should be smaller on average with preference enabled
  assertLess(
    meanWithPref,
    meanWithoutPref,
    `Mean change with small preference (${
      meanWithPref.toFixed(3)
    }) should be ` +
      `less than without (${meanWithoutPref.toFixed(3)})`,
  );
});

Deno.test("ModBias - regularisation can be disabled", () => {
  const config: RequiredBiasRegularisationConfig = {
    ...DEFAULT_BIAS_REGULARISATION_CONFIG,
    enabled: false,
    maxAbsoluteBias: 5, // Very restrictive - should be ignored
    maxBiasChange: 0.1, // Very restrictive - should be ignored
  };

  // Start with bias that exceeds the (disabled) limit
  const creature = createTestCreature(10);
  const modBias = new ModBias(creature, config);

  // Run mutations - with regularisation disabled, bias can go beyond limits
  let exceededAbsoluteLimit = false;

  for (let i = 0; i < 500; i++) {
    modBias.mutate();
    const after = creature.neurons[creature.input].bias;

    if (Math.abs(after) > 5) {
      exceededAbsoluteLimit = true;
      break;
    }
  }

  // When disabled, mutations should be able to exceed the configured limits
  assert(
    exceededAbsoluteLimit ||
      Math.abs(creature.neurons[creature.input].bias) > 5,
    "With regularisation disabled, biases should be able to exceed maxAbsoluteBias",
  );
});

Deno.test("ModBias - default config provides sensible regularisation", () => {
  // Test that default configuration provides regularisation without being too restrictive
  const creature = createTestCreature(1);
  const modBias = new ModBias(creature, DEFAULT_BIAS_REGULARISATION_CONFIG);

  // Run mutations and verify biases stay within reasonable bounds
  let maxObservedBias = 0;
  for (let i = 0; i < 500; i++) {
    modBias.mutate();
    const bias = Math.abs(creature.neurons[creature.input].bias);
    maxObservedBias = Math.max(maxObservedBias, bias);
  }

  // Default maxAbsoluteBias is 100 - should never exceed
  assert(
    maxObservedBias <= DEFAULT_BIAS_REGULARISATION_CONFIG.maxAbsoluteBias,
    `Max observed bias ${maxObservedBias} exceeded default limit ` +
      `${DEFAULT_BIAS_REGULARISATION_CONFIG.maxAbsoluteBias}`,
  );
});

Deno.test("ModBias - works without config (backward compatible)", () => {
  // ModBias should work without config parameter for backward compatibility
  const creature = createTestCreature(1);
  const modBias = new ModBias(creature);

  // Should not throw and should mutate successfully
  let changed = false;
  for (let i = 0; i < 50 && !changed; i++) {
    changed = modBias.mutate();
  }

  assert(changed, "ModBias should work without config parameter");
});

Deno.test("ModBias - clamps extreme initial biases to maxAbsoluteBias", () => {
  const config: RequiredBiasRegularisationConfig = {
    ...DEFAULT_BIAS_REGULARISATION_CONFIG,
    enabled: true,
    maxAbsoluteBias: 10,
    maxBiasChange: 5,
  };

  // Start with a bias far exceeding the limit
  const creature = createTestCreature(500);
  const modBias = new ModBias(creature, config);

  // After first mutation, bias should be brought within limits
  modBias.mutate();
  const bias = creature.neurons[creature.input].bias;

  assert(
    Math.abs(bias) <= config.maxAbsoluteBias,
    `Bias ${bias} should be clamped to maxAbsoluteBias ${config.maxAbsoluteBias}`,
  );
});

Deno.test("ModBias - handles negative biases correctly with regularisation", () => {
  const config: RequiredBiasRegularisationConfig = {
    ...DEFAULT_BIAS_REGULARISATION_CONFIG,
    enabled: true,
    maxAbsoluteBias: 50,
    maxBiasChange: 10,
  };

  // Start with a negative bias
  const creature = createTestCreature(-30);
  const modBias = new ModBias(creature, config);

  // Run mutations - should stay within bounds
  for (let i = 0; i < 200; i++) {
    const before = creature.neurons[creature.input].bias;
    modBias.mutate();
    const after = creature.neurons[creature.input].bias;

    assert(
      Math.abs(after) <= config.maxAbsoluteBias,
      `Bias ${after} exceeded maxAbsoluteBias ${config.maxAbsoluteBias}`,
    );

    const change = Math.abs(after - before);
    assert(
      change <= config.maxBiasChange + 0.0001,
      `Change ${change} exceeded maxBiasChange ${config.maxBiasChange}`,
    );
  }
});

Deno.test("ModBias - skips constant neurons and mutates output neuron (with config)", () => {
  // Create a creature with a constant neuron and an output neuron.
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "constant" as const,
        uuid: "const-0",
        bias: 1.0,
      },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "const-0", toUUID: "output-0", weight: 0.5 },
    ],
  };

  const creature = Creature.fromJSON(json, true);
  const modBias = new ModBias(creature, DEFAULT_BIAS_REGULARISATION_CONFIG);

  // Should still be able to mutate the output neuron
  let changed = false;
  for (let i = 0; i < 50; i++) {
    changed = modBias.mutate();
    if (changed) break;
  }

  assert(changed, "Should be able to mutate output neuron bias");
  // Constant neuron bias should not change
  const constNeuron = creature.neurons.find((n) => n.type === "constant");
  assertEquals(
    constNeuron!.bias,
    1.0,
    "Constant neuron bias should not change",
  );
});

Deno.test("ModBias - focus list works with regularisation", () => {
  const config: RequiredBiasRegularisationConfig = {
    ...DEFAULT_BIAS_REGULARISATION_CONFIG,
    enabled: true,
    maxAbsoluteBias: 20,
  };

  const json = {
    input: 3,
    output: 2,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-1",
        bias: 5,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-1",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "input-2", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-1", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);
  const modBias = new ModBias(creature, config);

  // Focus on hidden-1 (index 3)
  const focusList = [3];

  // Run mutations with focus list
  for (let i = 0; i < 100; i++) {
    modBias.mutate(focusList);

    // All biases should stay within limits
    for (let j = creature.input; j < creature.neurons.length; j++) {
      const neuron = creature.neurons[j];
      if (neuron.type === "constant") continue;
      assert(
        Math.abs(neuron.bias) <= config.maxAbsoluteBias,
        `Bias ${neuron.bias} exceeded maxAbsoluteBias ${config.maxAbsoluteBias}`,
      );
    }
  }
});
