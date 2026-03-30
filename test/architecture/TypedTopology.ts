/**
 * Tests for TypedTopology — typed array representation of creature topology.
 *
 * Issue #1957: Replace JS object topology with typed arrays.
 */
import { assertEquals, assertInstanceOf } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { TypedTopology } from "@architecture/TypedTopology.ts";
import { getSquashType, SquashType } from "../../src/wasm/SquashType.ts";
import { SynapseTypeCode } from "../../src/wasm/CompileToWasm.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

/** Helper: create a simple 2-input, 1-hidden, 1-output creature. */
function makeTestCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "TANH", bias: -0.3 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.7 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.5 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test("TypedTopology: arrays are correct typed array instances", () => {
  const creature = makeTestCreature();
  const topo = TypedTopology.fromCreature(creature);

  assertInstanceOf(topo.biases, Float64Array);
  assertInstanceOf(topo.squashTypes, Uint8Array);
  assertInstanceOf(topo.fromIndices, Uint32Array);
  assertInstanceOf(topo.toIndices, Uint32Array);
  assertInstanceOf(topo.weights, Float64Array);
  assertInstanceOf(topo.synapseTypes, Uint8Array);
});

Deno.test("TypedTopology: metadata matches creature dimensions", () => {
  const creature = makeTestCreature();
  const topo = TypedTopology.fromCreature(creature);

  assertEquals(topo.numNeurons, creature.neurons.length);
  assertEquals(topo.numInputs, creature.input);
  assertEquals(topo.numOutputs, creature.output);
  assertEquals(topo.numSynapses, creature.synapses.length);
});

Deno.test("TypedTopology: array lengths match dimensions", () => {
  const creature = makeTestCreature();
  const topo = TypedTopology.fromCreature(creature);

  assertEquals(topo.biases.length, topo.numNeurons);
  assertEquals(topo.squashTypes.length, topo.numNeurons);
  assertEquals(topo.fromIndices.length, topo.numSynapses);
  assertEquals(topo.toIndices.length, topo.numSynapses);
  assertEquals(topo.weights.length, topo.numSynapses);
  assertEquals(topo.synapseTypes.length, topo.numSynapses);
});

Deno.test("TypedTopology: biases match creature neurons", () => {
  const creature = makeTestCreature();
  const topo = TypedTopology.fromCreature(creature);

  for (let i = 0; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    if (neuron.type === "input") {
      // Input neurons store Infinity bias in JS; typed array stores 0
      assertEquals(topo.biases[i], 0);
    } else {
      assertEquals(topo.biases[i], neuron.bias);
    }
  }
});

Deno.test("TypedTopology: squash types match creature neurons", () => {
  const creature = makeTestCreature();
  const topo = TypedTopology.fromCreature(creature);

  for (let i = 0; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    const expected = getSquashType(neuron.squash);
    assertEquals(topo.squashTypes[i], expected);
  }
});

Deno.test("TypedTopology: connectivity matches creature synapses", () => {
  const creature = makeTestCreature();
  const topo = TypedTopology.fromCreature(creature);

  for (let i = 0; i < creature.synapses.length; i++) {
    assertEquals(topo.fromIndices[i], creature.synapses[i].from);
    assertEquals(topo.toIndices[i], creature.synapses[i].to);
  }
});

Deno.test("TypedTopology: weights match creature synapses", () => {
  const creature = makeTestCreature();
  const topo = TypedTopology.fromCreature(creature);

  for (let i = 0; i < creature.synapses.length; i++) {
    assertEquals(topo.weights[i], creature.synapses[i].weight);
  }
});

Deno.test("TypedTopology: synapse types encoded correctly", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 1,
        type: "condition",
      },
      {
        fromUUID: "input-1",
        toUUID: "hidden-0",
        weight: 1,
        type: "negative",
      },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1, type: "positive" },
    ],
  });
  creature.validate();

  const topo = TypedTopology.fromCreature(creature);

  assertEquals(topo.synapseTypes[0], SynapseTypeCode.Condition);
  assertEquals(topo.synapseTypes[1], SynapseTypeCode.Negative);
  assertEquals(topo.synapseTypes[2], SynapseTypeCode.Positive);
});

Deno.test("TypedTopology: standard synapse type for undefined", () => {
  const creature = makeTestCreature();
  const topo = TypedTopology.fromCreature(creature);

  // makeTestCreature has no explicit synapse types → Standard (0)
  for (let i = 0; i < topo.numSynapses; i++) {
    assertEquals(topo.synapseTypes[i], SynapseTypeCode.Standard);
  }
});

Deno.test("TypedTopology: constant neuron has Identity squash", () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-0", bias: 1.0 },
      { type: "output", uuid: "output-0", squash: "TANH", bias: 0 },
    ],
    synapses: [
      { fromUUID: "const-0", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature.validate();

  const topo = TypedTopology.fromCreature(creature);

  // Constant neuron is at index 1 (after 1 input neuron)
  assertEquals(topo.squashTypes[1], SquashType.Identity);
  assertEquals(topo.biases[1], 1.0);
});

