/**
 * Issue #1436 - Tests for reduced generational dampening that slows training
 * convergence. Verifies that the generational dampening factor is capped so
 * that high config.generations values do not overwhelm the gradient signal.
 */
import { assertEquals, assertGreater, assertLess } from "@std/assert";
import type { CreatureTrace } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import {
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";
import { accumulateBias, calculateBias } from "../../src/propagate/Bias.ts";
import { SynapseState } from "../../src/propagate/SynapseState.ts";
import {
  accumulateWeight,
  calculateWeight,
} from "../../src/propagate/Weight.ts";
import type { Synapse } from "../../src/architecture/Synapse.ts";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function fakeSynapse(weight: number): Synapse {
  return { weight, from: 0, to: 1 } as Synapse;
}

function makeCreature(bias: number) {
  const creatureJSON: CreatureTrace = {
    neurons: [
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias,
        trace: {
          count: 0,
          hintValue: 0,
          totalBias: 0,
          totalAdjustedBias: 0,
          minimumActivation: 0,
          maximumActivation: 1,
        },
      },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 1,
        trace: {
          count: 0,
          totalPositiveActivation: 0,
          totalNegativeActivation: 0,
          countNegativeActivations: 0,
          countPositiveActivations: 0,
          totalPositiveAdjustedValue: 0,
          totalNegativeAdjustedValue: 0,
        },
      },
    ],
    input: 1,
    output: 1,
  };
  return Creature.fromJSON(creatureJSON);
}

// ---------------------------------------------------------------------------
// Weight dampening cap tests
// ---------------------------------------------------------------------------

Deno.test("calculateWeight - high generations does not overwhelm gradient signal", () => {
  // With high generations (100) and many samples, the gradient signal
  // should still have a meaningful impact on the weight.
  const config = createBackPropagationConfig({
    generations: 100,
    learningRate: 1,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });
  const cs = new SynapseState();
  const synapse = fakeSynapse(1.0);

  // Accumulate 10 samples all pointing toward weight=3.0
  for (let i = 0; i < 10; i++) {
    accumulateWeight(1.0, cs, 3.0, 1.0, config);
  }

  const result = calculateWeight(cs, synapse, config);

  // Issue #1436: With the cap, 10 samples should have a noticeable effect
  // even with generations=100. The result should move meaningfully toward
  // the target, not be stuck near the original weight of 1.0.
  assertGreater(
    result,
    1.1,
    "With 10 samples, weight should move noticeably from original 1.0",
  );
});

Deno.test("calculateWeight - dampening cap limits generational inertia", () => {
  // Compare weight adjustment with low vs high generations.
  // After the fix, the difference should be bounded — high generations
  // should not cause dramatically more inertia than moderate values.
  const configLow = createBackPropagationConfig({
    generations: 2,
    learningRate: 1,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });
  const configHigh = createBackPropagationConfig({
    generations: 100,
    learningRate: 1,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });

  // Accumulate 20 samples pointing toward weight=5.0
  const csLow = new SynapseState();
  const csHigh = new SynapseState();
  const synapse = fakeSynapse(1.0);

  for (let i = 0; i < 20; i++) {
    accumulateWeight(1.0, csLow, 5.0, 1.0, configLow);
    accumulateWeight(1.0, csHigh, 5.0, 1.0, configHigh);
  }

  const resultLow = calculateWeight(csLow, synapse, configLow);
  const resultHigh = calculateWeight(csHigh, synapse, configHigh);

  // Both should move toward 5.0. With the cap, the high-generations result
  // should not be dramatically worse than the low-generations result.
  assertGreater(resultHigh, 1.0, "High gens should still move toward target");
  // The ratio of adjustment should be bounded — high gens should achieve
  // at least 25% of the adjustment that low gens achieves.
  const adjustmentLow = resultLow - 1.0;
  const adjustmentHigh = resultHigh - 1.0;
  assertGreater(
    adjustmentHigh / adjustmentLow,
    0.25,
    "High generations should not reduce adjustment by more than 4x vs low generations",
  );
});

