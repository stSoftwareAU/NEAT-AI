/**
 * Issue #4077: `loadFrom` must refuse a creature JSON whose neurons repeat a
 * uuid. Before the fix the later neuron silently overwrote the earlier entry in
 * `uuidToIndex`, so every synapse naming that uuid resolved onto the later
 * neuron. The refusal is a `ValidationError` (reason `OTHER`) naming the
 * duplicate uuid and both positions, and it runs whether or not validation is
 * requested.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Two constants, each feeding the output. Positions: input-0 is 0, constant-a
 * is 1, constant-b is 2, output-0 is 3.
 */
function twoConstantsExport(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 1,
    output: 1,
    neurons: [
      { type: "constant", uuid: "constant-a", bias: 1 },
      { type: "constant", uuid: "constant-b", bias: 1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "constant-a", toUUID: "output-0", weight: 0.25 },
      { fromUUID: "constant-b", toUUID: "output-0", weight: 0.25 },
    ],
  };
}

Deno.test("Issue #4077: positive control - distinct constant uuids load", async () => {
  await initWasmForTests();

  const restored = Creature.fromJSON(twoConstantsExport());

  assertEquals(restored.neurons.length, 4);
});

Deno.test("Issue #4077: two constants sharing a uuid are refused with a ValidationError", async () => {
  await initWasmForTests();

  // Only the uuid changes: the second constant's synapse follows its new uuid,
  // so the duplicate is the sole fault in the JSON.
  const json = twoConstantsExport();
  json.neurons[1] = { type: "constant", uuid: "constant-a", bias: 1 };
  json.synapses[2] = {
    fromUUID: "constant-a",
    toUUID: "output-0",
    weight: 0.25,
  };

  const error = assertThrows(
    () => Creature.fromJSON(json),
    ValidationError,
  );

  assertEquals(error.reason, "OTHER");
  assertEquals(
    error.message,
    "Duplicate neuron uuid constant-a: neuron at position 2 repeats the uuid already held by position 1",
  );
  assertEquals(error.neuronIndex, 2);
});

Deno.test("Issue #4077: hidden neuron claiming input-0 is refused with a ValidationError", async () => {
  await initWasmForTests();

  const json: CreatureExport = {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "input-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };

  const error = assertThrows(
    () => Creature.fromJSON(json),
    ValidationError,
  );

  assertEquals(error.reason, "OTHER");
  assertEquals(
    error.message,
    "Duplicate neuron uuid input-0: neuron at position 1 repeats the uuid already held by position 0",
  );
});
