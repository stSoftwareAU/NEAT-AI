import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Creature } from "../../src/Creature.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";

/**
 * Tests for adaptive mutation rate feature.
 *
 * Issue #1037: Implement adaptive mutation rate for large creatures.
 *
 * Large creatures have a massive search space. Adding more structure
 * (ADD_NODE, ADD_CONNECTION) makes the search space exponentially larger
 * while rarely improving fitness.
 *
 * The adaptive mutation rate feature:
 * - Small creatures (< medium threshold): Normal topology mutation rates
 * - Medium creatures (>= medium, < large threshold): Reduced topology expansion
 * - Large creatures (>= large threshold): Focus on MOD_WEIGHT, MOD_BIAS
 */

// ============================================================================
// Configuration Tests
// ============================================================================

Deno.test(
  "AdaptiveMutation: config defaults are applied when not specified",
  () => {
    const config = createNeatConfig({});

    // Check defaults are set
    assertEquals(
      config.adaptiveMutationThresholds.medium,
      100,
      "Default medium threshold should be 100 neurons",
    );
    assertEquals(
      config.adaptiveMutationThresholds.large,
      300,
      "Default large threshold should be 300 neurons",
    );
    assertEquals(
      config.adaptiveMutationThresholds.largeTopologyWeight,
      0.1,
      "Default large topology weight should be 0.1 (10%)",
    );
  },
);

Deno.test(
  "AdaptiveMutation: config accepts custom threshold values",
  () => {
    const config = createNeatConfig({
      adaptiveMutationThresholds: {
        medium: 50,
        large: 200,
        largeTopologyWeight: 0.05,
      },
    });

    assertEquals(
      config.adaptiveMutationThresholds.medium,
      50,
      "Custom medium threshold should be 50 neurons",
    );
    assertEquals(
      config.adaptiveMutationThresholds.large,
      200,
      "Custom large threshold should be 200 neurons",
    );
    assertEquals(
      config.adaptiveMutationThresholds.largeTopologyWeight,
      0.05,
      "Custom large topology weight should be 0.05 (5%)",
    );
  },
);

Deno.test(
  "AdaptiveMutation: config allows partial overrides with defaults",
  () => {
    const config = createNeatConfig({
      adaptiveMutationThresholds: {
        medium: 150,
      },
    });

    assertEquals(
      config.adaptiveMutationThresholds.medium,
      150,
      "Custom medium threshold should be 150 neurons",
    );
    assertEquals(
      config.adaptiveMutationThresholds.large,
      300,
      "Default large threshold should be used: 300 neurons",
    );
    assertEquals(
      config.adaptiveMutationThresholds.largeTopologyWeight,
      0.1,
      "Default large topology weight should be used: 0.1 (10%)",
    );
  },
);

Deno.test(
  "AdaptiveMutation: config validates medium threshold is positive integer",
  () => {
    assertThrows(
      () => {
        createNeatConfig({
          adaptiveMutationThresholds: {
            medium: -10,
          },
        });
      },
      Error,
      "medium",
      "Should reject negative medium threshold",
    );

    assertThrows(
      () => {
        createNeatConfig({
          adaptiveMutationThresholds: {
            medium: 0,
          },
        });
      },
      Error,
      "medium",
      "Should reject zero medium threshold",
    );

    assertThrows(
      () => {
        createNeatConfig({
          adaptiveMutationThresholds: {
            medium: 50.5,
          },
        });
      },
      Error,
      "medium",
      "Should reject non-integer medium threshold",
    );
  },
);

Deno.test(
  "AdaptiveMutation: config validates large threshold is positive integer",
  () => {
    assertThrows(
      () => {
        createNeatConfig({
          adaptiveMutationThresholds: {
            large: -10,
          },
        });
      },
      Error,
      "large",
      "Should reject negative large threshold",
    );

    assertThrows(
      () => {
        createNeatConfig({
          adaptiveMutationThresholds: {
            large: 0,
          },
        });
      },
      Error,
      "large",
      "Should reject zero large threshold",
    );

    assertThrows(
      () => {
        createNeatConfig({
          adaptiveMutationThresholds: {
            large: 100.5,
          },
        });
      },
      Error,
      "large",
      "Should reject non-integer large threshold",
    );
  },
);

