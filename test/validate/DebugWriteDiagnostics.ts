import { assert, fail } from "@std/assert";
import { Creature } from "../../mod.ts";
import type { ValidationError } from "@errors/ValidationError.ts";

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

  // Force a duplicate neuron id to trigger the validation error
  const hiddenNeuron = creature.neurons[creature.input + 1];
  assert(hiddenNeuron, "Expected a hidden neuron");
  const duplicatedId = creature.neurons[0].id;
  // deno-lint-ignore no-explicit-any
  (hiddenNeuron as any).id = duplicatedId;

  try {
    creature.validate();
    fail("Expected ValidationError for duplicate neuron id");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.message.includes("duplicate neuron id"),
      `Error message should mention 'duplicate neuron id': ${error.message}`,
    );
    assert(
      error.message.length > 10,
      `Error message should include diagnostic detail: ${error.message}`,
    );
  }
});
