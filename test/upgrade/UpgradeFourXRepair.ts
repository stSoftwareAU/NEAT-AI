import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { ValidationError } from "../../src/errors/ValidationError.ts";
import { upgrade } from "../../src/upgrade/Upgrade.ts";

Deno.test(
  "upgrade(): prunes stale memetic weight toIds before validating 4.x creature",
  () => {
    const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
    creature.semanticVersion = "4.0.0";
    creature.forwardOnly = true;
    creature.validate({ forwardOnly: true });

    const hidden = creature.neurons[creature.input];
    creature.memetic = {
      generation: 1,
      score: 0,
      biases: {},
      weights: {
        [hidden.id]: [{ toId: 1_998_066_541, weight: 0.1 }],
      },
    };

    const upgraded = upgrade(creature);
    upgraded.validate({ forwardOnly: true });
    assertEquals(upgraded.forwardOnly, true);
    const w = upgraded.memetic?.weights?.[hidden.id];
    assert(
      w === undefined || w.length === 0,
      "orphan memetic weight row should be pruned",
    );
  },
);

/**
 * Issue #2086 follow-up: `upgrade()` on 4.x forward-only must **not** call
 * `fix()` on corrupt genomes (repair destroys fitness and masked GRQ bugs).
 */
Deno.test("upgrade(): throws on corrupted 4.x creature with back connection", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;
  creature.validate({ forwardOnly: true });

  const hiddenIndex = creature.input;
  const laterHiddenIndex = creature.input + 1;
  creature.synapses.push(new Synapse(laterHiddenIndex, hiddenIndex, 0.123));
  creature.synapses.sort((
    a,
    b,
  ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

  const err = assertThrows(
    () => upgrade(creature),
    ValidationError,
  ) as ValidationError;
  assertEquals(err.reason, "RECURSIVE_SYNAPSE");
});

Deno.test("upgrade(): throws on corrupted 4.x creature with self connection", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;
  creature.validate({ forwardOnly: true });

  const hiddenIndex = creature.input;
  creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.5));
  creature.synapses.sort((
    a,
    b,
  ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

  const err = assertThrows(
    () => upgrade(creature),
    ValidationError,
  ) as ValidationError;
  assertEquals(err.reason, "SELF_CONNECTION");
});
