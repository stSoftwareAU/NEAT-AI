/**
 * Issue #3672: `json.input` from untrusted model JSON drove the input-neuron
 * allocation loop in `loadFrom` before any validation ran — a negative count
 * looped forever (`while (i--)` decrements away from zero) and a huge count
 * exhausted memory. These tests pin the boundary check that now runs first.
 *
 * Note: without the fix the negative cases never return, so this suite hangs
 * rather than fails.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { fromJSON, loadFrom } from "@creature/CreatureSerialization.ts";
import { MAX_NEURON_COUNT } from "@creature/CreatureShapeValidation.ts";
import type {
  CreatureExport,
  CreatureInternal,
} from "@architecture/CreatureInterfaces.ts";
import { ValidationError } from "@errors/ValidationError.ts";

/** Minimal model JSON with an arbitrary (possibly hostile) input/output shape. */
function shapedJson(input: unknown, output: unknown): CreatureExport {
  return { input, output, neurons: [], synapses: [] } as unknown as
    & CreatureExport
    & CreatureInternal;
}

const REJECTED_INPUTS: [string, unknown][] = [
  ["negative", -1],
  ["large negative", -1_000_000],
  ["zero", 0],
  ["fractional", 1.5],
  ["numeric string", "2"],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["undefined", undefined],
  ["above the ceiling", MAX_NEURON_COUNT + 1],
  ["one hundred million", 100_000_000],
];

for (const [label, value] of REJECTED_INPUTS) {
  Deno.test(`fromJSON - rejects ${label} input before allocating`, () => {
    const error = assertThrows(
      () => Creature.fromJSON(shapedJson(value, 1)),
      ValidationError,
    );
    assert(
      error.message.includes("input"),
      `message should name the offending field: ${error.message}`,
    );
  });

  Deno.test(`fromJSON - rejects ${label} output before allocating`, () => {
    const error = assertThrows(
      () => Creature.fromJSON(shapedJson(1, value)),
      ValidationError,
    );
    assert(
      error.message.includes("output"),
      `message should name the offending field: ${error.message}`,
    );
  });
}

Deno.test("loadFrom - rejects a hostile shape on the direct load path", () => {
  const creature = new Creature(2, 1, { lazyInitialization: true });
  assertThrows(
    () => loadFrom(creature, shapedJson(-1, 1), false),
    ValidationError,
  );
});

Deno.test("fromPersistedJSON - rejects a hostile shape", () => {
  assertThrows(
    () => Creature.fromPersistedJSON(shapedJson(-5, 1)),
    ValidationError,
  );
});

Deno.test("MAX_NEURON_COUNT - stays below the hidden neuron id floor", () => {
  // Input neuron ids are their array index; hidden/constant ids start at
  // 1,000,000 (see NeuronId.ts), so a larger ceiling would collide.
  assert(Number.isInteger(MAX_NEURON_COUNT));
  assert(MAX_NEURON_COUNT > 0);
  assert(MAX_NEURON_COUNT <= 1_000_000);
});

Deno.test("fromJSON - a valid creature still round-trips", () => {
  const original = new Creature(3, 2, { layers: [{ count: 2 }] });
  const exported = original.exportJSON();

  const loaded = fromJSON(exported, false, Creature);

  assertEquals(loaded.input, 3);
  assertEquals(loaded.output, 2);
  assertEquals(loaded.neurons.length, original.neurons.length);
  assertEquals(loaded.synapses.length, original.synapses.length);
});
