import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";

/**
 * Regression coverage: `Creature.makeRandomConnection()` is used at runtime by
 * some aggregate squashes (eg `IF`) to repair missing wiring. When a creature is
 * marked forward-only, this helper must never create recurrent connections
 * (self-loops or feedback/backward connections).
 */
Deno.test("Forward-only: makeRandomConnection() never creates recurrent connections", () => {
  // Create a small creature with hidden neurons so there are plenty of missing
  // potential connections into a target neuron.
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  creature.forwardOnly = true;

  // Pick a hidden neuron (not input, not constant) as the target.
  const toIndex = creature.input; // First non-input neuron should be hidden.

  // Make sure there is at least one missing eligible connection so the helper
  // has something to create.
  creature.disconnect(0, toIndex);
  creature.disconnect(1, toIndex);

  // Try a few times to ensure we actually add a connection.
  let created = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    const synapse = creature.makeRandomConnection(toIndex);
    if (synapse) {
      created = true;
      assert(
        synapse.from < synapse.to,
        `Expected a strictly feed-forward connection, got ${synapse.from}->${synapse.to}`,
      );
      assert(
        synapse.to === toIndex,
        `Expected connection to target neuron ${toIndex}, got ${synapse.from}->${synapse.to}`,
      );
      break;
    }
  }

  assert(created, "Expected makeRandomConnection() to create a connection");
});
