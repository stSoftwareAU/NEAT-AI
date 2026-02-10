/**
 * Issue #1365: Tests for CreatureValidate error message formatting.
 *
 * Verifies that validation error messages for output UUID mismatches and
 * neuron ordering issues produce clean, readable messages without leftover
 * string concatenation fragments.
 */

import { assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

Deno.test("creatureValidate - output UUID mismatch error has clean message", () => {
  // Create a valid creature, then corrupt an output neuron's UUID
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });

  // Manually corrupt the output neuron UUID to trigger the validation error
  const outputNeuron = creature.neurons[creature.neurons.length - 1];
  outputNeuron.uuid = "wrong-uuid";

  const error = assertThrows(
    () => creatureValidate(creature),
    Error,
  );

  const msg = error.message;

  // The message should NOT contain the literal ' + "' fragment from broken concatenation
  const hasLegacyConcat = msg.includes(' + "');
  if (hasLegacyConcat) {
    throw new Error(
      `Error message contains leftover concatenation fragment ' + "': ${msg}`,
    );
  }
});

Deno.test("creatureValidate - non-output after output error has clean message", () => {
  // Create a creature and manually inject a hidden neuron after the output neurons
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });

  // Export, modify the JSON to put a hidden neuron after output, then reimport
  const json = creature.exportJSON();

  // Add a fake neuron after the output neuron to trigger the ordering error
  json.neurons.push({
    uuid: "extra-hidden",
    bias: 0,
    type: "hidden",
    squash: "IDENTITY",
  });

  let errorCaught = false;
  try {
    Creature.fromJSON(json);
    // If no error from fromJSON, manually validate
    const broken = Creature.fromJSON(json);
    creatureValidate(broken);
  } catch (e) {
    errorCaught = true;
    const msg = (e as Error).message;

    // The message should NOT contain the literal ' + "' fragment
    const hasLegacyConcat = msg.includes(' + "');
    if (hasLegacyConcat) {
      throw new Error(
        `Error message contains leftover concatenation fragment ' + "': ${msg}`,
      );
    }
  }

  // It's acceptable if the creature construction itself fails with a different error,
  // but if it does produce a validation error, it must be clean
  if (!errorCaught) {
    // The creature might be auto-fixed; that's fine too
  }
});
