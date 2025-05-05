import { assert, assertAlmostEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { MINIMUM } from "../../../src/methods/activations/aggregate/MINIMUM.ts";
import { Cosine } from "../../../src/methods/activations/types/Cosine.ts";
import { Exponential } from "../../../src/methods/activations/types/Exponential.ts";
import { GAUSSIAN } from "../../../src/methods/activations/types/GAUSSIAN.ts";
import { GELU } from "../../../src/methods/activations/types/GELU.ts";
import { LogSigmoid } from "../../../src/methods/activations/types/LogSigmoid.ts";
import { ReLU } from "../../../src/methods/activations/types/ReLU.ts";
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
        squash: ReLU.NAME,
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
    `${directory}/inline-simplified.js`,
    `export function example(${squashList.join(",")}){\n${inlineText}}`,
  );
  assertNotEquals(
    complex.uuid ?? "COMPLEX",
    simplifiedCreature.uuid ?? "SIMPLIFIED",
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

Deno.test("Constant-1", () => {
  const directory = ".test/optimize/simplify/Constant-1";
  Deno.mkdirSync(directory, { recursive: true });
  const json: CreatureExport = {
    neurons: [
      {
        type: "constant",
        uuid: "1dc9e69f-2a4e-4d7f-91f9-f6cf9111c7ea",
        bias: 5.636708811559053,
      },
      {
        type: "hidden",
        uuid: "28d0d7c9-95c4-4427-b5a4-f0cfc3b7dc10",
        bias: -0.04979543090182879,
        squash: "LOGISTIC",
      },
      {
        type: "hidden",
        uuid: "f07cfb93-8d6f-461f-836c-b77578e5bdca",
        bias: -0.010273017496200382,
        squash: "BIPOLAR_SIGMOID",
      },
      {
        type: "output",
        uuid: "output-0",
        bias: -0.3795492,
        squash: "LOGISTIC",
      },
    ],
    synapses: [
      {
        weight: 0.6363137999999999,
        fromUUID: "input-0",
        toUUID: "f07cfb93-8d6f-461f-836c-b77578e5bdca",
      },
      {
        weight: -0.6923185,
        fromUUID: "1dc9e69f-2a4e-4d7f-91f9-f6cf9111c7ea",
        toUUID: "28d0d7c9-95c4-4427-b5a4-f0cfc3b7dc10",
      },
      {
        weight: -0.0782533,
        fromUUID: "1dc9e69f-2a4e-4d7f-91f9-f6cf9111c7ea",
        toUUID: "output-0",
      },
      {
        weight: -0.9097152,
        fromUUID: "28d0d7c9-95c4-4427-b5a4-f0cfc3b7dc10",
        toUUID: "output-0",
      },
      {
        weight: -28.1882172,
        fromUUID: "f07cfb93-8d6f-461f-836c-b77578e5bdca",
        toUUID: "output-0",
      },
    ],
    input: 1,
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
  simplifiedCreature.DEBUG = false;
  Deno.writeTextFileSync(
    `${directory}/simplified.json`,
    JSON.stringify(simplifiedCreature.exportJSON(), null, 1),
  );
  simplifiedCreature.validate();
  const { inlineText, squashList } = makeCreatureActivationFunction(
    simplifiedCreature,
  );

  Deno.writeTextFileSync(
    `${directory}/inline-simplified.js`,
    `export function example(${squashList.join(",")}){\n${inlineText}}`,
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

Deno.test("Constant-2", () => {
  const directory = ".test/optimize/simplify/Constant-2";
  Deno.mkdirSync(directory, { recursive: true });
  const json: CreatureExport = {
    neurons: [
      {
        type: "constant",
        uuid: "f2904dda-5c21-4eb2-9702-6925aeb78340",
        bias: 0.002633000663732854,
      },
      {
        type: "hidden",
        uuid: "20e45657-8ec9-462d-ad8c-24a3f743d258",
        bias: 0.1422979,
        squash: "LOGISTIC",
      },
      {
        type: "hidden",
        uuid: "5b8efecf-5dd1-4a83-9af1-32425ece032b",
        bias: 0.1100298,
        squash: "LOGISTIC",
      },
      {
        type: "output",
        uuid: "output-0",
        bias: -0.5862190032291987,
        squash: "LOGISTIC",
      },
    ],
    synapses: [
      {
        weight: 0.0422889,
        fromUUID: "input-0",
        toUUID: "5b8efecf-5dd1-4a83-9af1-32425ece032b",
      },
      {
        weight: -13.2091447,
        fromUUID: "input-0",
        toUUID: "output-0",
      },
      {
        weight: -0.0000014,
        fromUUID: "f2904dda-5c21-4eb2-9702-6925aeb78340",
        toUUID: "20e45657-8ec9-462d-ad8c-24a3f743d258",
      },
      {
        weight: -0.006841799126331986,
        fromUUID: "f2904dda-5c21-4eb2-9702-6925aeb78340",
        toUUID: "5b8efecf-5dd1-4a83-9af1-32425ece032b",
      },
      {
        weight: -0.7859982999999999,
        fromUUID: "f2904dda-5c21-4eb2-9702-6925aeb78340",
        toUUID: "output-0",
      },
      {
        weight: -0.13090859999999999,
        fromUUID: "20e45657-8ec9-462d-ad8c-24a3f743d258",
        toUUID: "output-0",
      },
      {
        weight: -0.065889,
        fromUUID: "5b8efecf-5dd1-4a83-9af1-32425ece032b",
        toUUID: "output-0",
      },
    ],
    input: 1,
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
  simplifiedCreature.DEBUG = false;
  Deno.writeTextFileSync(
    `${directory}/simplified.json`,
    JSON.stringify(simplifiedCreature.exportJSON(), null, 1),
  );
  simplifiedCreature.validate();
  const { inlineText, squashList } = makeCreatureActivationFunction(
    simplifiedCreature,
  );

  Deno.writeTextFileSync(
    `${directory}/inline-simplified.js`,
    `export function example(${squashList.join(",")}){\n${inlineText}}`,
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

Deno.test("Constant-3", () => {
  const directory = ".test/optimize/simplify/Constant-3";
  Deno.mkdirSync(directory, { recursive: true });
  const json: CreatureExport = {
    neurons: [
      {
        type: "constant",
        uuid: "hidden-4",
        bias: 1,
      },
      {
        type: "output",
        uuid: "output-0",
        bias: 1.4006201689394766,
        squash: "IDENTITY",
      },
      {
        type: "output",
        uuid: "output-1",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      {
        weight: 0.8,
        fromUUID: "input-2",
        toUUID: "output-1",
      },
      {
        weight: 0.6,
        fromUUID: "hidden-4",
        toUUID: "output-0",
      },
      {
        weight: 0.7,
        fromUUID: "hidden-4",
        toUUID: "output-1",
      },
    ],
    input: 3,
    output: 2,
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
  simplifiedCreature.DEBUG = false;
  Deno.writeTextFileSync(
    `${directory}/simplified.json`,
    JSON.stringify(simplifiedCreature.exportJSON(), null, 1),
  );
  simplifiedCreature.validate();
  const { inlineText, squashList } = makeCreatureActivationFunction(
    simplifiedCreature,
  );

  Deno.writeTextFileSync(
    `${directory}/inline-simplified.js`,
    `export function example(${squashList.join(",")}){\n${inlineText}}`,
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
