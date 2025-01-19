import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";
import { makeCreatureActivationFunction } from "../../../src/optimize/MakeCreatureActivationFunction.ts";
import { simplify } from "../../../src/optimize/Simplify.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";
import { MAXIMUM } from "../../../src/methods/activations/aggregate/MAXIMUM.ts";
import { makeData } from "./ABSOLUTE.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("IDENTITY", () => {
  const directory = ".test/optimize/simplify/IDENTITY";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      {
        bias: -Math.LN10,
        type: "hidden",
        squash: IDENTITY.NAME,
        uuid: "hidden-0",
      },
      { bias: Math.SQRT2, type: "output", squash: "TANH", uuid: "output-0" },
    ],
    synapses: [
      {
        weight: Math.LOG10E,
        fromUUID: "input-0",
        toUUID: "hidden-0",
      },
      { weight: -1, fromUUID: "input-1", toUUID: "hidden-0" },
      { weight: 1, fromUUID: "input-2", toUUID: "hidden-0" },
      {
        weight: Math.E,
        fromUUID: "input-3",
        toUUID: "hidden-0",
      },
      {
        weight: -Math.SQRT1_2,
        fromUUID: "input-4",
        toUUID: "hidden-0",
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
      { weight: Math.PI, fromUUID: "hidden-0", toUUID: "output-0" },
    ],
    input: 6,
    output: 1,
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

  const sparseComplexConfig = new SparseConfig(
    complex.exportJSON(),
    createBackPropagationConfig({}),
  );
  const sparseSimpliedConfig = new SparseConfig(
    simplifiedCreature.exportJSON(),
    createBackPropagationConfig({}),
  );
  Deno.writeTextFileSync(
    `${directory}/inline-simplied.js`,
    `export function example(${squashList.join(",")}){\n${inlineText}}`,
  );
  for (let p = 0; p < 12; p++) {
    const data = makeData(p, complex.input);

    const actual1 =
      complex.activateAndTrace(data, false, sparseComplexConfig)[0];
    const actual2 =
      simplifiedCreature.activateAndTrace(data, false, sparseSimpliedConfig)[0];

    assertAlmostEquals(
      actual1,
      actual2,
      0.000_01,
      `${p}) expected: ${actual1} actual: ${actual2}`,
    );
  }
});

Deno.test("IDENTITY-simple", () => {
  const directory = ".test/optimize/simplify/IDENTITY-simple";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      {
        bias: -1,
        type: "hidden",
        squash: IDENTITY.NAME,
        uuid: "hidden-0",
      },
      { bias: 2, type: "output", squash: IDENTITY.NAME, uuid: "output-0" },
    ],
    synapses: [
      { weight: 0.5, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: 2, fromUUID: "input-1", toUUID: "hidden-0" },
      { weight: 1, fromUUID: "hidden-0", toUUID: "output-0" },
    ],
    input: 2,
    output: 1,
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

  const sparseComplexConfig = new SparseConfig(
    complex.exportJSON(),
    createBackPropagationConfig({}),
  );
  const sparseSimpliedConfig = new SparseConfig(
    simplifiedCreature.exportJSON(),
    createBackPropagationConfig({}),
  );
  Deno.writeTextFileSync(
    `${directory}/inline-simplied.js`,
    `export function example(${squashList.join(",")}){\n${inlineText}}`,
  );
  for (let p = 0; p < 12; p++) {
    const data = makeData(p, complex.input);

    const actual1 =
      complex.activateAndTrace(data, false, sparseComplexConfig)[0];
    const actual2 =
      simplifiedCreature.activateAndTrace(data, false, sparseSimpliedConfig)[0];

    assertAlmostEquals(
      actual1,
      actual2,
      0.000_01,
      `${p}) a: ${data[0]}, b ${
        data[1]
      }, expected: ${actual1}, actual: ${actual2}`,
    );
  }
});

Deno.test("IDENTITY Maximum", () => {
  const directory = ".test/optimize/simplify/IDENTITY-maximum";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      {
        bias: -1,
        type: "hidden",
        squash: IDENTITY.NAME,
        uuid: "hidden-0",
      },
      { bias: 2, type: "output", squash: MAXIMUM.NAME, uuid: "output-0" },
    ],
    synapses: [
      { weight: 0.5, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: 2, fromUUID: "input-1", toUUID: "hidden-0" },
      { weight: 1, fromUUID: "hidden-0", toUUID: "output-0" },
    ],
    input: 2,
    output: 1,
  };
  const complex = Creature.fromJSON(json);

  const exportCreature = complex.exportJSON();
  Deno.writeTextFileSync(
    `${directory}/complex.json`,
    JSON.stringify(exportCreature, null, 1),
  );
  const simplifiedCreature = simplify(complex);
  assert(!simplifiedCreature);
});
