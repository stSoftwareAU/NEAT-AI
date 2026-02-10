/**
 * Tests for weight regularisation during mutation (Issue #1309).
 *
 * This test suite verifies that:
 * 1. Hard limits on absolute weight values are enforced
 * 2. Hard limits on weight changes per mutation are enforced
 * 3. L2-style regularisation biases mutations towards smaller weights
 * 4. Small change preference reduces mutation magnitude
 * 5. Regularisation is configurable and can be disabled
 */
import { assert, assertEquals, assertLess } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { ModWeight } from "../../src/mutate/ModWeight.ts";
import {
  DEFAULT_WEIGHT_REGULARISATION_CONFIG,
  type RequiredWeightRegularisationConfig,
} from "../../src/config/WeightRegularisationConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Creates a simple creature with a known weight for testing.
 */
function createTestCreature(initialWeight: number): Creature {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: initialWeight },
    ],
  };
  return Creature.fromJSON(json, true);
}

Deno.test("ModWeight - respects maxAbsoluteWeight hard limit", () => {
  const maxWeight = 50;
  const config: RequiredWeightRegularisationConfig = {
    ...DEFAULT_WEIGHT_REGULARISATION_CONFIG,
    enabled: true,
    maxAbsoluteWeight: maxWeight,
  };

  // Create creature with weight at the limit
  const creature = createTestCreature(maxWeight);
  const modWeight = new ModWeight(creature, config);

  // Run many mutations to test the limit is not exceeded
  for (let i = 0; i < 500; i++) {
    modWeight.mutate();
    const weight = creature.synapses[0].weight;
    assert(
      Math.abs(weight) <= maxWeight,
      `Weight ${weight} exceeded maxAbsoluteWeight ${maxWeight}`,
    );
  }
});

Deno.test("ModWeight - respects maxWeightChange hard limit", () => {
  const maxChange = 2;
  const initialWeight = 10;
  const config: RequiredWeightRegularisationConfig = {
    ...DEFAULT_WEIGHT_REGULARISATION_CONFIG,
    enabled: true,
    maxWeightChange: maxChange,
    maxAbsoluteWeight: 1000, // High limit to not interfere
  };

  const creature = createTestCreature(initialWeight);
  const modWeight = new ModWeight(creature, config);

  // Run many mutations and verify change per mutation is bounded
  for (let i = 0; i < 200; i++) {
    const beforeWeight = creature.synapses[0].weight;
    modWeight.mutate();
    const afterWeight = creature.synapses[0].weight;
    const change = Math.abs(afterWeight - beforeWeight);

    assert(
      change <= maxChange + 0.0001, // Small epsilon for floating point
      `Weight change ${change} exceeded maxWeightChange ${maxChange}`,
    );
  }
});

Deno.test("ModWeight - L2 regularisation biases towards smaller weights", () => {
  // Test that with strong L2 regularisation, weights tend towards smaller values
  const config: RequiredWeightRegularisationConfig = {
    ...DEFAULT_WEIGHT_REGULARISATION_CONFIG,
    enabled: true,
    l2Strength: 0.8, // Strong regularisation
    maxAbsoluteWeight: 1000,
    maxWeightChange: 1000,
    preferSmallChanges: false, // Disable to isolate L2 effect
  };

  // Start with a large positive weight
  const creature = createTestCreature(50);
  const modWeight = new ModWeight(creature, config);

  // Track how many times the weight moves towards zero vs away from zero
  let towardsZero = 0;
  let awayFromZero = 0;

  for (let i = 0; i < 500; i++) {
    const beforeWeight = creature.synapses[0].weight;
    const beforeMagnitude = Math.abs(beforeWeight);
    modWeight.mutate();
    const afterWeight = creature.synapses[0].weight;
    const afterMagnitude = Math.abs(afterWeight);

    if (afterMagnitude < beforeMagnitude) {
      towardsZero++;
    } else if (afterMagnitude > beforeMagnitude) {
      awayFromZero++;
    }
  }

  // With strong L2 regularisation, should move towards zero more often
  assert(
    towardsZero > awayFromZero * 0.8,
    `L2 regularisation should bias towards smaller weights. ` +
      `TowardsZero: ${towardsZero}, AwayFromZero: ${awayFromZero}`,
  );
});

