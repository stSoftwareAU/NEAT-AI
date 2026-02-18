/**
 * Unit tests for the Activations registry class - find, list, pickRandomSquash.
 *
 * @module
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Activations } from "../../../src/methods/activations/Activations.ts";
import { ActivationError } from "../../../src/errors/ActivationError.ts";

Deno.test("Activations.find returns known activation by name", () => {
  const relu = Activations.find("ReLU");
  assertEquals(relu.getName(), "ReLU");
});

Deno.test("Activations.find throws ActivationError for unknown name", () => {
  assertThrows(
    () => Activations.find("NONEXISTENT_ACTIVATION"),
    ActivationError,
  );
});

Deno.test("Activations.find resolves alias RELU to ReLU", () => {
  const act = Activations.find("RELU");
  assertEquals(act.getName(), "ReLU");
});

Deno.test("Activations.find resolves alias CLIPPED to HARD_TANH", () => {
  const act = Activations.find("CLIPPED");
  assertEquals(act.getName(), "HARD_TANH");
});

Deno.test("Activations.find resolves alias INVERSE to COMPLEMENT", () => {
  const act = Activations.find("INVERSE");
  assertEquals(act.getName(), "COMPLEMENT");
});

Deno.test("Activations.find resolves alias SINUSOID to SINE", () => {
  const act = Activations.find("SINUSOID");
  assertEquals(act.getName(), "SINE");
});

Deno.test("Activations.list returns non-empty array", () => {
  const list = Activations.list();
  assert(list.length > 0);
});

Deno.test("Activations.list contains all standard activations", () => {
  const list = Activations.list();
  const names = list.map((a) => a.getName());

  const expectedNames = [
    "ReLU",
    "LOGISTIC",
    "TANH",
    "IDENTITY",
    "STEP",
    "GAUSSIAN",
    "SELU",
  ];

  for (const name of expectedNames) {
    assertEquals(
      names.includes(name),
      true,
      `Expected ${name} in activation list`,
    );
  }
});

Deno.test("Activations.pickRandomSquash returns a valid activation name", () => {
  const name = Activations.pickRandomSquash();
  // Should not throw when we look it up
  const act = Activations.find(name);
  assertEquals(typeof act.getName(), "string");
});

Deno.test("Activations.pickRandomSquash with exclude omits that name", () => {
  // Run multiple times to increase confidence
  for (let i = 0; i < 20; i++) {
    const name = Activations.pickRandomSquash("IDENTITY");
    assertEquals(name !== "IDENTITY", true);
  }
});

Deno.test("All activations have non-negative mutationProbability", () => {
  const list = Activations.list();
  for (const act of list) {
    assertEquals(
      act.mutationProbability >= 0,
      true,
      `${act.getName()} has mutationProbability < 0`,
    );
  }
});

Deno.test("All activations have a range property", () => {
  const list = Activations.list();
  for (const act of list) {
    assertEquals(
      act.range !== undefined,
      true,
      `${act.getName()} is missing range`,
    );
  }
});
