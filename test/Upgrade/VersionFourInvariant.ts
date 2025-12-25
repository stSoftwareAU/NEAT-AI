import { assertThrows } from "@std/assert";
import { Creature } from "../../mod.ts";
import { upgrade } from "../../src/upgrade/Upgrade.ts";

/**
 * Regression coverage for https://github.com/stSoftwareAU/NEAT-AI/issues/956
 *
 * A 4.x creature is a hard invariant: if it becomes invalid (recurrent connections),
 * that's a bug in our breeding/mutation/discovery logic. We do NOT silently repair -
 * we throw so the bug can be identified and fixed at the source.
 *
 * This catches corrupted exports where `semanticVersion` is 4.x but the creature
 * still contains recurrent connections (self-loops / feedback connections).
 */
Deno.test(
  "upgrade throws for 4.x creatures with recurrent connections",
  () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 2 }],
      semanticVersion: "4.0.0",
    });
    // Intentionally leave `forwardOnly` undefined to simulate a corrupted export.

    const hiddenNeuron = creature.neurons[creature.input]; // First hidden neuron
    creature.connect(hiddenNeuron.index, hiddenNeuron.index, 0.5); // self-loop (recurrent)

    // Act/Assert: upgrading a corrupted 4.x creature should throw.
    assertThrows(
      () => upgrade(creature),
      Error,
      "Self connection synapse",
    );
  },
);