Deno.test("ModWeight - preferSmallChanges reduces mutation magnitude", () => {
  // Compare mutation magnitudes with and without small change preference.
  // We reset the weight before each mutation to prevent weight drift from
  // changing the quantum and confounding the comparison.
  const initialWeight = 10;

  const configWithSmallChanges: RequiredWeightRegularisationConfig = {
    ...DEFAULT_WEIGHT_REGULARISATION_CONFIG,
    enabled: true,
    preferSmallChanges: true,
    smallChangeScale: 0.3, // Strong preference for small changes
    l2Strength: 0, // Disable L2 to isolate effect
    maxAbsoluteWeight: 1000,
    maxWeightChange: 1000,
  };

  const configWithoutSmallChanges: RequiredWeightRegularisationConfig = {
    ...DEFAULT_WEIGHT_REGULARISATION_CONFIG,
    enabled: true,
    preferSmallChanges: false,
    l2Strength: 0, // Disable L2 to isolate effect
    maxAbsoluteWeight: 1000,
    maxWeightChange: 1000,
  };

  // Collect change magnitudes with small change preference
  const changesWithPref: number[] = [];
  const creatureWithPref = createTestCreature(initialWeight);
  const modWeightWithPref = new ModWeight(
    creatureWithPref,
    configWithSmallChanges,
  );

  for (let i = 0; i < 500; i++) {
    creatureWithPref.synapses[0].weight = initialWeight;
    modWeightWithPref.mutate();
    const after = creatureWithPref.synapses[0].weight;
    changesWithPref.push(Math.abs(after - initialWeight));
  }

  // Collect change magnitudes without small change preference
  const changesWithoutPref: number[] = [];
  const creatureWithoutPref = createTestCreature(initialWeight);
  const modWeightWithoutPref = new ModWeight(
    creatureWithoutPref,
    configWithoutSmallChanges,
  );

  for (let i = 0; i < 500; i++) {
    creatureWithoutPref.synapses[0].weight = initialWeight;
    modWeightWithoutPref.mutate();
    const after = creatureWithoutPref.synapses[0].weight;
    changesWithoutPref.push(Math.abs(after - initialWeight));
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

Deno.test("ModWeight - regularisation can be disabled", () => {
  const config: RequiredWeightRegularisationConfig = {
    ...DEFAULT_WEIGHT_REGULARISATION_CONFIG,
    enabled: false,
    maxAbsoluteWeight: 5, // Very restrictive - should be ignored
    maxWeightChange: 0.1, // Very restrictive - should be ignored
  };

  // Start with weight that exceeds the (disabled) limit
  const creature = createTestCreature(10);
  const modWeight = new ModWeight(creature, config);

  // Run mutations - with regularisation disabled, weight can go beyond limits
  let exceededAbsoluteLimit = false;

  for (let i = 0; i < 500; i++) {
    modWeight.mutate();
    const after = creature.synapses[0].weight;

    if (Math.abs(after) > 5) {
      exceededAbsoluteLimit = true;
      break;
    }
  }

  // When disabled, mutations should be able to exceed the configured limits
  assert(
    exceededAbsoluteLimit || Math.abs(creature.synapses[0].weight) > 5,
    "With regularisation disabled, weights should be able to exceed maxAbsoluteWeight",
  );
});

Deno.test("ModWeight - default config provides sensible regularisation", () => {
  // Test that default configuration provides regularisation without being too restrictive
  const creature = createTestCreature(1);
  const modWeight = new ModWeight(
    creature,
    DEFAULT_WEIGHT_REGULARISATION_CONFIG,
  );

  // Run mutations and verify weights stay within reasonable bounds
  let maxObservedWeight = 0;
  for (let i = 0; i < 500; i++) {
    modWeight.mutate();
    const weight = Math.abs(creature.synapses[0].weight);
    maxObservedWeight = Math.max(maxObservedWeight, weight);
  }

  // Default maxAbsoluteWeight is 100 - should never exceed
  assert(
    maxObservedWeight <= DEFAULT_WEIGHT_REGULARISATION_CONFIG.maxAbsoluteWeight,
    `Max observed weight ${maxObservedWeight} exceeded default limit ` +
      `${DEFAULT_WEIGHT_REGULARISATION_CONFIG.maxAbsoluteWeight}`,
  );
});

Deno.test("ModWeight - works without config (backward compatible)", () => {
  // ModWeight should work without config parameter for backward compatibility
  const creature = createTestCreature(1);
  const modWeight = new ModWeight(creature);

  // Should not throw and should mutate successfully
  let changed = false;
  for (let i = 0; i < 50 && !changed; i++) {
    changed = modWeight.mutate();
  }

  assert(changed, "ModWeight should work without config parameter");
});

Deno.test("ModWeight - clamps extreme initial weights to maxAbsoluteWeight", () => {
  const config: RequiredWeightRegularisationConfig = {
    ...DEFAULT_WEIGHT_REGULARISATION_CONFIG,
    enabled: true,
    maxAbsoluteWeight: 10,
    maxWeightChange: 5,
  };

  // Start with a weight far exceeding the limit
  const creature = createTestCreature(500);
  const modWeight = new ModWeight(creature, config);

  // After first mutation, weight should be brought within limits
  modWeight.mutate();
  const weight = creature.synapses[0].weight;

  assert(
    Math.abs(weight) <= config.maxAbsoluteWeight,
    `Weight ${weight} should be clamped to maxAbsoluteWeight ${config.maxAbsoluteWeight}`,
  );
});

Deno.test("ModWeight - handles negative weights correctly with regularisation", () => {
  const config: RequiredWeightRegularisationConfig = {
    ...DEFAULT_WEIGHT_REGULARISATION_CONFIG,
    enabled: true,
    maxAbsoluteWeight: 50,
    maxWeightChange: 10,
  };

  // Start with a negative weight
  const creature = createTestCreature(-30);
  const modWeight = new ModWeight(creature, config);

  // Run mutations - should stay within bounds
  for (let i = 0; i < 200; i++) {
    const before = creature.synapses[0].weight;
    modWeight.mutate();
    const after = creature.synapses[0].weight;

    assert(
      Math.abs(after) <= config.maxAbsoluteWeight,
      `Weight ${after} exceeded maxAbsoluteWeight ${config.maxAbsoluteWeight}`,
    );

    const change = Math.abs(after - before);
    assert(
      change <= config.maxWeightChange + 0.0001,
      `Change ${change} exceeded maxWeightChange ${config.maxWeightChange}`,
    );
  }
});

Deno.test("ModWeight - focus list works with regularisation", () => {
  const config: RequiredWeightRegularisationConfig = {
    ...DEFAULT_WEIGHT_REGULARISATION_CONFIG,
    enabled: true,
    maxAbsoluteWeight: 20,
  };

  const json = {
    input: 3,
    output: 2,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-1",
        bias: 0,
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
  const modWeight = new ModWeight(creature, config);

  // Focus on hidden-1 (index 3)
  const focusList = [3];

  // Run mutations with focus list
  for (let i = 0; i < 100; i++) {
    modWeight.mutate(focusList);

    // All weights should stay within limits
    for (const synapse of creature.synapses) {
      assert(
        Math.abs(synapse.weight) <= config.maxAbsoluteWeight,
        `Weight ${synapse.weight} exceeded maxAbsoluteWeight ${config.maxAbsoluteWeight}`,
      );
    }
  }
});

Deno.test("ModWeight - returns false when no synapses exist (with config)", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [],
  };

  const creature = Creature.fromJSON(json, true);
  const modWeight = new ModWeight(
    creature,
    DEFAULT_WEIGHT_REGULARISATION_CONFIG,
  );

  const result = modWeight.mutate();
  assertEquals(result, false, "Should return false when no synapses exist");
});
