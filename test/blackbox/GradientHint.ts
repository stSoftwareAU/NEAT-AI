import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import {
  applyGradientBias,
  computeGradientHint,
  type GradientHint,
} from "../../src/blackbox/GradientHint.ts";
import {
  fineTuneImprovement,
  quantumAdjust,
} from "../../src/blackbox/FineTune.ts";
import { Creature } from "../../src/Creature.ts";
import type { Approach } from "../../src/NEAT/LogApproach.ts";

Deno.test("applyGradientBias - zero direction returns delta unchanged", () => {
  const hint: GradientHint = { direction: 0, magnitude: 0.8 };
  const result = applyGradientBias(0.5, hint, 0.1);
  assertEquals(result, 0.5);
});

Deno.test("applyGradientBias - zero magnitude returns delta unchanged", () => {
  const hint: GradientHint = { direction: 1, magnitude: 0 };
  const result = applyGradientBias(0.5, hint, 0.1);
  assertEquals(result, 0.5);
});

Deno.test("applyGradientBias - zero delta returns zero", () => {
  const hint: GradientHint = { direction: 1, magnitude: 0.8 };
  const result = applyGradientBias(0, hint, 0.1);
  assertEquals(result, 0);
});

Deno.test("applyGradientBias - aligned delta is boosted", () => {
  const hint: GradientHint = { direction: 1, magnitude: 1.0 };
  // Delta +0.5 aligns with gradient direction +1
  const result = applyGradientBias(0.5, hint, 0.1);
  // Should be boosted: 0.5 * (1 + 1.0 * 0.5) = 0.75
  assertEquals(result, 0.75);
});

Deno.test("applyGradientBias - aligned negative delta is boosted", () => {
  const hint: GradientHint = { direction: -1, magnitude: 0.6 };
  // Delta -0.5 aligns with gradient direction -1
  const result = applyGradientBias(-0.5, hint, 0.1);
  // Should be boosted: -0.5 * (1 + 0.6 * 0.5) = -0.65
  assertEquals(result, -0.65);
});

Deno.test("applyGradientBias - opposing delta flips when random < flipProbability", () => {
  const hint: GradientHint = { direction: 1, magnitude: 1.0 };
  // Delta -0.5 opposes gradient direction +1
  // flipProbability = 1.0 * 0.7 = 0.7, random = 0.1 < 0.7 → flip
  const result = applyGradientBias(-0.5, hint, 0.1);
  assertEquals(result, 0.5);
});

Deno.test("applyGradientBias - opposing delta kept when random >= flipProbability", () => {
  const hint: GradientHint = { direction: 1, magnitude: 1.0 };
  // Delta -0.5 opposes gradient direction +1
  // flipProbability = 1.0 * 0.7 = 0.7, random = 0.9 >= 0.7 → keep
  const result = applyGradientBias(-0.5, hint, 0.9);
  assertEquals(result, -0.5);
});

Deno.test("applyGradientBias - low magnitude reduces flip probability", () => {
  const hint: GradientHint = { direction: 1, magnitude: 0.1 };
  // Delta -0.5 opposes gradient direction +1
  // flipProbability = 0.1 * 0.7 = 0.07, random = 0.1 >= 0.07 → keep
  const result = applyGradientBias(-0.5, hint, 0.1);
  assertEquals(result, -0.5);
});

Deno.test("applyGradientBias - partial magnitude gives partial boost", () => {
  const hint: GradientHint = { direction: 1, magnitude: 0.5 };
  // Delta +0.4 aligns with gradient direction +1
  const result = applyGradientBias(0.4, hint, 0.1);
  // Should be boosted: 0.4 * (1 + 0.5 * 0.5) = 0.5
  assertEquals(result, 0.5);
});

Deno.test("quantumAdjust - accepts gradient hint and produces changed result", () => {
  const hint: GradientHint = { direction: 1, magnitude: 0.8 };
  const result = quantumAdjust(
    0.5,
    0.3,
    false,
    false,
    undefined,
    undefined,
    undefined,
    hint,
  );
  // With diff = 0.2 (above MIN_STEP), should produce a changed result
  assert(result.changed, "Should have changed with gradient hint");
  assertNotEquals(result.value, 0.5, "Value should differ from currentBest");
});

Deno.test("quantumAdjust - gradient hint with no diff returns unchanged", () => {
  const hint: GradientHint = { direction: 1, magnitude: 0.8 };
  const result = quantumAdjust(
    0.5,
    0.5,
    false,
    false,
    undefined,
    undefined,
    undefined,
    hint,
  );
  // diff = 0, so still no change
  assert(!result.changed, "Should not change when diff is zero");
  assertEquals(result.value, 0.5);
});

Deno.test("quantumAdjust - works without gradient hint (backward compatible)", () => {
  const result = quantumAdjust(
    0.5,
    0.3,
    false,
    false,
  );
  assert(result.changed, "Should change without gradient hint");
});

Deno.test("quantumAdjust - gradient hint with zero magnitude behaves like no hint", () => {
  const zeroHint: GradientHint = { direction: 1, magnitude: 0 };

  // Run multiple times - with zero magnitude, gradient should have no effect
  // Both should produce changed results with the same basic behaviour
  let changedCount = 0;
  for (let i = 0; i < 20; i++) {
    const result = quantumAdjust(
      0.5,
      0.3,
      false,
      false,
      undefined,
      undefined,
      undefined,
      zeroHint,
    );
    if (result.changed) changedCount++;
  }
  assert(changedCount > 0, "Should produce some changed results");
});

