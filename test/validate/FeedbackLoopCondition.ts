import { assert, fail } from "@std/assert";
import { Creature } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";

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

Deno.test("feedbackLoop: false rejects recursive synapses", () => {
  const creature = createCreatureWithRecursiveSynapse();

  try {
    creatureValidate(creature, { feedbackLoop: false });
    fail("Expected RECURSIVE_SYNAPSE error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "RECURSIVE_SYNAPSE",
      `Expected RECURSIVE_SYNAPSE but got: ${error.name}`,
    );
  }
});

Deno.test("feedbackLoop: undefined allows recursive synapses", () => {
  const creature = createCreatureWithRecursiveSynapse();

  // Passing feedbackLoop as undefined should allow recursive synapses
  creatureValidate(creature, { feedbackLoop: undefined });
});

Deno.test("feedbackLoop: true allows recursive synapses", () => {
  const creature = createCreatureWithRecursiveSynapse();

  // Explicitly enabling feedback loops should allow recursive synapses
  creatureValidate(creature, { feedbackLoop: true });
});

Deno.test("feedbackLoop: omitted allows recursive synapses", () => {
  const creature = createCreatureWithRecursiveSynapse();

  // Not specifying feedbackLoop at all should allow recursive synapses
  creatureValidate(creature, {});
});

Deno.test("feedbackLoop: no options allows recursive synapses", () => {
  const creature = createCreatureWithRecursiveSynapse();

  // Calling validate with no options should allow recursive synapses
  creatureValidate(creature);
});
