import { assert, fail } from "@std/assert";
import { Creature } from "../../mod.ts";
import type { ValidationError } from "../../src/errors/ValidationError.ts";

/**
 * Verify that creatureValidate produces a meaningful error message
 * with diagnostic details when DEBUG is enabled.
 *
 * Note: The duplicate UUID rejection itself is tested in CreatureValidate.ts;
 * this test specifically verifies the DEBUG-mode error message content.
 */
Deno.test("validate with DEBUG includes diagnostic detail in error message", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
  creature.DEBUG = true;

  // Force a duplicate UUID to trigger the validation error
  const hiddenNeuron = creature.neurons[creature.input + 1];
  assert(hiddenNeuron, "Expected a hidden neuron");
  const duplicatedUUID = creature.neurons[0].id;
  hiddenNeuron.id = duplicatedUUID;

  try {
    creature.validate();
    fail("Expected ValidationError for duplicate UUID");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.message.includes("duplicate UUID"),
      `Error message should mention 'duplicate UUID': ${error.message}`,
    );
    assert(
      error.message.length > 10,
      `Error message should include diagnostic detail: ${error.message}`,
    );
  }
});
