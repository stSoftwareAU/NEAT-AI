import { assertEquals, fail } from "@std/assert";
import { Creature } from "../../mod.ts";
import { HYPOTv2 } from "../../src/deprecated/HYPOTv2.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { upgradeTwo } from "../../src/upgrade/UpgradeTwo.ts";

Deno.test("HYPOTv2-small", () => {
  const directory = ".test/Upgrade/HYPOT-small";
  Deno.mkdirSync(directory, { recursive: true });
  const start = new Creature(3, 1, {
    layers: [
      { count: 1, squash: HYPOTv2.NAME },
    ],
    semanticVersion: "1.0.0",
    outputLayer: { squash: IDENTITY.NAME },
  });

  Deno.writeTextFileSync(
    `${directory}/init.json`,
    JSON.stringify(start.exportJSON(), null, 1),
  );

  start.validate();

  const upgraded = Creature.fromJSON(upgradeTwo(start.exportJSON()));

  upgraded.validate();

  assertEquals(upgraded.semanticVersion, "2.0.0");
  Deno.writeTextFileSync(
    `${directory}/upgraded.json`,
    JSON.stringify(upgraded.exportJSON(), null, 1),
  );

  upgraded.neurons.forEach((neuron) => {
    if (neuron.squash === HYPOTv2.NAME) {
      fail(`Didn't remove HYPOTv2 ${neuron.uuid}`);
    }
  });

  for (let p = 0; p < 12; p++) {
    const data = makeData(p, start.input);

    const expected = start.activate(data, false, true);
    const actual = upgraded.activate(data, false, true);

    for (let i = 0; i < expected.length; i++) {
      const delta = Math.abs(expected[i] - actual[i]);
      if (delta > 0.015) {
        Deno.writeTextFileSync(
          `${directory}/data.json`,
          JSON.stringify(data, null, 1),
        );
        fail(
          `${p}:${i}) expected: ${expected[i]} actual: ${
            actual[i]
          }, delta: ${delta}`,
        );
      }
    }
  }
});

Deno.test("HYPOTv2", () => {
  const directory = ".test/Upgrade/HYPOTv2";
  Deno.mkdirSync(directory, { recursive: true });
  const start = new Creature(1000, 10, {
    layers: [
      { count: 10 },
      { count: 3, squash: HYPOTv2.NAME },
    ],
    semanticVersion: "1.0.0",
  });

  Deno.writeTextFileSync(
    `${directory}/init.json`,
    JSON.stringify(start.exportJSON(), null, 1),
  );

  start.validate();

  const upgraded = Creature.fromJSON(upgradeTwo(start.exportJSON()));

  upgraded.validate();

  assertEquals(upgraded.semanticVersion, "2.0.0");
  Deno.writeTextFileSync(
    `${directory}/upgraded.json`,
    JSON.stringify(upgraded.exportJSON(), null, 1),
  );

  upgraded.neurons.forEach((neuron) => {
    if (neuron.squash === HYPOTv2.NAME) {
      fail(`Didn't remove HYPOTv2 ${neuron.uuid}`);
    }
  });

  for (let p = 3; p < 12; p++) {
    const data = makeData(p, start.input);

    const expected = start.activate(data, false, true);
    const actual = upgraded.activate(data, false, true);

    for (let i = 0; i < expected.length; i++) {
      const delta = Math.abs(expected[i] - actual[i]);
      if (delta > 0.5) {
        Deno.writeTextFileSync(
          `${directory}/data.json`,
          JSON.stringify(data, null, 1),
        );
        console.warn(
          `${p}:${i}) expected: ${expected[i]} actual: ${
            actual[i]
          }, delta: ${delta}`,
        );
      }
    }
  }
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
