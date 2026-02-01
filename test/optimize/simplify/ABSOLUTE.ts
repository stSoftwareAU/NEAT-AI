import { assert, assertAlmostEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../../mod.ts";
import { ABSOLUTE } from "../../../src/methods/activations/types/ABSOLUTE.ts";
import { Exponential } from "../../../src/methods/activations/types/Exponential.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";
import { ReLU } from "../../../src/methods/activations/types/ReLU.ts";
import { STEP } from "../../../src/methods/activations/types/STEP.ts";
import { simplify } from "../../../src/optimize/Simplify.ts";
import { ReLU6 } from "../../../src/methods/activations/types/ReLU6.ts";

Deno.test("ABSOLUTE", () => {
  const directory = ".test/optimize/simplify/ABSOLUTE";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      {
        bias: -Math.SQRT1_2,
        type: "hidden",
        squash: ReLU.NAME,
        uuid: "hidden-0",
      },
      {
        bias: -Math.LN10,
        type: "hidden",
        squash: STEP.NAME,
        uuid: "hidden-1",
      },
      {
        bias: -Math.LN10,
        type: "hidden",
        squash: ReLU6.NAME,
        uuid: "hidden-relu6",
      },
      {
        bias: 0.1,
        type: "hidden",
        squash: ABSOLUTE.NAME,
        uuid: "hidden-absolute",
      },
      {
        bias: 0.1,
        type: "hidden",
        squash: Exponential.NAME,
        uuid: "hidden-exponential",
      },
      {
        bias: Math.LN10,
        type: "hidden",
        squash: ABSOLUTE.NAME,
        uuid: "hidden-2",
      },
      {
        bias: Math.SQRT2,
        type: "output",
        squash: IDENTITY.NAME,
        uuid: "output-0",
      },
    ],
    synapses: [
      {
        weight: Math.LOG10E,
        fromUUID: "input-0",
        toUUID: "hidden-0",
      },
      { weight: -1, fromUUID: "input-1", toUUID: "hidden-0" },
      { weight: 1, fromUUID: "input-2", toUUID: "hidden-1" },
      { weight: 1, fromUUID: "input-3", toUUID: "hidden-relu6" },

      { weight: 0.5, fromUUID: "hidden-0", toUUID: "hidden-2" },
      { weight: 0.4, fromUUID: "hidden-1", toUUID: "hidden-2" },
      { weight: 0.3, fromUUID: "hidden-relu6", toUUID: "hidden-2" },
      { weight: 0.2, fromUUID: "hidden-absolute", toUUID: "hidden-2" },
      { weight: 0.2, fromUUID: "hidden-exponential", toUUID: "hidden-2" },
      {
        weight: Math.E,
        fromUUID: "input-3",
        toUUID: "hidden-0",
      },
      {
        weight: -Math.SQRT1_2,
        fromUUID: "input-4",
        toUUID: "hidden-1",
      },
      {
        weight: Math.SQRT1_2,
        fromUUID: "input-4",
        toUUID: "output-0",
      },
      {
        weight: -Math.SQRT2,
        fromUUID: "input-5",
        toUUID: "hidden-0",
      },
      {
        weight: Math.SQRT2,
        fromUUID: "input-5",
        toUUID: "hidden-relu6",
      },
      {
        weight: Math.E,
        fromUUID: "input-4",
        toUUID: "hidden-absolute",
      },
      {
        weight: 0.1,
        fromUUID: "input-3",
        toUUID: "hidden-exponential",
      },
      { weight: Math.PI, fromUUID: "hidden-2", toUUID: "output-0" },
    ],
    input: 6,
    output: 1,
  };
  const complex = Creature.fromJSON(json);
  complex.validate();
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
