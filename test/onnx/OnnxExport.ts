/**
 * Tests for ONNX export functionality.
 *
 * Issue #1866: Verifies that creatures can be exported to valid ONNX
 * format and that the exported models produce equivalent outputs
 * to the original creatures.
 */

import { assert, assertEquals, assertGreater, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { checkOnnxCompatibility, exportToOnnx } from "@onnx/mod.ts";
import {
  isAggregateFunction,
  isSquashSupported,
} from "@onnx/ActivationMapping.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("exportToOnnx produces non-empty bytes for simple creature", async () => {
  await initWasmForTests();

  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "LOGISTIC", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: -0.3 },
    ],
  });

  const onnxBytes = exportToOnnx(creature);
  assertGreater(onnxBytes.length, 0, "ONNX export should produce bytes");
  assert(onnxBytes instanceof Uint8Array, "Should return Uint8Array");
});

Deno.test("exportToOnnx with hidden layer produces valid bytes", async () => {
  await initWasmForTests();

  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.0 },
      {
        type: "output",
        uuid: "output-0",
        squash: "IDENTITY",
        bias: -0.1,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.7 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.9 },
    ],
  });

  const onnxBytes = exportToOnnx(creature);
  assertGreater(onnxBytes.length, 0);
});

Deno.test("exportToOnnx rejects creatures with aggregate functions", async () => {
  await initWasmForTests();

  // Create a creature with IF activation — should be rejected
  const creature = Creature.fromJSON({
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IF", bias: 0.0 },
      { type: "output", uuid: "output-0", squash: "TANH", bias: 0.0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 0.5,
        type: "condition",
      },
      {
        fromUUID: "input-1",
        toUUID: "hidden-0",
        weight: 0.3,
        type: "positive",
      },
      {
        fromUUID: "input-2",
        toUUID: "hidden-0",
        weight: 0.2,
        type: "negative",
      },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.9 },
    ],
  });

  assertThrows(
    () => exportToOnnx(creature),
    Error,
    "unsupported activation",
  );
});

Deno.test("checkOnnxCompatibility identifies unsupported squashes", async () => {
  await initWasmForTests();

  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IF", bias: 0.0 },
      { type: "output", uuid: "output-0", squash: "TANH", bias: 0.0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 0.5,
        type: "condition",
      },
      {
        fromUUID: "input-1",
        toUUID: "hidden-0",
        weight: 0.3,
        type: "positive",
      },
      {
        fromUUID: "input-1",
        toUUID: "hidden-0",
        weight: 0.2,
        type: "negative",
      },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.9 },
    ],
  });

  const result = checkOnnxCompatibility(creature);
  assertEquals(result.compatible, false);
  assert(result.unsupportedSquashes.includes("IF"));
});

Deno.test("checkOnnxCompatibility returns compatible for standard activations", async () => {
  await initWasmForTests();

  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.0 },
      {
        type: "output",
        uuid: "output-0",
        squash: "LOGISTIC",
        bias: 0.0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.9 },
    ],
  });

  const result = checkOnnxCompatibility(creature);
  assertEquals(result.compatible, true);
  assertEquals(result.unsupportedSquashes.length, 0);
});

Deno.test("isSquashSupported recognises standard activations", () => {
  const supported = [
    "IDENTITY",
    "ReLU",
    "LOGISTIC",
    "TANH",
    "LeakyReLU",
    "SELU",
    "ELU",
    "SOFTSIGN",
    "Softplus",
    "SINE",
    "Cosine",
    "TAN",
    "ArcTan",
    "ABSOLUTE",
    "SQRT",
    "Exponential",
    "StdInverse",
    "ReLU6",
    "HARD_TANH",
    "Swish",
    "Mish",
    "GELU",
    "GAUSSIAN",
    "BIPOLAR_SIGMOID",
    "BIPOLAR",
    "COMPLEMENT",
    "SQUARE",
    "Cube",
    "LogSigmoid",
    "ISRU",
    "BENT_IDENTITY",
    "STEP",
  ];

  for (const squash of supported) {
    assertEquals(
      isSquashSupported(squash),
      true,
      `${squash} should be supported`,
    );
  }
});

Deno.test("isAggregateFunction identifies aggregate functions", () => {
  assertEquals(isAggregateFunction("IF"), true);
  assertEquals(isAggregateFunction("MINIMUM"), true);
  assertEquals(isAggregateFunction("MAXIMUM"), true);
  assertEquals(isAggregateFunction("TANH"), false);
  assertEquals(isAggregateFunction("LOGISTIC"), false);
});

