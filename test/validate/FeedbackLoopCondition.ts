import { Creature } from "../../mod.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { Synapse } from "@architecture/Synapse.ts";

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
