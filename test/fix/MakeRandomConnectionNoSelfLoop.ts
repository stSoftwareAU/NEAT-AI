import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";

/**
 * Regression coverage: `makeRandomConnection()` is used by `Creature.fix()` to
 * repair missing inbound connectivity.
 *
 * Even when recurrent connections are broadly allowed, a self-loop does not
 * repair a disconnected neuron (it doesn't introduce any upstream signal), so
 * it is never a sensible "fix" connection to create.
 *
 * This test stubs `Math.random()` to make the historical bug deterministic:
 * previously, a high random value could force `from === to`.
 */
Deno.test("Creature.makeRandomConnection: never creates self-loops", () => {
  const originalRandom = Math.random;
  try {
    // Deterministic: forces selection of the highest possible index.
    Math.random = () => 0.999999;

    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    const hiddenIndex = creature.input;

    // Remove all synapses so `makeRandomConnection()` has to create one.
    creature.synapses = [];
    creature.clearCache();

    const synapse = creature.makeRandomConnection(hiddenIndex);
    assert(synapse, "Expected makeRandomConnection() to create a synapse");
    assertEquals(synapse.to, hiddenIndex);
    assert(
      synapse.from !== synapse.to,
      "makeRandomConnection() created a self-loop, which must never happen",
    );
  } finally {
    Math.random = originalRandom;
  }
});
