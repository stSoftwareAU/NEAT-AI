import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";
import { simplify } from "../../../src/optimize/Simplify.ts";
import { makeCreatureActivationFunction } from "../../../src/optimize/MakeCreatureActivationFunction.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";

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
  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 4 - 2;
    const b = Math.random() * 4 - 2;
    const c = Math.random() * 4 - 2;
    const d = Math.random() * 4 - 2;
    const e = Math.random() * 4 - 2;
    const f = Math.random() * 4 - 2;

    const data = new Float32Array([a, b, c, d, e, f]);
    // const expected = complex.activate(data, false)[0];

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

    // const actaul = simplifiedCreature.activate(data, false)[0];

    // assertAlmostEquals(expected, actaul,0.000_01, `${p}) expected: ${expected} actual: ${actaul}`);
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
      { bias: 2, type: "output", squash: "IDENTITY", uuid: "output-0" },
    ],
    synapses: [
      { weight: -1, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: 1, fromUUID: "hidden-0", toUUID: "output-0" },
    ],
    input: 1,
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
  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 4 - 2;

    const data = new Float32Array([a]);
    // const expected = complex.activate(data, false)[0];

    const actual1 =
      complex.activateAndTrace(data, false, sparseComplexConfig)[0];
    const actual2 =
      simplifiedCreature.activateAndTrace(data, false, sparseSimpliedConfig)[0];

    assertAlmostEquals(
      actual1,
      actual2,
      0.000_01,
      `${p}) a: ${a}, expected: ${actual1}, actual: ${actual2}`,
    );

    // const actaul = simplifiedCreature.activate(data, false)[0];

    // assertAlmostEquals(expected, actaul,0.000_01, `${p}) expected: ${expected} actual: ${actaul}`);
  }
});