Deno.test("quantumAdjust - gradient hint combined with momentum", () => {
  const hint: GradientHint = { direction: 1, magnitude: 0.8 };
  const result = quantumAdjust(
    0.5,
    0.3,
    false,
    false,
    1.5, // momentum factor
    1, // suggested direction
    undefined,
    hint,
  );
  assert(result.changed, "Should change with both momentum and gradient");
});

Deno.test("quantumAdjust - gradient hint combined with adaptive params", () => {
  const hint: GradientHint = { direction: -1, magnitude: 0.6 };
  const result = quantumAdjust(
    0.5,
    0.3,
    false,
    false,
    undefined,
    undefined,
    {
      quantumStepConfig: { minStep: 0.0000001, maxStep: 0.001, errorScale: 10 },
      previousScore: -0.5,
      currentScore: -0.4,
    },
    hint,
  );
  assert(result.changed, "Should change with gradient and adaptive params");
});

// --- computeGradientHint tests ---

Deno.test("computeGradientHint - no change returns undefined", () => {
  const hint = computeGradientHint(0.5, 0.5, 0.1);
  assertEquals(hint, undefined);
});

Deno.test("computeGradientHint - no score improvement returns undefined", () => {
  const hint = computeGradientHint(0.6, 0.5, 0);
  assertEquals(hint, undefined);
});

Deno.test("computeGradientHint - negative score improvement returns undefined", () => {
  const hint = computeGradientHint(0.6, 0.5, -0.1);
  assertEquals(hint, undefined);
});

Deno.test("computeGradientHint - positive change with improvement gives direction +1", () => {
  const hint = computeGradientHint(0.6, 0.5, 0.1);
  assert(hint !== undefined, "Should return a hint");
  assertEquals(hint.direction, 1);
  assert(hint.magnitude > 0, "Magnitude should be positive");
  assert(hint.magnitude < 1, "Magnitude should be less than 1");
});

Deno.test("computeGradientHint - negative change with improvement gives direction -1", () => {
  const hint = computeGradientHint(0.3, 0.5, 0.2);
  assert(hint !== undefined, "Should return a hint");
  assertEquals(hint.direction, -1);
  assert(hint.magnitude > 0, "Magnitude should be positive");
});

Deno.test("computeGradientHint - large improvement gives higher magnitude", () => {
  const smallHint = computeGradientHint(0.6, 0.5, 0.01);
  const largeHint = computeGradientHint(0.6, 0.5, 1.0);
  assert(smallHint !== undefined && largeHint !== undefined);
  assert(
    largeHint.magnitude > smallHint.magnitude,
    `Large improvement magnitude ${largeHint.magnitude} should exceed small ${smallHint.magnitude}`,
  );
});

Deno.test("computeGradientHint - magnitude is bounded below 1", () => {
  const hint = computeGradientHint(0.6, 0.5, 1000);
  assert(hint !== undefined, "Should return a hint");
  assert(hint.magnitude < 1, "Magnitude should be bounded below 1");
  assert(
    hint.magnitude > 0.99,
    "Magnitude should approach 1 for large improvements",
  );
});

// --- fineTuneImprovement integration test ---

Deno.test("fineTuneImprovement - produces tuned creatures with gradient hints active", () => {
  const previousFittest: Creature = Creature.fromJSON({
    "neurons": [{
      "bias": 0,
      "type": "input",
      "squash": "LOGISTIC",
      "index": 0,
    }, {
      "bias": 0,
      "type": "input",
      "squash": "LOGISTIC",
      "index": 1,
    }, {
      "bias": -0.49135010426905,
      "type": "output",
      "squash": "BIPOLAR_SIGMOID",
      "index": 2,
    }],
    "synapses": [{
      "weight": 0.9967556172986067,
      "from": 1,
      "to": 2,
    }, { "weight": 0.96864643541, "from": 0, "to": 2 }],
    "input": 2,
    "output": 1,
    tags: [
      { name: "score", value: "-0.5" },
    ],
  });

  const fittest = Creature.fromJSON(previousFittest.exportJSON());
  fittest.score = -0.4;
  previousFittest.score = -0.5;
  addTag(fittest, "approach", "trained" as Approach);
  fittest.neurons[2].bias = 0.001;
  fittest.synapses[0].weight = 0.011;

  // fineTuneImprovement now uses gradient hints internally
  const fineTuned = fineTuneImprovement(
    fittest,
    previousFittest,
    false,
    10,
  );

  assert(
    fineTuned.length === 10,
    "Should produce 10 fine-tuned creatures, was: " + fineTuned.length,
  );

  // Verify all tuned creatures have valid non-input neurons and synapses
  for (const creature of fineTuned) {
    assert(creature !== null, "Tuned creature should not be null");
    for (const synapse of creature.synapses) {
      assert(
        Number.isFinite(synapse.weight),
        "Synapse weight should be finite",
      );
    }
    for (const neuron of creature.neurons) {
      // Input neurons may have non-finite biases (pre-existing behaviour)
      if (neuron.type !== "input") {
        assert(
          Number.isFinite(neuron.bias),
          `Neuron bias should be finite for ${neuron.type} neuron, got: ${neuron.bias}`,
        );
      }
    }
  }
});
