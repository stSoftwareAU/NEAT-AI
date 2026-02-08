import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { collectGradientHints } from "../../src/blackbox/GradientHint.ts";

Deno.test("collectGradientHints - returns hints for biases and weights", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      {
        bias: -0.5,
        type: "output",
        squash: "BIPOLAR_SIGMOID",
        index: 2,
      },
    ],
    synapses: [
      { weight: 0.9, from: 1, to: 2 },
      { weight: 0.8, from: 0, to: 2 },
    ],
    input: 2,
    output: 1,
  });

  const trainingData: { input: number[]; output: number[] }[] = [
    { input: [0, 0], output: [0] },
    { input: [1, 0], output: [1] },
    { input: [0, 1], output: [1] },
    { input: [1, 1], output: [0] },
  ];

  const hints = collectGradientHints(creature, trainingData);

  // Should have bias hints for the output neuron
  assert(hints.biases.size > 0, "Should have at least one bias hint");

  // Should have weight hints for the synapses
  assert(hints.weights.size > 0, "Should have at least one weight hint");

  // Verify hint values are valid
  for (const [_uuid, hint] of hints.biases) {
    assert(
      hint.direction === -1 || hint.direction === 0 || hint.direction === 1,
      `Bias hint direction should be -1, 0, or 1, got ${hint.direction}`,
    );
    assert(
      hint.magnitude >= 0 && hint.magnitude <= 1,
      `Bias hint magnitude should be in [0, 1], got ${hint.magnitude}`,
    );
    assert(
      Number.isFinite(hint.direction),
      "Bias hint direction should be finite",
    );
    assert(
      Number.isFinite(hint.magnitude),
      "Bias hint magnitude should be finite",
    );
  }

  for (const [_key, hint] of hints.weights) {
    assert(
      hint.direction === -1 || hint.direction === 0 || hint.direction === 1,
      `Weight hint direction should be -1, 0, or 1, got ${hint.direction}`,
    );
    assert(
      hint.magnitude >= 0 && hint.magnitude <= 1,
      `Weight hint magnitude should be in [0, 1], got ${hint.magnitude}`,
    );
    assert(
      Number.isFinite(hint.direction),
      "Weight hint direction should be finite",
    );
    assert(
      Number.isFinite(hint.magnitude),
      "Weight hint magnitude should be finite",
    );
  }
});

Deno.test("collectGradientHints - empty training data returns empty hints", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      {
        bias: -0.5,
        type: "output",
        squash: "BIPOLAR_SIGMOID",
        index: 2,
      },
    ],
    synapses: [
      { weight: 0.9, from: 1, to: 2 },
    ],
    input: 2,
    output: 1,
  });

  const hints = collectGradientHints(creature, []);

  assertEquals(hints.biases.size, 0, "No bias hints expected with no data");
  assertEquals(hints.weights.size, 0, "No weight hints expected with no data");
});

Deno.test("collectGradientHints - direction reflects gradient sign", () => {
  // Create a creature where the bias is clearly wrong (should be positive, is very negative)
  const creature = Creature.fromJSON({
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      {
        bias: -5.0,
        type: "output",
        squash: "LOGISTIC",
        index: 1,
      },
    ],
    synapses: [
      { weight: 1.0, from: 0, to: 1 },
    ],
    input: 1,
    output: 1,
  });

  // Training data that expects high outputs
  const trainingData: { input: number[]; output: number[] }[] = [
    { input: [1], output: [0.9] },
    { input: [0.8], output: [0.8] },
    { input: [0.6], output: [0.7] },
  ];

  const hints = collectGradientHints(creature, trainingData);

  // The bias is -5.0 but we want high outputs, so gradient should suggest increasing (direction = 1)
  const biasHints = Array.from(hints.biases.values());
  assert(biasHints.length > 0, "Should have bias hints");
  // The gradient direction should be positive (want to increase bias)
  assertEquals(
    biasHints[0].direction,
    1,
    "Gradient should suggest increasing the bias",
  );
});

Deno.test("collectGradientHints - magnitude is normalised between 0 and 1", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      {
        bias: 0.1,
        type: "output",
        squash: "LOGISTIC",
        index: 1,
      },
    ],
    synapses: [
      { weight: 0.5, from: 0, to: 1 },
    ],
    input: 1,
    output: 1,
  });

  const trainingData: { input: number[]; output: number[] }[] = [
    { input: [1], output: [0.9] },
  ];

  const hints = collectGradientHints(creature, trainingData);

  for (const [_uuid, hint] of hints.biases) {
    assert(
      hint.magnitude >= 0 && hint.magnitude <= 1,
      `Magnitude should be in [0, 1], got ${hint.magnitude}`,
    );
  }

  for (const [_key, hint] of hints.weights) {
    assert(
      hint.magnitude >= 0 && hint.magnitude <= 1,
      `Magnitude should be in [0, 1], got ${hint.magnitude}`,
    );
  }
});

Deno.test("collectGradientHints - works with multi-layer creature", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      {
        bias: 0.1,
        type: "hidden",
        squash: "LOGISTIC",
        index: 2,
      },
      {
        bias: -0.2,
        type: "output",
        squash: "BIPOLAR_SIGMOID",
        index: 3,
      },
    ],
    synapses: [
      { weight: 0.5, from: 0, to: 2 },
      { weight: 0.6, from: 1, to: 2 },
      { weight: 0.7, from: 2, to: 3 },
    ],
    input: 2,
    output: 1,
  });

  const trainingData: { input: number[]; output: number[] }[] = [
    { input: [1, 0], output: [0.8] },
    { input: [0, 1], output: [0.3] },
  ];

  const hints = collectGradientHints(creature, trainingData);

  // Should have hints for both hidden and output neurons
  assert(
    hints.biases.size >= 1,
    "Should have bias hints for hidden and/or output neurons",
  );
  assert(hints.weights.size >= 1, "Should have weight hints");

  // All hints should be valid
  for (const [_uuid, hint] of hints.biases) {
    assert(Number.isFinite(hint.direction), "Direction should be finite");
    assert(Number.isFinite(hint.magnitude), "Magnitude should be finite");
  }
  for (const [_key, hint] of hints.weights) {
    assert(Number.isFinite(hint.direction), "Direction should be finite");
    assert(Number.isFinite(hint.magnitude), "Magnitude should be finite");
  }
});
