/**
 * Unit tests for the Activations registry class - find, list, pickRandomSquash.
 *
 * @module
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Activations } from "../../../src/methods/activations/Activations.ts";

Deno.test("Activations.find returns known activation by name", () => {
  const relu = Activations.find("ReLU");
  assertEquals(relu.getName(), "ReLU");
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
  // Should not throw when we look it up — and name should round-trip
  const act = Activations.find(name);
  assertEquals(act.getName(), name);
});

Deno.test("Activations.pickRandomSquash with exclude omits that name", () => {
  // Run multiple times to increase confidence
  for (let i = 0; i < 20; i++) {
    const name = Activations.pickRandomSquash("IDENTITY");
    assertNotEquals(name, "IDENTITY");
  }
});

Deno.test("All activations have non-negative integer mutationProbability", () => {
  const list = Activations.list();
  for (const act of list) {
    assert(
      Number.isInteger(act.mutationProbability) &&
        act.mutationProbability >= 0,
      `${act.getName()} mutationProbability should be a non-negative integer, got ${act.mutationProbability}`,
    );
  }
});

Deno.test("All activations have a range with valid low and high bounds", () => {
  const list = Activations.list();
  for (const act of list) {
    assert(act.range !== undefined, `${act.getName()} is missing range`);
    assert(
      act.range.low <= act.range.high,
      `${act.getName()} range.low (${act.range.low}) > range.high (${act.range.high})`,
    );
  }
});