Deno.test("TypedTopology: empty hidden layer creature", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.4 },
    ],
  });
  creature.validate();

  const topo = TypedTopology.fromCreature(creature);

  assertEquals(topo.numNeurons, 3); // 2 inputs + 1 output
  assertEquals(topo.numInputs, 2);
  assertEquals(topo.numOutputs, 1);
  assertEquals(topo.numSynapses, 2);
});

Deno.test("TypedTopology: larger creature with multiple hidden neurons", () => {
  const creature = Creature.fromJSON({
    input: 3,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "h-0", squash: "ReLU", bias: 0.1 },
      { type: "hidden", uuid: "h-1", squash: "LOGISTIC", bias: -0.5 },
      { type: "hidden", uuid: "h-2", squash: "TANH", bias: 0.0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.2 },
      { type: "output", uuid: "output-1", squash: "LOGISTIC", bias: -0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h-1", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "h-2", weight: 0.8 },
      { fromUUID: "h-0", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "h-1", toUUID: "output-0", weight: -0.7 },
      { fromUUID: "h-2", toUUID: "output-1", weight: 0.9 },
    ],
  });
  creature.validate();

  const topo = TypedTopology.fromCreature(creature);

  assertEquals(topo.numNeurons, 8); // 3 inputs + 3 hidden + 2 output
  assertEquals(topo.numInputs, 3);
  assertEquals(topo.numOutputs, 2);
  assertEquals(topo.numSynapses, 6);

  // Verify squash types for hidden neurons
  assertEquals(topo.squashTypes[3], getSquashType("ReLU")); // h-0 at index 3
  assertEquals(topo.squashTypes[4], getSquashType("LOGISTIC")); // h-1 at index 4
  assertEquals(topo.squashTypes[5], getSquashType("TANH")); // h-2 at index 5
});

Deno.test("TypedTopology: toWasmBinary produces valid binary data", () => {
  const creature = makeTestCreature();
  const topo = TypedTopology.fromCreature(creature);
  const binary = topo.toWasmBinary();

  assertInstanceOf(binary, Uint8Array);

  // Verify header
  const view = new DataView(
    binary.buffer,
    binary.byteOffset,
    binary.byteLength,
  );
  assertEquals(view.getUint32(0, true), topo.numNeurons);
  assertEquals(view.getUint32(4, true), topo.numInputs);
});

Deno.test("TypedTopology: toWasmBinary matches CompileToWasm output", async () => {
  // Deferred import to avoid circular dependency at module level
  const { compileCreatureToWasm } = await import(
    "../../src/wasm/CompileToWasm.ts"
  );

  const creature = makeTestCreature();
  const topo = TypedTopology.fromCreature(creature);
  const typedBinary = topo.toWasmBinary();
  const legacyCompiled = compileCreatureToWasm(creature);

  // Both should produce identical binary output
  assertEquals(typedBinary.length, legacyCompiled.data.length);
  for (let i = 0; i < typedBinary.length; i++) {
    assertEquals(
      typedBinary[i],
      legacyCompiled.data[i],
      `Mismatch at byte ${i}`,
    );
  }
});

Deno.test("TypedTopology: toWasmBinary matches for IF creature", async () => {
  const { compileCreatureToWasm } = await import(
    "../../src/wasm/CompileToWasm.ts"
  );

  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 1,
        type: "condition",
      },
      {
        fromUUID: "input-1",
        toUUID: "hidden-0",
        weight: 1,
        type: "negative",
      },
      {
        fromUUID: "hidden-0",
        toUUID: "output-0",
        weight: 1,
        type: "positive",
      },
    ],
  });
  creature.validate();

  const topo = TypedTopology.fromCreature(creature);
  const typedBinary = topo.toWasmBinary();
  const legacyCompiled = compileCreatureToWasm(creature);

  assertEquals(typedBinary.length, legacyCompiled.data.length);
  for (let i = 0; i < typedBinary.length; i++) {
    assertEquals(
      typedBinary[i],
      legacyCompiled.data[i],
      `Mismatch at byte ${i}`,
    );
  }
});

Deno.test("TypedTopology: Creature.buildTypedTopology returns cached instance", () => {
  const creature = makeTestCreature();
  const topo1 = creature.buildTypedTopology();
  const topo2 = creature.buildTypedTopology();

  // Should return the same cached instance
  assertEquals(topo1, topo2);
});

Deno.test("TypedTopology: cache invalidated on clearCache", () => {
  const creature = makeTestCreature();
  const topo1 = creature.buildTypedTopology();
  creature.clearCache();
  const topo2 = creature.buildTypedTopology();

  // After clearCache, should build a new instance
  assertEquals(topo1 !== topo2, true);
  // But values should still match
  assertEquals(topo2.numNeurons, topo1.numNeurons);
});
