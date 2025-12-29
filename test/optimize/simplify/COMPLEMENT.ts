import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { COMPLEMENT } from "../../../src/methods/activations/types/COMPLEMENT.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";
import { makeCreatureActivationFunction } from "../../../src/optimize/MakeCreatureActivationFunction.ts";
import { simplify } from "../../../src/optimize/Simplify.ts";
import { makeData } from "./ABSOLUTE.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("COMPLEMENT -> IDENTITY", () => {
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
    n.uuid === "output-0"
  );
  assert(outputNeuron);
  assertEquals(outputNeuron.squash, IDENTITY.NAME);
  assertAlmostEquals(outputNeuron.bias, 0.75, 0.000_000_1);

  const weightsByFrom = new Map(
    simplifiedExport.synapses
      .filter((s) => s.toUUID === "output-0")
      .map((s) => [s.fromUUID, s.weight] as const),
  );
  assertAlmostEquals(weightsByFrom.get("input-0") ?? NaN, -0.5, 0.000_000_1);
  assertAlmostEquals(weightsByFrom.get("input-1") ?? NaN, 2, 0.000_000_1);
  assertAlmostEquals(weightsByFrom.get("input-2") ?? NaN, -1.25, 0.000_000_1);

  const { inlineText, squashList } = makeCreatureActivationFunction(
    simplifiedCreature,
  );
  Deno.writeTextFileSync(
    `${directory}/inline-simplified.js`,
    `export function example(${squashList.join(",")}){\n${inlineText}}`,
  );

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
