/**
 * Test to verify that compiled activation functions embed weights and biases.
 *
 * Issue #1050: Validates that issue #1013's proposal to cache compiled
 * activation functions by "topology hash" (excluding weights) would NOT work.
 *
 * Key finding: The compiled function string contains literal weight and bias
 * values (e.g., `a[0]*0.5` not `a[0]*weights[0]`), so creatures with the same
 * topology but different weights produce different function strings.
 *
 * This means:
 * 1. Every unique creature produces a unique activation function
 * 2. Caching by topology alone would return wrong functions
 * 3. Issue #1013's optimization is fundamentally incompatible with the design
 */

import { assert, assertNotEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { makeCreatureActivationFunction } from "../../../src/optimize/MakeCreatureActivationFunction.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ActivationFunctionUniqueness - weights embedded in function", () => {
  // Create a simple creature
  const json: CreatureExport = {
    neurons: [
      { bias: 0.5, type: "output", squash: "IDENTITY", uuid: "output-0" },
    ],
    synapses: [
      { weight: 0.3, fromUUID: "input-0", toUUID: "output-0" },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  const { inlineText } = makeCreatureActivationFunction(creature);

  // The weight 0.3 should be embedded directly in the function
  assert(
    inlineText.includes("0.3"),
    "Weight value should be embedded in the activation function text",
  );

  // The bias 0.5 should be embedded directly in the function
  assert(
    inlineText.includes("0.5"),
    "Bias value should be embedded in the activation function text",
  );
});

Deno.test("ActivationFunctionUniqueness - same topology different weights", () => {
  // Create two creatures with IDENTICAL topology but DIFFERENT weights
  const json1: CreatureExport = {
    neurons: [
      { bias: 0.5, type: "hidden", squash: "LOGISTIC", uuid: "hidden-0" },
      { bias: 0.1, type: "output", squash: "IDENTITY", uuid: "output-0" },
    ],
    synapses: [
      { weight: 0.3, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: 0.7, fromUUID: "hidden-0", toUUID: "output-0" },
    ],
    input: 1,
    output: 1,
  };

  const json2: CreatureExport = {
    neurons: [
      { bias: 0.9, type: "hidden", squash: "LOGISTIC", uuid: "hidden-0" },
      { bias: 0.2, type: "output", squash: "IDENTITY", uuid: "output-0" },
    ],
    synapses: [
      { weight: 0.8, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: 0.4, fromUUID: "hidden-0", toUUID: "output-0" },
    ],
    input: 1,
    output: 1,
  };

  const creature1 = Creature.fromJSON(json1);
  const creature2 = Creature.fromJSON(json2);

  const { inlineText: text1 } = makeCreatureActivationFunction(creature1);
  const { inlineText: text2 } = makeCreatureActivationFunction(creature2);

  // The activation functions should be DIFFERENT because weights/biases differ
  assertNotEquals(
    text1,
    text2,
    "Creatures with same topology but different weights should produce " +
      "different activation function strings - topology-only caching would fail",
  );

  // Verify specific values are embedded
  assert(text1.includes("0.3"), "Creature1's weight should be embedded");
  assert(text1.includes("0.7"), "Creature1's weight should be embedded");
  assert(text2.includes("0.8"), "Creature2's weight should be embedded");
  assert(text2.includes("0.4"), "Creature2's weight should be embedded");
});

Deno.test("ActivationFunctionUniqueness - constant neurons pre-compute", () => {
  // Constant neurons have their bias * weight pre-computed
  const json: CreatureExport = {
    neurons: [
      { bias: 2.5, type: "constant", uuid: "const-0" },
      { bias: 0.1, type: "output", squash: "IDENTITY", uuid: "output-0" },
    ],
    synapses: [
      { weight: 4.0, fromUUID: "const-0", toUUID: "output-0" },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  const { inlineText } = makeCreatureActivationFunction(creature);

  // The pre-computed value (2.5 * 4.0 = 10) should be in the function
  assert(
    inlineText.includes("10"),
    "Constant value (bias * weight) should be pre-computed in the function",
  );
});

Deno.test("ActivationFunctionUniqueness - no dynamic lookup", () => {
  // Verify that weights are NOT looked up dynamically
  const json: CreatureExport = {
    neurons: [
      { bias: 0.123, type: "output", squash: "IDENTITY", uuid: "output-0" },
    ],
    synapses: [
      { weight: 0.456, fromUUID: "input-0", toUUID: "output-0" },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  const { inlineText } = makeCreatureActivationFunction(creature);

  // The function should NOT contain dynamic weight lookups
  assert(
    !inlineText.includes("weight["),
    "Weights should be literals, not array lookups",
  );
  assert(
    !inlineText.includes("weights["),
    "Weights should be literals, not array lookups",
  );
  assert(
    !inlineText.includes(".weight"),
    "Weights should be literals, not property accesses",
  );

  // The function should NOT contain dynamic bias lookups
  assert(
    !inlineText.includes("bias["),
    "Biases should be literals, not array lookups",
  );
  assert(
    !inlineText.includes("biases["),
    "Biases should be literals, not array lookups",
  );
});

Deno.test("ActivationFunctionUniqueness - different activation outputs", () => {
  // Verify that creatures with different weights produce different outputs
  const json1: CreatureExport = {
    neurons: [
      { bias: 0, type: "output", squash: "IDENTITY", uuid: "output-0" },
    ],
    synapses: [
      { weight: 2.0, fromUUID: "input-0", toUUID: "output-0" },
    ],
    input: 1,
    output: 1,
  };

  const json2: CreatureExport = {
    neurons: [
      { bias: 0, type: "output", squash: "IDENTITY", uuid: "output-0" },
    ],
    synapses: [
      { weight: 3.0, fromUUID: "input-0", toUUID: "output-0" },
    ],
    input: 1,
    output: 1,
  };

  const creature1 = Creature.fromJSON(json1);
  const creature2 = Creature.fromJSON(json2);

  const input = new Float32Array([5.0]);
  const output1 = creature1.activate(input, false)[0];
  const output2 = creature2.activate(input, false)[0];

  // creature1: 5.0 * 2.0 = 10.0
  // creature2: 5.0 * 3.0 = 15.0
  assert(
    Math.abs(output1 - 10.0) < 0.0001,
    `Creature1 output should be 10.0, got ${output1}`,
  );
  assert(
    Math.abs(output2 - 15.0) < 0.0001,
    `Creature2 output should be 15.0, got ${output2}`,
  );

  // If we cached by topology, creature2 would incorrectly return 10.0
  assertNotEquals(
    output1,
    output2,
    "Creatures with different weights must produce different outputs",
  );
});