Deno.test(
  "AdaptiveMutation: config validates large threshold is greater than medium",
  () => {
    assertThrows(
      () => {
        createNeatConfig({
          adaptiveMutationThresholds: {
            medium: 200,
            large: 100,
          },
        });
      },
      Error,
      "large",
      "Should reject large threshold smaller than medium",
    );

    assertThrows(
      () => {
        createNeatConfig({
          adaptiveMutationThresholds: {
            medium: 100,
            large: 100,
          },
        });
      },
      Error,
      "large",
      "Should reject large threshold equal to medium",
    );
  },
);

Deno.test(
  "AdaptiveMutation: config validates largeTopologyWeight is between 0 and 1",
  () => {
    assertThrows(
      () => {
        createNeatConfig({
          adaptiveMutationThresholds: {
            largeTopologyWeight: -0.1,
          },
        });
      },
      Error,
      "largeTopologyWeight",
      "Should reject negative topology weight",
    );

    assertThrows(
      () => {
        createNeatConfig({
          adaptiveMutationThresholds: {
            largeTopologyWeight: 1.5,
          },
        });
      },
      Error,
      "largeTopologyWeight",
      "Should reject topology weight greater than 1",
    );
  },
);

Deno.test(
  "AdaptiveMutation: config allows edge case values for largeTopologyWeight",
  () => {
    // Should allow 0 (completely disable topology mutations for large creatures)
    const configZero = createNeatConfig({
      adaptiveMutationThresholds: {
        largeTopologyWeight: 0,
      },
    });
    assertEquals(
      configZero.adaptiveMutationThresholds.largeTopologyWeight,
      0,
      "Should allow 0 for largeTopologyWeight",
    );

    // Should allow 1 (normal topology mutations for large creatures)
    const configOne = createNeatConfig({
      adaptiveMutationThresholds: {
        largeTopologyWeight: 1,
      },
    });
    assertEquals(
      configOne.adaptiveMutationThresholds.largeTopologyWeight,
      1,
      "Should allow 1 for largeTopologyWeight",
    );
  },
);

// ============================================================================
// Behaviour Tests - Small Creatures
// ============================================================================

Deno.test(
  "AdaptiveMutation: small creatures use standard mutation selection",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 100,
        large: 300,
        largeTopologyWeight: 0.1,
      },
    });
    const mutator = new Mutator(config);

    // Create a small creature (< 100 neurons total)
    // 3 input + 2 hidden + 2 output = 7 neurons (well under 100)
    const creature = new Creature(3, 2, { layers: [{ count: 2 }] });
    assertEquals(creature.neurons.length, 7, "Creature should have 7 neurons");

    // Run many iterations and verify we get standard distribution
    // Standard is ~81.25% weight/bias (from existing tests)
    const iterations = 10_000;
    let weightBiasCount = 0;

    for (let i = 0; i < iterations; i++) {
      const method = mutator.selectMutationMethod(creature);
      if (
        method.name === Mutation.MOD_BIAS.name ||
        method.name === Mutation.MOD_WEIGHT.name
      ) {
        weightBiasCount++;
      }
    }

    const weightBiasRatio = weightBiasCount / iterations;

    // For small creatures, expect standard ~81.25% weight/bias
    assertAlmostEquals(
      weightBiasRatio,
      0.8125,
      0.05,
      `Small creatures should use standard distribution (~81.25% weight/bias), got ${
        (weightBiasRatio * 100).toFixed(1)
      }%`,
    );
  },
);

// ============================================================================
// Behaviour Tests - Large Creatures
// ============================================================================

Deno.test(
  "AdaptiveMutation: large creatures heavily favour weight/bias mutations",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 100,
        large: 300,
        largeTopologyWeight: 0.1,
      },
    });
    const mutator = new Mutator(config);

    // Create a large creature (>= 300 neurons)
    // Build layers to get us over 300 total neurons
    // 10 input + 150 hidden layer 1 + 150 hidden layer 2 + 5 output = 315 neurons
    const creature = new Creature(10, 5, {
      layers: [{ count: 150 }, { count: 150 }],
    });
    assertEquals(
      creature.neurons.length >= 300,
      true,
      `Creature should have >= 300 neurons, has ${creature.neurons.length}`,
    );

    // Run many iterations
    const iterations = 10_000;
    let weightBiasCount = 0;
    let topologyCount = 0;

    for (let i = 0; i < iterations; i++) {
      const method = mutator.selectMutationMethod(creature);
      if (
        method.name === Mutation.MOD_BIAS.name ||
        method.name === Mutation.MOD_WEIGHT.name
      ) {
        weightBiasCount++;
      } else if (
        method.name === Mutation.ADD_NODE.name ||
        method.name === Mutation.ADD_CONN.name
      ) {
        topologyCount++;
      }
    }

    const weightBiasRatio = weightBiasCount / iterations;
    const topologyRatio = topologyCount / iterations;

    // For large creatures with 10% topology weight:
    // Weight/bias should be significantly higher than standard 81.25%
    // Topology expansion (ADD_NODE, ADD_CONN) should be significantly reduced
    assertAlmostEquals(
      weightBiasRatio,
      0.95, // Expect ~95% weight/bias for large creatures
      0.05,
      `Large creatures should heavily favour weight/bias (~95%), got ${
        (weightBiasRatio * 100).toFixed(1)
      }%`,
    );

    // ADD_NODE and ADD_CONN should be rare (~1-2% combined)
    assertEquals(
      topologyRatio < 0.05,
      true,
      `Topology expansion mutations should be < 5% for large creatures, got ${
        (topologyRatio * 100).toFixed(1)
      }%`,
    );
  },
);

