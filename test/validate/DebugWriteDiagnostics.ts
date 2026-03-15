import { assert, fail } from "@std/assert";
import { Creature } from "../../mod.ts";
import type { ValidationError } from "../../src/errors/ValidationError.ts";

/**
 * Verify that creatureValidate detects duplicate UUIDs and throws
 * a ValidationError with the expected message when DEBUG is enabled.
 */
Deno.test("validate detects duplicate UUID and throws ValidationError", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
  creature.DEBUG = true;

  // Force a duplicate UUID to trigger the validation error
  const hiddenNeuron = creature.neurons[creature.input + 1];
  assert(hiddenNeuron, "Expected a hidden neuron");
  hiddenNeuron.uuid = creature.neurons[0].uuid; // duplicate

  try {
    creature.validate();
    fail("Expected ValidationError for duplicate UUID");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.message.includes("duplicate UUID"),
      `Unexpected message: ${error.message}`,
    );
  }
});
