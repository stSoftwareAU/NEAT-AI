import { assert, fail } from "@std/assert";
import { Creature } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import type { ValidationError } from "../../src/errors/ValidationError.ts";

/**
 * Creates a creature with a recursive (backward) synapse for testing.
 * The synapse goes from a higher-indexed neuron to a lower-indexed one.
 */
function createCreatureWithRecursiveSynapse(): Creature {
  const creature = new Creature(10, 2, { layers: [{ count: 5 }] });
  creature.synapses.push(new Synapse(12, 11, 0.5));
  creature.synapses.sort((a, b) => {
    if (a.from === b.from) return a.to - b.to;
    return a.from - b.from;
  });
  return creature;
}

Deno.test("feedbackLoop false rejects recursive synapses", () => {
  const creature = createCreatureWithRecursiveSynapse();

  try {
    creatureValidate(creature, { feedbackLoop: false });
    fail("Expected RECURSIVE_SYNAPSE error");
  } catch (e) {
    const error = e as ValidationError;
    assert(
      error.reason === "RECURSIVE_SYNAPSE",
      `Expected RECURSIVE_SYNAPSE but got: ${error.reason}`,
    );
  }
});

Deno.test("recursive synapses allowed by default and when feedbackLoop is true", () => {
  const creature = createCreatureWithRecursiveSynapse();

  // Default (no options) allows recursive synapses
  creatureValidate(creature);

  // Explicitly enabled allows recursive synapses
  creatureValidate(creature, { feedbackLoop: true });

  // Undefined feedbackLoop allows recursive synapses
  creatureValidate(creature, { feedbackLoop: undefined });

  // Empty options allows recursive synapses
  creatureValidate(creature, {});
});
