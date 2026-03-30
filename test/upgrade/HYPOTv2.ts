import { assertEquals, fail } from "@std/assert";
import { Creature } from "../../mod.ts";
import { HYPOTv2 } from "../../src/deprecated/HYPOTv2.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { upgradeTwo } from "../../src/upgrade/UpgradeTwo.ts";

Deno.test("HYPOTv2-small upgrade preserves activation within tolerance", () => {
  const start = new Creature(3, 1, {
    layers: [
      { count: 1, squash: HYPOTv2.NAME },
    ],
    semanticVersion: "1.0.0",
    outputLayer: { squash: IDENTITY.NAME },
  });

  start.validate();

  const upgraded = Creature.fromJSON(upgradeTwo(start.exportJSON()));

  upgraded.validate();

  assertEquals(upgraded.semanticVersion, "2.0.0");

  upgraded.neurons.forEach((neuron) => {
    if (neuron.squash === HYPOTv2.NAME) {
      fail(`Didn't remove HYPOTv2 ${neuron.id}`);
    }
  });

  for (let p = 0; p < 12; p++) {
    const data = makeData(p, start.input);

    const expected = start.activate(data, false);
    const actual = upgraded.activate(data, false);

    for (let i = 0; i < expected.length; i++) {
      const delta = Math.abs(expected[i] - actual[i]);
      if (delta > 0.015) {
        fail(
          `${p}:${i}) expected: ${expected[i]} actual: ${
            actual[i]
          }, delta: ${delta}`,
        );
      }
    }
  }
});

Deno.test("HYPOTv2 upgrade removes deprecated squash and produces valid creature", () => {
  const start = new Creature(1000, 10, {
    layers: [
      { count: 10 },
      { count: 3, squash: HYPOTv2.NAME },
    ],
    semanticVersion: "1.0.0",
  });

  start.validate();

  const upgraded = Creature.fromJSON(upgradeTwo(start.exportJSON()));

  upgraded.validate();

  assertEquals(upgraded.semanticVersion, "2.0.0");

  upgraded.neurons.forEach((neuron) => {
    if (neuron.squash === HYPOTv2.NAME) {
      fail(`Didn't remove HYPOTv2 ${neuron.id}`);
    }
  });
});

export function makeData(p: number, input: number): Float32Array {
  const data = new Float32Array(input);
  switch (p) {
    case 0:
      for (let i = 0; i < input; i++) {
        data[i] = 0;
      }
      return data;
    case 1:
      for (let i = 0; i < input; i++) {
        data[i] = 1;
      }
      return data;
    case 2:
      for (let i = 0; i < input; i++) {
        data[i] = -1;
      }
      return data;
    default:
      for (let i = 0; i < input; i++) {
        data[i] = Math.random() * 4 - 2;
      }
      return data;
  }
}
