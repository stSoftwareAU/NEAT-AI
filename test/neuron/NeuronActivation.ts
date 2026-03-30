import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  hasApplyLearnings,
  isFixableActivation,
  isNodeActivation,
} from "@neuron/NeuronActivation.ts";

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
