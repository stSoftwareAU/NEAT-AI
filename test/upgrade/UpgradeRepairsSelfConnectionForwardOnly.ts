import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Synapse } from "@architecture/Synapse.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { prepareCreatureForBreeding, upgrade } from "@upgrade/Upgrade.ts";

/**
 * Issue #2139: Old v1.x/v2.x creatures can contain self-connection synapses
 * (neuron connects to itself). When these creatures are loaded and prepared for
 * breeding as forward-only, `validateFourX()` must repair them by removing the
 * self-connections — not crash the entire process.
 *
 * The GRQ-18 log shows this exact scenario: v1.0.0 and v2.0.0 creatures with
 * self-connections cause an uncaught ValidationError in
 * `prepareCreatureForBreeding()` → `validateFourX()`, killing the worker.
 */

Deno.test("validateFourX repairs self-connection synapses in forward-only creatures", () => {
  // Build a valid forward-only creature with 2 hidden neurons.
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;
  creature.validate({ forwardOnly: true });

  const hiddenIndex = creature.input;
  // Inject a self-connection (the corruption seen in GRQ-18 logs).
  creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.05));
  creature.synapses.sort((
    a,
    b,
  ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

  // prepareCreatureForBreeding must repair, not crash.
  const prepared = prepareCreatureForBreeding(creature);

  // Self-connection must be gone.
  const selfConns = prepared.synapses.filter((s) => s.from === s.to);
  assertEquals(selfConns.length, 0, "self-connections must be removed");

  // Must still be valid forward-only.
  creatureValidate(prepared, { forwardOnly: true });
  assertEquals(prepared.forwardOnly, true);
});

Deno.test("upgrade() repairs self-connection in pre-4.x creature loaded as forward-only", () => {
  // Build a valid forward-only creature, then downgrade to simulate old format.
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;
  creature.validate({ forwardOnly: true });

  const hiddenIndex = creature.input;

  // Inject a self-connection.
  creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.02));
  creature.synapses.sort((
    a,
    b,
  ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

  // upgrade() via validateFourX() must repair self-connections.
  const upgraded = upgrade(creature);

  // Self-connection must be gone.
  const selfConns = upgraded.synapses.filter((s) => s.from === s.to);
  assertEquals(selfConns.length, 0, "self-connections must be removed");

  // Must be valid forward-only.
  creatureValidate(upgraded, { forwardOnly: true });
  assertEquals(upgraded.forwardOnly, true);
});

Deno.test("prepareCreatureForBreeding repairs multiple self-connections", () => {
  // Build a creature with multiple hidden neurons.
  const creature = new Creature(3, 1, { layers: [{ count: 3 }] });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;
  creature.validate({ forwardOnly: true });

  const hidden0 = creature.input;
  const hidden2 = creature.input + 2;

  // Inject self-connections on two different hidden neurons.
  creature.synapses.push(new Synapse(hidden0, hidden0, 0.003));
  creature.synapses.push(new Synapse(hidden2, hidden2, 0.055));
  creature.synapses.sort((
    a,
    b,
  ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

  // Must not crash.
  const prepared = prepareCreatureForBreeding(creature);

  // All self-connections must be removed.
  const selfConns = prepared.synapses.filter((s) => s.from === s.to);
  assertEquals(selfConns.length, 0, "all self-connections must be removed");

  // Must be valid forward-only.
  creatureValidate(prepared, { forwardOnly: true });
  assertEquals(prepared.forwardOnly, true);
});
