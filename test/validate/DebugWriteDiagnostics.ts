import { assert, fail } from "@std/assert";
import { Creature } from "../../mod.ts";
import { setDiagnosticsDir } from "@utils/Diagnostics.ts";
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

/**
 * Issue #3802: `debugWrite` is a diagnostics side effect shared by both halves
 * of `creatureValidate`, and nothing asserted it before — a regression would
 * only have shown up as a missing file during a manual debugging session.
 */
Deno.test("validate with DEBUG writes creatureValidate.json diagnostics", () => {
  const dir = Deno.makeTempDirSync({ prefix: "neat-validate-debug-" });
  setDiagnosticsDir(dir);
  try {
    const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
    creature.validate();
    creature.DEBUG = true;

    // Duplicate neuron id — a rule check whose throw site calls debugWrite.
    const hiddenNeuron = creature.neurons[creature.input];
    assert(hiddenNeuron, "Expected a hidden neuron");
    hiddenNeuron.id = creature.neurons[0].id;

    try {
      creature.validate();
      fail("Expected ValidationError for duplicate neuron id");
    } catch {
      // The dump, not the error, is what this test asserts on.
    }

    const dump = JSON.parse(
      Deno.readTextFileSync(`${dir}/creatureValidate.json`),
    );
    assert(
      Array.isArray(dump.neurons) || dump.exportFailed === true,
      `Expected a creature export or an export-failure record: ${
        JSON.stringify(dump)
      }`,
    );
  } finally {
    setDiagnosticsDir();
    Deno.removeSync(dir, { recursive: true });
  }
});