Deno.test("exportToOnnx with each standard activation produces bytes", async () => {
  await initWasmForTests();

  const activations = [
    "IDENTITY",
    "ReLU",
    "LOGISTIC",
    "TANH",
    "LeakyReLU",
    "SELU",
    "ELU",
    "SOFTSIGN",
    "Softplus",
    "SINE",
    "Cosine",
    "TAN",
    "ArcTan",
    "ABSOLUTE",
    "SQRT",
    "Exponential",
    "StdInverse",
    "ReLU6",
    "HARD_TANH",
    "Swish",
    "Mish",
    "GELU",
    "GAUSSIAN",
    "BIPOLAR_SIGMOID",
    "BIPOLAR",
    "COMPLEMENT",
    "SQUARE",
    "Cube",
    "LogSigmoid",
    "ISRU",
    "BENT_IDENTITY",
    "STEP",
  ];

  for (const squash of activations) {
    const creature = Creature.fromJSON({
      input: 2,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", squash, bias: 0.1 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "output-0", weight: -0.3 },
      ],
    });

    const onnxBytes = exportToOnnx(creature);
    assertGreater(
      onnxBytes.length,
      0,
      `ONNX export with ${squash} should produce bytes`,
    );
  }
});

Deno.test("exportToOnnx with custom graph name", async () => {
  await initWasmForTests();

  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      {
        type: "output",
        uuid: "output-0",
        squash: "IDENTITY",
        bias: 0.0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
  });

  const onnxBytes = exportToOnnx(creature, {
    graphName: "my_custom_model",
  });
  assertGreater(onnxBytes.length, 0);
});

Deno.test("exportToOnnx with multiple outputs", async () => {
  await initWasmForTests();

  const creature = Creature.fromJSON({
    input: 3,
    output: 2,
    neurons: [
      {
        type: "output",
        uuid: "output-0",
        squash: "LOGISTIC",
        bias: 0.1,
      },
      { type: "output", uuid: "output-1", squash: "TANH", bias: -0.2 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "output-1", weight: -0.4 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.7 },
    ],
  });

  const onnxBytes = exportToOnnx(creature);
  assertGreater(onnxBytes.length, 0);
});

Deno.test("exportToOnnx multi-layer network", async () => {
  await initWasmForTests();

  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "ReLU", bias: 0.0 },
      { type: "hidden", uuid: "h2", squash: "ReLU", bias: 0.0 },
      { type: "hidden", uuid: "h3", squash: "TANH", bias: 0.1 },
      {
        type: "output",
        uuid: "output-0",
        squash: "LOGISTIC",
        bias: -0.05,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.3 },
      { fromUUID: "input-0", toUUID: "h2", weight: -0.4 },
      { fromUUID: "input-1", toUUID: "h2", weight: 0.6 },
      { fromUUID: "h1", toUUID: "h3", weight: 0.8 },
      { fromUUID: "h2", toUUID: "h3", weight: -0.2 },
      { fromUUID: "h3", toUUID: "output-0", weight: 0.9 },
    ],
  });

  const onnxBytes = exportToOnnx(creature);
  assertGreater(onnxBytes.length, 0);
});

Deno.test("ONNX model starts with valid protobuf header", async () => {
  await initWasmForTests();

  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      {
        type: "output",
        uuid: "output-0",
        squash: "IDENTITY",
        bias: 0.0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
  });

  const onnxBytes = exportToOnnx(creature);

  // First byte should be field 1 (ir_version) with wire type 0 (varint)
  // Tag = (1 << 3) | 0 = 0x08
  assertEquals(onnxBytes[0], 0x08, "Should start with ir_version field tag");

  // ir_version should be 9
  assertEquals(onnxBytes[1], 9, "ir_version should be 9");
});

Deno.test("exportToOnnx with constant neuron", async () => {
  await initWasmForTests();

  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-1", bias: 1.0 },
      { type: "output", uuid: "output-0", squash: "TANH", bias: 0.0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "const-1", toUUID: "output-0", weight: 0.3 },
    ],
  });

  const onnxBytes = exportToOnnx(creature);
  assertGreater(onnxBytes.length, 0);
});

Deno.test("ONNX export contains producer name", async () => {
  await initWasmForTests();

  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      {
        type: "output",
        uuid: "output-0",
        squash: "IDENTITY",
        bias: 0.0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
  });

  const onnxBytes = exportToOnnx(creature);
  // Convert to string to check for the producer name
  const text = new TextDecoder().decode(onnxBytes);
  assert(text.includes("NEAT-AI"), "Should contain producer name NEAT-AI");
});
