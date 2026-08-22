/**
 * @module
 *
 * The values JSON has no literal for (Issue #3803).
 *
 * `creatureValidate` marshals a live creature into NEAT-AI-core's runtime
 * request shape. Most fields travel as themselves, but a non-finite bias, a
 * non-finite weight and an id that is not a number at all do not survive
 * `JSON.stringify` — the first two become `null`, the last is not a number
 * core can read. These tests drive `creatureValidate` with each of them and
 * assert the reported error still names the value the host actually holds.
 */

import { assertEquals, assertStringIncludes, fail } from "@std/assert";
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import {
  marshalCreatureValidateRequest,
  restoreSubstitutedId,
} from "@architecture/CreatureValidateMarshal.ts";
import type { ValidationError } from "@errors/ValidationError.ts";

/** A valid 2-input, 1-hidden, 1-output creature. */
function makeCreature(): Creature {
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
  creature.DEBUG = false;
  creatureValidate(creature);
  return creature;
}

/** Validates, failing the test when the creature unexpectedly passes. */
function expectThrow(creature: Creature): ValidationError {
  try {
    creatureValidate(creature);
  } catch (caught) {
    return caught as ValidationError;
  }
  fail("Expected creatureValidate to throw");
}

Deno.test("marshal: a NaN neuron id is reported as NaN, not as a missing id", () => {
  const creature = makeCreature();
  creature.neurons[2].id = NaN;

  const error = expectThrow(creature);
  assertEquals(error.reason, "OTHER");
  assertEquals(error.message, "NaN) invalid neuron id: NaN");
});

Deno.test("marshal: an Infinity neuron id keeps its printed value", () => {
  const creature = makeCreature();
  creature.neurons[2].id = Infinity;

  const error = expectThrow(creature);
  assertEquals(error.message, "Infinity) invalid neuron id: Infinity");
});

Deno.test("marshal: a string neuron id keeps its printed value", () => {
  const creature = makeCreature();
  creature.neurons[2].id = "grafted-7" as unknown as number;

  const error = expectThrow(creature);
  assertEquals(error.message, "grafted-7) invalid neuron id: grafted-7");
});

Deno.test("marshal: an earlier rule still wins over a substituted id", () => {
  const creature = makeCreature();
  // Neuron 1 breaks a rule of its own; neuron 2 carries an unsendable id.
  // First-failure-wins means neuron 1 is reported, exactly as before.
  creature.neurons[1].id = 1000;
  creature.neurons[2].id = "grafted-7" as unknown as number;

  const error = expectThrow(creature);
  assertStringIncludes(error.message, "invalid input neuron id: 1000");
});

Deno.test("marshal: a non-finite bias is named rather than read as absent", () => {
  for (const [bias, printed] of [
    [NaN, "NaN"],
    [Infinity, "Infinity"],
    [-Infinity, "-Infinity"],
  ] as [number, string][]) {
    const creature = makeCreature();
    creature.neurons[2].bias = bias;

    const error = expectThrow(creature);
    assertEquals(error.reason, "OTHER");
    assertStringIncludes(error.message, `invalid bias: ${printed}`);
  }
});

Deno.test("marshal: a healthy creature travels unchanged and answers with its counters", () => {
  const creature = makeCreature();
  assertEquals(creatureValidate(creature), {
    input: 2,
    constant: 0,
    hidden: 1,
    output: 1,
    connections: creature.synapses.length,
  });
});

Deno.test("marshal: only the four known option keys reach core", () => {
  const creature = makeCreature();
  const { request } = marshalCreatureValidateRequest(creature, {
    neurons: 4,
    forwardOnly: true,
  });

  assertEquals(request.options, { neurons: 4, forwardOnly: true });
  assertEquals(request.runtimeCreature.neurons.length, 4);
  assertEquals(request.runtimeCreature.input, 2);
  assertEquals(request.runtimeCreature.output, 1);
});

Deno.test("marshal: a non-finite weight travels as its sentinel", () => {
  const creature = makeCreature();
  creature.synapses[0].weight = Infinity;

  const { request } = marshalCreatureValidateRequest(creature);
  assertEquals(request.runtimeCreature.synapses[0].weight, "Infinity");
});

Deno.test("marshal: restoreSubstitutedId leaves untouched neurons alone", () => {
  const substituted = new Map([[2, "grafted-7"]]);

  assertEquals(
    restoreSubstitutedId("1) no id", 1, substituted),
    "1) no id",
  );
  assertEquals(
    restoreSubstitutedId("0.5) invalid neuron id: 0.5", null, substituted),
    "0.5) invalid neuron id: 0.5",
  );
  assertEquals(
    restoreSubstitutedId("0.5) invalid neuron id: 0.5", 2, substituted),
    "grafted-7) invalid neuron id: grafted-7",
  );
});
