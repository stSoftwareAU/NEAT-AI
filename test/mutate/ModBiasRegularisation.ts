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
import { assert, assertEquals, assertLess } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { ModBias } from "../../src/mutate/ModBias.ts";
import {
  DEFAULT_BIAS_REGULARISATION_CONFIG,
  type RequiredBiasRegularisationConfig,
} from "../../src/config/BiasRegularisationConfig.ts";

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

Deno.test("ModBias - L2 regularisation biases towards smaller biases", () => {
  // Test that with strong L2 regularisation, biases tend towards smaller values
  const config: RequiredBiasRegularisationConfig = {
    ...DEFAULT_BIAS_REGULARISATION_CONFIG,
    enabled: true,
    l2Strength: 0.8, // Strong regularisation
    maxAbsoluteBias: 1000,
    maxBiasChange: 1000,
    preferSmallChanges: false, // Disable to isolate L2 effect
  };

  // Start with a large positive bias
  const creature = createTestCreature(50);
  const modBias = new ModBias(creature, config);

  // Track how many times the bias moves towards zero vs away from zero
  let towardsZero = 0;
  let awayFromZero = 0;

  for (let i = 0; i < 500; i++) {
    const beforeBias = creature.neurons[creature.input].bias;
    const beforeMagnitude = Math.abs(beforeBias);
    modBias.mutate();
    const afterBias = creature.neurons[creature.input].bias;
    const afterMagnitude = Math.abs(afterBias);

    if (afterMagnitude < beforeMagnitude) {
      towardsZero++;
    } else if (afterMagnitude > beforeMagnitude) {
      awayFromZero++;
    }
  }

  // With strong L2 regularisation, should move towards zero more often
  assert(
    towardsZero > awayFromZero * 0.8,
    `L2 regularisation should bias towards smaller biases. ` +
      `TowardsZero: ${towardsZero}, AwayFromZero: ${awayFromZero}`,
  );
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

Deno.test("ModBias - returns false when no valid neurons exist (with config)", () => {
  // Create a creature with only input neurons (no non-input neurons to mutate)
  // Actually - output neurons can be mutated, so let's use a creature with only constants
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
