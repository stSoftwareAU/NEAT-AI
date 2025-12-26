import { assertEquals } from "@std/assert";
import { Creature } from "../../mod.ts";
import { upgrade } from "../../src/upgrade/Upgrade.ts";

/**
 * Regression coverage for https://github.com/stSoftwareAU/NEAT-AI/issues/956
 *
 * A 4.x creature with recurrent connections should be repaired automatically.
 * This allows production workflows to continue whilst logging a warning for
 * investigation. The recurrent connections are removed during repair.
 *
 * This handles corrupted exports where `semanticVersion` is 4.x but the creature
 * still contains recurrent connections (self-loops / feedback connections).
 */
Deno.test(
  "upgrade repairs 4.x creatures with recurrent connections",
  () => {
    const creature = new Creature(2, 1, {
      layers: [{ count: 2 }],
      semanticVersion: "4.0.0",
    });
    // Intentionally leave `forwardOnly` undefined to simulate a corrupted export.

    const hiddenNeuron = creature.neurons[creature.input]; // First hidden neuron
    creature.connect(hiddenNeuron.index, hiddenNeuron.index, 0.5); // self-loop (recurrent)

    // Act: upgrading a corrupted 4.x creature should repair it.
    const upgraded = upgrade(creature);

    // Assert: creature should now be valid and still 4.x.
    upgraded.validate({ forwardOnly: true });
    assertEquals(upgraded.forwardOnly, true);
    const major = parseInt(upgraded.semanticVersion?.split(".")[0] ?? "0", 10);
    assertEquals(major, 4);

    // The self connection should have been removed.
    const hasSelfConnection = upgraded.synapses.some((s) => s.from === s.to);
    assertEquals(
      hasSelfConnection,
      false,
      "Self connections should be removed",
    );
  },
);
