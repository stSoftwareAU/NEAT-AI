import { assert, assertAlmostEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { MINIMUM } from "../../../src/methods/activations/aggregate/MINIMUM.ts";
import { Cosine } from "../../../src/methods/activations/types/Cosine.ts";
import { Exponential } from "../../../src/methods/activations/types/Exponential.ts";
import { GAUSSIAN } from "../../../src/methods/activations/types/GAUSSIAN.ts";
import { GELU } from "../../../src/methods/activations/types/GELU.ts";
import { LogSigmoid } from "../../../src/methods/activations/types/LogSigmoid.ts";
import { RELU } from "../../../src/methods/activations/types/RELU.ts";
import { makeCreatureActivationFunction } from "../../../src/optimize/MakeCreatureActivationFunction.ts";
import { simplify } from "../../../src/optimize/Simplify.ts";
import { makeData } from "./ABSOLUTE.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Constant", () => {
  const directory = ".test/optimize/simplify/Constant";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      {
        bias: 1,
        type: "constant",
        uuid: "constant-0",
      },
      {
        bias: 1,
        type: "constant",
        uuid: "constant-1",
      },
      {
        bias: 1,
        type: "constant",
        uuid: "constant-2",
      },
      {
        bias: -Math.LN10,
        type: "output",
        squash: Cosine.NAME,
        uuid: "output-0",
      },
      {
        bias: 10,
        type: "output",
        squash: LogSigmoid.NAME,
        uuid: "output-1",
      },
      {
        bias: -10,
        type: "output",
        squash: RELU.NAME,
        uuid: "output-2",
      },
      {
        bias: Math.PI,
        type: "output",
        squash: Exponential.NAME,
        uuid: "output-3",
      },
      {
        bias: -Math.PI,
        type: "output",
        squash: GAUSSIAN.NAME,
        uuid: "output-4",
      },
      {
        bias: 2 * Math.PI,
        type: "output",
        squash: GELU.NAME,
        uuid: "output-5",
      },
      {
        bias: -2 * Math.PI,
        type: "output",
        squash: MINIMUM.NAME,
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
        weight: 0.02617,
        fromUUID: "constant-0",
        toUUID: "output-0",
      },
      {
        weight: -0.2922,
        fromUUID: "constant-2",
        toUUID: "output-0",
      },

      {
        weight: 0.0192,
        fromUUID: "constant-1",
        toUUID: "output-0",
      },
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "output-1",
      },
      {
        weight: 0.261,
        fromUUID: "constant-1",
        toUUID: "output-2",
      },
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "output-2",
      },
      {
        weight: -0.452,
        fromUUID: "constant-2",
        toUUID: "output-3",
      },
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "output-3",
      },
      {
        weight: -0.123,
        fromUUID: "constant-1",
        toUUID: "output-4",
      },
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "output-4",
      },
      {
        weight: 0.12,
        fromUUID: "constant-2",
        toUUID: "output-5",
      },
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "output-5",
      },
      {
        weight: Math.PI,
        fromUUID: "constant-0",
        toUUID: "output-6",
      },
      {
        weight: -Math.SQRT1_2,
        fromUUID: "constant-1",
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
  assertNotEquals(
    complex.uuid ?? "COMPLEX",
    simplifiedCreature.uuid ?? "SIMPLIED",
  );
  for (let p = 0; p < 12; p++) {
    const data = makeData(p, complex.input);

    const complexActuals = complex.activate(data, false);
    const simplifiedActuals = simplifiedCreature.activate(data, false);

    assert(complexActuals.length === simplifiedActuals.length);
    for (let i = 0; i < complexActuals.length; i++) {
      assertAlmostEquals(
        complexActuals[i],
        simplifiedActuals[i],
        0.000_000_1,
        `${p}) expected: ${complexActuals[i]} actual: ${simplifiedActuals[i]}`,
      );
    }
  }
});
