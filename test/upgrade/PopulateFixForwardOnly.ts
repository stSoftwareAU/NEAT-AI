import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Synapse } from "@architecture/Synapse.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";

/**
 * Issue #2302: `Neat.populatePopulation()` calls `fix()` without
 * `{ forwardOnly: true }`, so self-connections on unmutated clones of
 * forward-only creatures survive into the population. This test verifies
 * that calling `fix()` with the creature's own `forwardOnly` flag properly
 * removes self-connections.
 */
Deno.test(
  "fix() with forwardOnly removes self-connections for forward-only creatures",
  () => {
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
    creature.semanticVersion = "4.0.0";
    creature.forwardOnly = true;
    creatureValidate(creature, { forwardOnly: true });

    // Inject a self-connection (simulating legacy corruption).
    const hiddenIndex = creature.input;
    creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.05));
    creature.synapses.sort(
      (a, b) => (a.from === b.from ? a.to - b.to : a.from - b.from),
    );

    // Clone and call fix() WITH forwardOnly — self-connection must be removed.
    const clone = creature.shallowClone();
    clone.fix({ forwardOnly: true });

    const selfConns = clone.synapses.filter((s) => s.from === s.to);
    assertEquals(
      selfConns.length,
      0,
      "fix({ forwardOnly: true }) must remove self-connections",
    );
    creatureValidate(clone, { forwardOnly: true });
  },
);

Deno.test(
  "fix() without forwardOnly does NOT remove self-connections (pre-fix behaviour)",
  () => {
    // Use a plain (non-forwardOnly) creature to avoid the loadFrom strip-path
    // that fires on forwardOnly creatures inside cleanupOrphanedNeuronsInCreature.
    // The behaviour under test is: fix() without options leaves self-connections
    // intact on creatures that are not forward-only.
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
    creature.semanticVersion = "4.0.0";
    creatureValidate(creature);

    // Inject a self-connection.
    const hiddenIndex = creature.input;
    creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.05));
    creature.synapses.sort(
      (a, b) => (a.from === b.from ? a.to - b.to : a.from - b.from),
    );

    // Clone and call fix() WITHOUT forwardOnly — self-connection survives.
    const clone = creature.shallowClone();
    clone.fix();

    const selfConns = clone.synapses.filter((s) => s.from === s.to);
    assertEquals(
      selfConns.length,
      1,
      "fix() without forwardOnly must preserve self-connections",
    );
  },
);

Deno.test(
  "populatePopulation pattern: clone + fix with forwardOnly removes self-connections",
  () => {
    // This test simulates what populatePopulation SHOULD do.
    const creature = new Creature(3, 1, { layers: [{ count: 4 }] });
    creature.semanticVersion = "4.0.0";
    creature.forwardOnly = true;
    creatureValidate(creature, { forwardOnly: true });

    // Inject self-connections.
    const hidden0 = creature.input;
    const hidden2 = creature.input + 2;
    creature.synapses.push(new Synapse(hidden0, hidden0, 0.01));
    creature.synapses.push(new Synapse(hidden2, hidden2, 0.04));
    creature.synapses.sort(
      (a, b) => (a.from === b.from ? a.to - b.to : a.from - b.from),
    );

    // Simulate the populatePopulation pattern: clone + fix.
    const clones: Creature[] = [];
    for (let i = 0; i < 5; i++) {
      const clone = creature.shallowClone();
      // This is the fixed pattern — pass forwardOnly flag from the creature.
      const isForwardOnly = clone.forwardOnly === true;
      if (isForwardOnly) {
        clone.fix({ forwardOnly: true });
      } else {
        clone.fix();
      }
      clones.push(clone);
    }

    // All clones must have self-connections removed.
    for (const clone of clones) {
      const selfConns = clone.synapses.filter((s) => s.from === s.to);
      assertEquals(
        selfConns.length,
        0,
        "Clone must not retain self-connections",
      );
      creatureValidate(clone, { forwardOnly: true });
    }
  },
);
