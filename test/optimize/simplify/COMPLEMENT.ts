import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { COMPLEMENT } from "../../../src/methods/activations/types/COMPLEMENT.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";
import { simplify } from "../../../src/optimize/Simplify.ts";
import { makeData } from "./ABSOLUTE.ts";

Deno.test("simplify - COMPLEMENT neuron produces behaviour-equivalent IDENTITY with negated weights", () => {
  const directory = ".test/optimize/simplify/COMPLEMENT";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      {
        bias: 0.25,
        type: "output",
        squash: COMPLEMENT.NAME,
        uuid: "output-0",
      },
    ],
    synapses: [
      { weight: 0.5, fromUUID: "input-0", toUUID: "output-0" },
      { weight: -2, fromUUID: "input-1", toUUID: "output-0" },
      { weight: 1.25, fromUUID: "input-2", toUUID: "output-0" },
    ],
    input: 3,
    output: 1,
  };

  const complex = Creature.fromJSON(json);

  Deno.writeTextFileSync(
    `${directory}/complex.json`,
    JSON.stringify(complex.exportJSON(), null, 1),
  );

  const simplifiedCreature = simplify(complex);
  assert(simplifiedCreature);

  const simplifiedExport = simplifiedCreature.exportJSON();
  Deno.writeTextFileSync(
    `${directory}/simplified.json`,
    JSON.stringify(simplifiedExport, null, 1),
  );

  const outputNeuron = simplifiedExport.neurons.find((n) =>
    n.id === -1
  );
  assert(outputNeuron);
  assertEquals(outputNeuron.squash, IDENTITY.NAME);
  assertAlmostEquals(outputNeuron.bias, 0.75, 0.000_000_1);

  const weightsByFrom = new Map(
    simplifiedExport.synapses
      .filter((s) => s.toId === -1)
      .map((s) => [s.fromId, s.weight] as const),
  );
  assertAlmostEquals(weightsByFrom.get(0) ?? NaN, -0.5, 0.000_000_1);
  assertAlmostEquals(weightsByFrom.get(1) ?? NaN, 2, 0.000_000_1);
  assertAlmostEquals(weightsByFrom.get(2) ?? NaN, -1.25, 0.000_000_1);

  for (let p = 0; p < 12; p++) {
    const data = makeData(p, complex.input);

    const actual1 = complex.activate(data, false)[0];
    const actual2 = simplifiedCreature.activate(data, false)[0];

    assertAlmostEquals(
      actual1,
      actual2,
      0.000_01,
      `${p}) expected: ${actual1} actual: ${actual2}`,
    );
  }
});
