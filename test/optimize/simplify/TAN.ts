import { assert, assertAlmostEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { makeCreatureActivationFunction } from "../../../src/optimize/MakeCreatureActivationFunction.ts";
import { simplify } from "../../../src/optimize/Simplify.ts";
import { TAN } from "../../../src/methods/activations/types/TAN.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("TAN", () => {
  const directory = ".test/optimize/simplify/TAN";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      {
        bias: -Math.LN10,
        type: "output",
        squash: TAN.NAME,
        uuid: "output-0",
      },
      {
        bias: 10,
        type: "output",
        squash: TAN.NAME,
        uuid: "output-1",
      },
      {
        bias: -10,
        type: "output",
        squash: TAN.NAME,
        uuid: "output-2",
      },
      {
        bias: Math.PI,
        type: "output",
        squash: TAN.NAME,
        uuid: "output-3",
      },
      {
        bias: -Math.PI,
        type: "output",
        squash: TAN.NAME,
        uuid: "output-4",
      },
      {
        bias: 2 * Math.PI,
        type: "output",
        squash: TAN.NAME,
        uuid: "output-5",
      },
      {
        bias: -2 * Math.PI,
        type: "output",
        squash: TAN.NAME,
        uuid: "output-6",
      },
    ],
    synapses: [
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "output-0",
      },
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "output-1",
      },
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "output-2",
      },
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "output-3",
      },
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "output-4",
      },
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "output-5",
      },
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "output-6",
      },
    ],
    input: 1,
    output: 7,
  };
  const complex = Creature.fromJSON(json);

  const exportCreature = complex.exportJSON();
  Deno.writeTextFileSync(
    `${directory}/complex.json`,
    JSON.stringify(exportCreature, null, 1),
  );
  const simplifiedCreature = simplify(complex);
  assert(simplifiedCreature);
  Deno.writeTextFileSync(
    `${directory}/simplified.json`,
    JSON.stringify(simplifiedCreature.exportJSON(), null, 1),
  );

  const { inlineText, squashList } = makeCreatureActivationFunction(
    simplifiedCreature,
  );

  Deno.writeTextFileSync(
    `${directory}/inline-simplied.js`,
    `export function example(${squashList.join(",")}){\n${inlineText}}`,
  );
  assertNotEquals( complex.uuid??"COMPLEX", simplifiedCreature.uuid??"SIMPLIED");
  for (let p = 0; p < 1000; p++) {
    const data = makeData(p, complex.input);

    const complexActuals = complex.activate(data, false);
    const simplifiedActuals = simplifiedCreature.activate(data, false);

    assert(complexActuals.length === simplifiedActuals.length);
    for (let i = 0; i < complexActuals.length; i++) {
      assertAlmostEquals(
        complexActuals[i],
        simplifiedActuals[i],
        0.000_01,
        `${p}) expected: ${complexActuals[i]} actual: ${simplifiedActuals[i]}`,
      );
    }
  }
});

function makeData(p: number, input: number): Float32Array {
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
