import { assertEquals, fail } from "@std/assert";
import { Creature } from "../../mod.ts";
import { HYPOT } from "../../src/deprecated/HYPOT.ts";
import { upgradeTwo } from "../../src/upgrade/UpgradeTwo.ts";

Deno.test("HYPOT upgrade removes deprecated squash and produces valid creature", () => {
  const start = new Creature(1000, 10, {
    layers: [
      { count: 10 },
      { count: 3, squash: HYPOT.NAME },
    ],
    semanticVersion: "1.0.0",
  });

  start.validate();

  const upgraded = Creature.fromJSON(upgradeTwo(start.exportJSON()));

  upgraded.validate();

  assertEquals(upgraded.semanticVersion, "2.0.0");

  upgraded.neurons.forEach((neuron) => {
    if (neuron.squash === HYPOT.NAME) {
      fail(`Didn't remove HYPOT ${neuron.uuid}`);
    }
  });
});
