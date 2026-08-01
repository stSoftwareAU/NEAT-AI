import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  hasApplyLearnings,
  isFixableActivation,
  isNodeActivation,
} from "@neuron/NeuronActivation.ts";
import { Creature } from "@creature";

Deno.test("isNodeActivation - returns true when activateAndTrace is defined", () => {
  const activation = {
    activateAndTrace: () => 0,
    activate: () => 0,
    range: { low: -1, high: 1, limit: (v: number) => v, validate: () => {} },
  };
  assert(isNodeActivation(activation as never));
});

Deno.test("isNodeActivation - returns false for plain ActivationInterface", () => {
  const activation = {
    squash: (v: number) => v,
    range: { low: -1, high: 1, limit: (v: number) => v, validate: () => {} },
  };
  assertFalse(isNodeActivation(activation as never));
});

Deno.test("hasApplyLearnings - returns true when applyLearnings is defined", () => {
  const activation = {
    applyLearnings: () => true,
    squash: (v: number) => v,
    range: { low: -1, high: 1, limit: (v: number) => v, validate: () => {} },
  };
  assert(hasApplyLearnings(activation as never));
});

Deno.test("hasApplyLearnings - returns false when applyLearnings is absent", () => {
  const activation = {
    squash: (v: number) => v,
    range: { low: -1, high: 1, limit: (v: number) => v, validate: () => {} },
  };
  assertFalse(hasApplyLearnings(activation as never));
});

Deno.test("isFixableActivation - returns true when fix is defined", () => {
  const activation = {
    fix: () => {},
    squash: (v: number) => v,
    range: { low: -1, high: 1, limit: (v: number) => v, validate: () => {} },
  };
  assert(isFixableActivation(activation as never));
});

Deno.test("isFixableActivation - returns false when fix is absent", () => {
  const activation = {
    squash: (v: number) => v,
    range: { low: -1, high: 1, limit: (v: number) => v, validate: () => {} },
  };
  assertFalse(isFixableActivation(activation as never));
});

Deno.test("isNodeActivation - returns false for undefined activateAndTrace", () => {
  const activation = {
    activateAndTrace: undefined,
    squash: (v: number) => v,
    range: { low: -1, high: 1, limit: (v: number) => v, validate: () => {} },
  };
  assertFalse(isNodeActivation(activation as never));
});

Deno.test("hasApplyLearnings - returns false for undefined applyLearnings", () => {
  const activation = {
    applyLearnings: undefined,
    squash: (v: number) => v,
    range: { low: -1, high: 1, limit: (v: number) => v, validate: () => {} },
  };
  assertFalse(hasApplyLearnings(activation as never));
});

Deno.test("isFixableActivation - returns false for undefined fix", () => {
  const activation = {
    fix: undefined,
    squash: (v: number) => v,
    range: { low: -1, high: 1, limit: (v: number) => v, validate: () => {} },
  };
  assertFalse(isFixableActivation(activation as never));
});

Deno.test("Type guards handle empty objects correctly", () => {
  const empty = {} as never;
  assertFalse(isNodeActivation(empty));
  assertFalse(hasApplyLearnings(empty));
  assertFalse(isFixableActivation(empty));
});

Deno.test("Type guards return correct types", () => {
  // Verify the type guard narrows correctly
  const nodeAct = {
    activateAndTrace: () => 0,
    activate: () => 0,
    range: { low: -1, high: 1, limit: (v: number) => v, validate: () => {} },
  };
  if (isNodeActivation(nodeAct as never)) {
    // If type guard passes, we should be able to call activateAndTrace
    assertEquals(typeof nodeAct.activateAndTrace, "function");
  }
});

/**
 * Issue #3609: the dynamic-compilation helper is module-private, so it is
 * exercised through `prepare()` — the only caller.
 */
Deno.test("prepare - compiles an activation function for a plain squash", () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.25 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
  });
  const state = creature.state;
  state.activations = new Float32Array(creature.neurons.length);
  state.activations[0] = 2;

  const neuron = creature.neurons[creature.neurons.length - 1];
  const squashMethod = neuron.prepare();
  assert(squashMethod, "prepare should return the squash method");
  assertFalse(isNodeActivation(squashMethod));

  // value = bias + activations[input] * weight = 0.25 + 2 * 0.5 = 1.25
  const result = neuron.activateNeuron();
  assertEquals(result.value, 1.25);
  assertEquals(result.activation, 1.25); // IDENTITY
  assertEquals(state.activations[neuron.index], 1.25);
});

Deno.test("prepare - traced activation records the hint value", () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 2 },
    ],
  });
  const state = creature.state;
  state.activations = new Float32Array(creature.neurons.length);
  state.activations[0] = 1.5;

  const neuron = creature.neurons[creature.neurons.length - 1];
  neuron.prepare();

  const result = neuron.activateAndTraceNeuron();
  assertEquals(result.value, 3);
  assertEquals(state.node(neuron.index).hintValue, 3);
});
