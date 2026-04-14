import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import { Synapse } from "@architecture/Synapse.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { Offspring } from "@architecture/Offspring.ts";

/**
 * Issue #2302: When a parent creature has a self-connection synapse injected
 * (from legacy data or a code bug), breeding must:
 *   1. Not crash — `prepareCreatureForBreeding` repairs self-connections.
 *   2. Produce offspring without self-connections.
 *
 * The error in production was:
 *   `ValidationError: Self connection synapse UUID -> UUID`
 * thrown from `prepareCreatureForBreeding` → `validateFourX` inside
 * `Offspring.breed`.
 */
Deno.test(
  "Offspring.breed succeeds when parent has self-connection (issue #2302)",
  () => {
    // Build two valid forward-only creatures with matching topology.
    const mum = new Creature(2, 1, { layers: [{ count: 3 }] });
    mum.semanticVersion = "4.0.0";
    mum.forwardOnly = true;
    creatureValidate(mum, { forwardOnly: true });

    const dad = new Creature(2, 1, { layers: [{ count: 3 }] });
    dad.semanticVersion = "4.0.0";
    dad.forwardOnly = true;
    creatureValidate(dad, { forwardOnly: true });

    // Inject a self-connection into the mother (simulating legacy corruption).
    const hiddenIndex = mum.input;
    mum.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.05));
    mum.synapses.sort(
      (a, b) => (a.from === b.from ? a.to - b.to : a.from - b.from),
    );

    // Breeding must not crash despite the corrupt parent.
    // Try multiple times since randomness can cause `undefined` results.
    let child: Creature | undefined;
    for (let attempt = 0; attempt < 20 && !child; attempt++) {
      child = Offspring.breed(mum, dad, { forwardOnly: true });
    }

    // If we got an offspring, verify no self-connections.
    if (child) {
      const selfConns = child.synapses.filter((s) => s.from === s.to);
      assertEquals(
        selfConns.length,
        0,
        "Offspring must not inherit self-connections",
      );
      creatureValidate(child, { forwardOnly: true });
    }
    // Not getting an offspring is acceptable (clones/topology mismatch),
    // but crashing is not.
  },
);

Deno.test(
  "Offspring.breed succeeds when both parents have self-connections",
  () => {
    // Build two valid forward-only creatures.
    const mum = new Creature(3, 1, { layers: [{ count: 3 }] });
    mum.semanticVersion = "4.0.0";
    mum.forwardOnly = true;
    creatureValidate(mum, { forwardOnly: true });

    const dad = new Creature(3, 1, { layers: [{ count: 3 }] });
    dad.semanticVersion = "4.0.0";
    dad.forwardOnly = true;
    creatureValidate(dad, { forwardOnly: true });

    // Inject self-connections into both parents.
    const mumHidden = mum.input + 1;
    mum.synapses.push(new Synapse(mumHidden, mumHidden, 0.03));
    mum.synapses.sort(
      (a, b) => (a.from === b.from ? a.to - b.to : a.from - b.from),
    );

    const dadHidden = dad.input + 2;
    dad.synapses.push(new Synapse(dadHidden, dadHidden, -0.02));
    dad.synapses.sort(
      (a, b) => (a.from === b.from ? a.to - b.to : a.from - b.from),
    );

    // Must not crash.
    let child: Creature | undefined;
    for (let attempt = 0; attempt < 20 && !child; attempt++) {
      child = Offspring.breed(mum, dad, { forwardOnly: true });
    }

    if (child) {
      const selfConns = child.synapses.filter((s) => s.from === s.to);
      assertEquals(
        selfConns.length,
        0,
        "Offspring must not inherit self-connections from either parent",
      );
      creatureValidate(child, { forwardOnly: true });
    }
  },
);

Deno.test(
  "prepareCreatureForBreeding repairs self-connection on large creature",
  () => {
    // Simulate a large creature with many synapses (similar to the production
    // error with synapse index 14477).
    const creature = new Creature(5, 2, { layers: [{ count: 10 }] });
    creature.semanticVersion = "4.0.0";
    creature.forwardOnly = true;
    creatureValidate(creature, { forwardOnly: true });

    // Inject multiple self-connections on different hidden neurons.
    const hidden0 = creature.input;
    const hidden5 = creature.input + 5;
    const hidden9 = creature.input + 9;
    creature.synapses.push(new Synapse(hidden0, hidden0, 0.01));
    creature.synapses.push(new Synapse(hidden5, hidden5, -0.07));
    creature.synapses.push(new Synapse(hidden9, hidden9, 0.03));
    creature.synapses.sort(
      (a, b) => (a.from === b.from ? a.to - b.to : a.from - b.from),
    );

    // Use the creature as a parent in breeding.
    const partner = new Creature(5, 2, { layers: [{ count: 10 }] });
    partner.semanticVersion = "4.0.0";
    partner.forwardOnly = true;
    creatureValidate(partner, { forwardOnly: true });

    let child: Creature | undefined;
    for (let attempt = 0; attempt < 30 && !child; attempt++) {
      child = Offspring.breed(creature, partner, { forwardOnly: true });
    }

    if (child) {
      const selfConns = child.synapses.filter((s) => s.from === s.to);
      assertEquals(selfConns.length, 0, "No self-connections in offspring");
      creatureValidate(child, { forwardOnly: true });
      assertNotEquals(child.uuid, creature.uuid);
    }
  },
);
