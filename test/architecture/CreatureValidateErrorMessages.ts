/**
 * Issue #1365: Tests for CreatureValidate error message formatting.
 *
 * Verifies that validation error messages for output UUID mismatches,
 * neuron ordering issues, and input neuron positioning produce clean,
 * readable messages without leftover string concatenation fragments
 * (e.g. ' + "' from a broken template literal migration).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

Deno.test("creatureValidate - output UUID mismatch produces clean message", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });

  // Corrupt the output neuron UUID to trigger the invalid output UUID error
  const outputNeuron = creature.neurons[creature.neurons.length - 1];
  outputNeuron.uuid = "wrong-uuid";

  let caught: Error | undefined;
  try {
    creatureValidate(creature);
  } catch (e) {
    caught = e as Error;
  }

  if (!caught) {
    throw new Error("Expected a ValidationError to be thrown");
  }

  // Must NOT contain leftover concatenation fragments
  assertEquals(
    caught.message.includes(' + "'),
    false,
    `Message should not contain ' + "': ${caught.message}`,
  );

  // The message should follow the format: "${uuid}) invalid output UUID: ${uuid}"
  assertStringIncludes(caught.message, "wrong-uuid) invalid output UUID:");
});

Deno.test("creatureValidate - non-output after output produces clean message", () => {
  // Build a creature JSON with a hidden neuron placed after an output neuron
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", bias: 0, squash: "IDENTITY" },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      // This hidden neuron after the output triggers the ordering error
      { type: "hidden", uuid: "after-output", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "after-output", weight: 0.5 },
      { fromUUID: "after-output", toUUID: "output-0", weight: 0.3 },
    ],
  };

  const creature = Creature.fromJSON(json);

  let caught: Error | undefined;
  try {
    creatureValidate(creature);
  } catch (e) {
    caught = e as Error;
  }

  if (!caught) {
    throw new Error("Expected a ValidationError to be thrown");
  }

  // Must NOT contain leftover concatenation fragments
  assertEquals(
    caught.message.includes(' + "'),
    false,
    `Message should not contain ' + "': ${caught.message}`,
  );

  // The message should follow the format: "${uuid}) type ${type} after output neuron"
  assertStringIncludes(caught.message, ") type hidden after output neuron");
});

Deno.test("creatureValidate - input after max inputs produces clean message", () => {
  // Create a creature then corrupt a later neuron to type "input"
  // to trigger the "input neuron after the maximum input neurons" error
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });

  // The hidden neuron at index creature.input is after the input range.
  // Setting its type to "input" should trigger the ordering error.
  const hiddenIndex = creature.input + 1;
  const neuron = creature.neurons[hiddenIndex];
  neuron.type = "input";

  let caught: Error | undefined;
  try {
    creatureValidate(creature);
  } catch (e) {
    caught = e as Error;
  }

  if (!caught) {
    throw new Error("Expected a ValidationError to be thrown");
  }

  // Must NOT contain leftover concatenation fragments
  assertEquals(
    caught.message.includes(' + "'),
    false,
    `Message should not contain ' + "': ${caught.message}`,
  );

  // The message should follow the format: "${uuid}) input neuron after the maximum input neurons"
  assertStringIncludes(
    caught.message,
    ") input neuron after the maximum input neurons",
  );
});