Deno.test(
  "AdaptiveMutation: large creatures still allow topology mutations occasionally",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 100,
        large: 300,
        largeTopologyWeight: 0.1, // 10% chance
      },
    });
    const mutator = new Mutator(config);

    // Create a large creature (>= 300 neurons)
    const creature = new Creature(10, 5, {
      layers: [{ count: 150 }, { count: 150 }],
    });

    // Run many iterations to ensure we DO see some topology mutations
    const iterations = 10_000;
    let topologyCount = 0;

    for (let i = 0; i < iterations; i++) {
      const method = mutator.selectMutationMethod(creature);
      if (
        method.name === Mutation.ADD_NODE.name ||
        method.name === Mutation.ADD_CONN.name ||
        method.name === Mutation.SUB_NODE.name ||
        method.name === Mutation.SUB_CONN.name ||
        method.name === Mutation.SWAP_NODES.name ||
        method.name === Mutation.MOD_SQUASH.name
      ) {
        topologyCount++;
      }
    }

    // Should see some topology mutations (> 0)
    assertEquals(
      topologyCount > 0,
      true,
      "Large creatures should still occasionally get topology mutations",
    );
  },
);

Deno.test(
  "AdaptiveMutation: largeTopologyWeight of 0 completely disables topology mutations for large creatures",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 100,
        large: 300,
        largeTopologyWeight: 0, // Completely disable
      },
    });
    const mutator = new Mutator(config);

    // Create a large creature (>= 300 neurons)
    const creature = new Creature(10, 5, {
      layers: [{ count: 150 }, { count: 150 }],
    });

    // Run iterations - should ONLY get weight/bias mutations
    const iterations = 1_000;
    let weightBiasCount = 0;

    for (let i = 0; i < iterations; i++) {
      const method = mutator.selectMutationMethod(creature);
      if (
        method.name === Mutation.MOD_BIAS.name ||
        method.name === Mutation.MOD_WEIGHT.name
      ) {
        weightBiasCount++;
      }
    }

    assertEquals(
      weightBiasCount,
      iterations,
      "With largeTopologyWeight=0, large creatures should ONLY get weight/bias mutations",
    );
  },
);

// ============================================================================
// Behaviour Tests - Medium Creatures
// ============================================================================

