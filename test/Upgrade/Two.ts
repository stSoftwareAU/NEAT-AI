import { assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../mod.ts";
import { HYPOT } from "../../src/methods/activations/aggregate/HYPOT.ts";
import { upgradeTwo } from "../../src/upgrade/UpgradeTwo.ts";

Deno.test("HYPOT", () => {
  const directory = ".test/Upgrade/Two";
  Deno.mkdirSync(directory, { recursive: true });
  const start = new Creature(1000, 10, {
    layers: [
      { count: 10 },
      { count: 3, squash: HYPOT.NAME },
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

  for (let p = 0; p < 12; p++) {
    const data = makeData(p, start.input);

    const expected = start.activate(data, false);
    const actual = upgraded.activate(data, false);

    for (let i = 0; i < expected.length; i++) {
      assertAlmostEquals(
        expected[i],
        actual[i],
        0.000_01,
        `${p}:${i}) expected: ${expected[i]} actual: ${actual[i]}`,
      );
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