Deno.test("calculateWeight - generations=0 still works correctly", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });
  const cs = new SynapseState();
  const synapse = fakeSynapse(1.0);

  accumulateWeight(1.0, cs, 3.0, 1.0, config);

  const result = calculateWeight(cs, synapse, config);

  // With generations=0, the result should be entirely driven by samples
  assertGreater(result, 1.0, "Should move toward target weight of 3.0");
});

// ---------------------------------------------------------------------------
// Bias dampening cap tests
// ---------------------------------------------------------------------------

Deno.test("calculateBias - high generations does not overwhelm gradient signal", () => {
  const creature = makeCreature(1.0);
  const outputNode = creature.neurons.find((n) => n.type === "output")!;

  const config = createBackPropagationConfig({
    generations: 100,
    learningRate: 1,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 100_000,
  });

  const ns = creature.state.node(outputNode.index);

  // Accumulate 10 samples all pointing toward bias=-2.0
  // (targetPreActivation=targetBias-currentBias+preActivation pattern)
  for (let i = 0; i < 10; i++) {
    accumulateBias(ns, -2.0, 1.0, 1.0, config);
  }

  const result = calculateBias(outputNode, config);

  // Issue #1436: With the cap, 10 samples should have a noticeable effect
  // even with generations=100.
  assertLess(
    result,
    0.9,
    "With 10 samples, bias should move noticeably from original 1.0",
  );
});

Deno.test("calculateBias - dampening cap limits generational inertia", () => {
  // Compare bias adjustment with low vs high generations
  const configLow = createBackPropagationConfig({
    generations: 2,
    learningRate: 1,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 100_000,
  });
  const configHigh = createBackPropagationConfig({
    generations: 100,
    learningRate: 1,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 100_000,
  });

  const creatureLow = makeCreature(0.0);
  const creatureHigh = makeCreature(0.0);
  const outputLow = creatureLow.neurons.find((n) => n.type === "output")!;
  const outputHigh = creatureHigh.neurons.find((n) => n.type === "output")!;

  const nsLow = creatureLow.state.node(outputLow.index);
  const nsHigh = creatureHigh.state.node(outputHigh.index);

  // Accumulate 20 samples pointing toward bias=5.0
  for (let i = 0; i < 20; i++) {
    accumulateBias(nsLow, 5.0, 0.0, 0.0, configLow);
    accumulateBias(nsHigh, 5.0, 0.0, 0.0, configHigh);
  }

  const resultLow = calculateBias(outputLow, configLow);
  const resultHigh = calculateBias(outputHigh, configHigh);

  // Both should move toward 5.0
  assertGreater(resultHigh, 0, "High gens should still move toward target");
  // The high-gens adjustment should be at least 25% of the low-gens adjustment
  const adjustmentLow = resultLow;
  const adjustmentHigh = resultHigh;
  assertGreater(
    adjustmentHigh / adjustmentLow,
    0.25,
    "High generations should not reduce bias adjustment by more than 4x",
  );
});

Deno.test("calculateBias - generations=0 still works correctly", () => {
  const creature = makeCreature(1.0);
  const outputNode = creature.neurons.find((n) => n.type === "output")!;

  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 100_000,
  });

  const ns = creature.state.node(outputNode.index);
  accumulateBias(ns, -2.0, 1.0, 1.0, config);

  const result = calculateBias(outputNode, config);

  // With generations=0, the result should be driven entirely by samples
  assertLess(result, 1.0, "Should move toward target bias");
});

// ---------------------------------------------------------------------------
// Default generations cap configuration tests
// ---------------------------------------------------------------------------

Deno.test("createBackPropagationConfig - default generations is capped at reasonable value", () => {
  // Issue #1436: The default generations should not be excessively high.
  // Run multiple times to ensure random values are capped.
  for (let i = 0; i < 20; i++) {
    const config = createBackPropagationConfig();
    // Generations should be capped at a reasonable value (10)
    assertLess(
      config.generations,
      11,
      `Default generations should be capped at 10, got ${config.generations}`,
    );
    assertEquals(
      config.generations >= 0,
      true,
      "Generations should be non-negative",
    );
  }
});

Deno.test("createBackPropagationConfig - explicit generations above cap is still respected", () => {
  // Users can still set high generations explicitly
  const config = createBackPropagationConfig({ generations: 50 });
  assertEquals(config.generations, 50);
});
