import { assertEquals } from "@std/assert";
import { Creature } from "../../mod.ts";
import { upgrade } from "../../src/upgrade/Upgrade.ts";

/**
 * Regression coverage: semanticVersion 4.x implies a forward-only (feed-forward)
 * topology, regardless of whether the `forwardOnly` flag is present.
 *
 * This catches corrupted exports where `semanticVersion` is 4.x but the creature
 * still contains recurrent connections (self-loops / feedback connections).
 */
Deno.test(
  "upgrade repairs 4.x creatures with recurrent connections even when forwardOnly is unset",
  () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 2 }],
      semanticVersion: "4.0.0",
    });
    // Intentionally leave `forwardOnly` undefined to simulate a corrupted export.

    const hiddenNeuron = creature.neurons[creature.input]; // First hidden neuron
    creature.connect(hiddenNeuron.index, hiddenNeuron.index, 0.5); // self-loop (recurrent)

    const upgraded = upgrade(creature);
    assertEquals(upgraded.semanticVersion, "4.0.0");
    upgraded.validate({ forwardOnly: true });
    assertEquals(
      upgraded.getSynapse(hiddenNeuron.index, hiddenNeuron.index),
      null,
      "upgrade() should remove self loops when semanticVersion is 4.x",
    );
  },
);