Deno.test(
  "AdaptiveMutation: medium creatures have reduced topology expansion",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 100,
        large: 300,
        largeTopologyWeight: 0.1,
      },
    });
    const mutator = new Mutator(config);

    // Create a medium creature closer to the large threshold for more noticeable effect
    // 10 input + 240 hidden + 10 output = 260 neurons (87% towards large threshold)
    // At 260 neurons: t = (260-100)/(300-100) = 160/200 = 0.8
    // weightBiasPreference = 0.75 + 0.8 * (0.9 - 0.75) = 0.75 + 0.12 = 0.87
    const creature = new Creature(10, 10, { layers: [{ count: 240 }] });
    assertEquals(
      creature.neurons.length >= 100 && creature.neurons.length < 300,
      true,
      `Creature should have 100-299 neurons, has ${creature.neurons.length}`,
    );

    // Run many iterations
    const iterations = 10_000;
    let weightBiasCount = 0;
    let topologyExpansionCount = 0; // ADD_NODE, ADD_CONN only

    for (let i = 0; i < iterations; i++) {
      const method = mutator.selectMutationMethod(creature);
      if (
        method.name === Mutation.MOD_BIAS.name ||
        method.name === Mutation.MOD_WEIGHT.name
      ) {
        weightBiasCount++;
      } else if (
        method.name === Mutation.ADD_NODE.name ||
        method.name === Mutation.ADD_CONN.name
      ) {
        topologyExpansionCount++;
      }
    }

    const weightBiasRatio = weightBiasCount / iterations;
    const topologyExpansionRatio = topologyExpansionCount / iterations;

    // Medium creatures near the large threshold should have higher weight/bias ratio
    // than small creatures but not as high as large creatures.
    // At 260 neurons, expect ~87% weight/bias preference
    // Actual ratio will be slightly higher due to the fallback selection path
    assertEquals(
      weightBiasRatio > 0.84,
      true,
      `Medium creatures (near large threshold) should have > 84% weight/bias, got ${
        (weightBiasRatio * 100).toFixed(1)
      }%`,
    );
    assertEquals(
      weightBiasRatio < 0.95,
      true,
      `Medium creatures should have < 95% weight/bias (less than large), got ${
        (weightBiasRatio * 100).toFixed(1)
      }%`,
    );

    // Topology expansion should be reduced compared to small creatures
    // but higher than large creatures (< 5% for large vs ~8% for this medium)
    assertEquals(
      topologyExpansionRatio < 0.10,
      true,
      `Medium creatures should have < 10% topology expansion, got ${
        (topologyExpansionRatio * 100).toFixed(1)
      }%`,
    );
  },
);

// ============================================================================
// Boundary Tests
// ============================================================================

Deno.test(
  "AdaptiveMutation: creature at exactly medium threshold starts interpolation",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 100,
        large: 300,
        largeTopologyWeight: 0.1,
      },
    });
    const mutator = new Mutator(config);

    // Create a creature with exactly 100 neurons
    // 5 input + 92 hidden + 3 output = 100 neurons
    const creature = new Creature(5, 3, { layers: [{ count: 92 }] });
    assertEquals(
      creature.neurons.length,
      100,
      `Creature should have exactly 100 neurons, has ${creature.neurons.length}`,
    );

    // At exactly the medium threshold (t=0), the weight/bias preference is still 75%
    // This is the starting point of the interpolation to 90% at the large threshold
    const iterations = 10_000;
    let weightBiasCount = 0;

    for (let i = 0; i < iterations; i++) {
      const method = mutator.selectMutationMethod(creature);
      if (
        method.name === Mutation.MOD_BIAS.name ||
        method.name === Mutation.MOD_WEIGHT.name
      ) {
        weightBiasCount++;
      }
    }

    const weightBiasRatio = weightBiasCount / iterations;

    // At t=0 (exactly medium threshold), still uses ~81.25% weight/bias
    // (same as small creatures since interpolation hasn't started increasing yet)
    assertAlmostEquals(
      weightBiasRatio,
      0.8125,
      0.05,
      `Creature at medium threshold should use standard weight/bias (~81.25%), got ${
        (weightBiasRatio * 100).toFixed(1)
      }%`,
    );
  },
);

Deno.test(
  "AdaptiveMutation: creature at exactly large threshold is treated as large",
  () => {
    const config = createNeatConfig({
      mutation: Mutation.FFW,
      adaptiveMutationThresholds: {
        medium: 100,
        large: 300,
        largeTopologyWeight: 0.1,
      },
    });
    const mutator = new Mutator(config);

    // Create a creature with exactly 300 neurons
    // 10 input + 285 hidden + 5 output = 300 neurons
    const creature = new Creature(10, 5, { layers: [{ count: 285 }] });
    assertEquals(
      creature.neurons.length,
      300,
      `Creature should have exactly 300 neurons, has ${creature.neurons.length}`,
    );

    // Should be treated as large (heavily favour weight/bias)
    const iterations = 10_000;
    let weightBiasCount = 0;

    for (let i = 0; i < iterations; i++) {
      const method = mutator.selectMutationMethod(creature);
      if (
        method.name === Mutation.MOD_BIAS.name ||
        method.name === Mutation.MOD_WEIGHT.name
      ) {
        weightBiasCount++;
      }
    }

    const weightBiasRatio = weightBiasCount / iterations;

    // Should be near 95% (large creature behaviour)
    assertAlmostEquals(
      weightBiasRatio,
      0.95,
      0.05,
      `Creature at large threshold should heavily favour weight/bias (~95%), got ${
        (weightBiasRatio * 100).toFixed(1)
      }%`,
    );
  },
);
