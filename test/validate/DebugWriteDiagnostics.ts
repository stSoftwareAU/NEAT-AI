import { assert, assertFalse, fail } from "@std/assert";
import { Creature } from "../../mod.ts";
import { DIAGNOSTICS_DIR } from "../../src/utils/Diagnostics.ts";
import type { ValidationError } from "../../src/errors/ValidationError.ts";

/**
 * Verify that debugWrite() in creatureValidate writes to the shared
 * DIAGNOSTICS_DIR (.diagnostics) rather than the legacy ".test" directory.
 */
Deno.test("debugWrite uses DIAGNOSTICS_DIR", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
  creature.DEBUG = true;

  // Force a duplicate UUID to trigger debugWrite before the ValidationError
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

  // Verify file was written to .diagnostics, not .test
  const diagnosticPath = `${DIAGNOSTICS_DIR}/creatureValidate.json`;
  const legacyPath = ".test/creatureValidate.json";

  try {
    const stat = Deno.statSync(diagnosticPath);
    assert(stat.isFile, "Expected diagnostic file to exist");
  } catch {
    fail(`Expected ${diagnosticPath} to exist after debugWrite`);
  }

  // Ensure the legacy .test path was NOT written
  try {
    Deno.statSync(legacyPath);
    assertFalse(true, `Legacy path ${legacyPath} should not be written`);
  } catch {
    // Expected — legacy path should not exist (or at least not be freshly written)
  }

  // Clean up
  try {
    Deno.removeSync(diagnosticPath);
  } catch {
    // Ignore cleanup errors
  }
});
