import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { simplify } from "@optimize/Simplify.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { MAXIMUM } from "@methods/activations/aggregate/MAXIMUM.ts";
import { makeData } from "./ABSOLUTE.ts";

Deno.test("simplify - IDENTITY hidden neuron folded into downstream TANH output", () => {
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

  const sparseComplexConfig = new SparseConfig(
    complex.exportJSON(),
    createBackPropagationConfig({}),
  );
  const sparseSimplifiedConfig = new SparseConfig(
    simplifiedCreature.exportJSON(),
    createBackPropagationConfig({}),
  );
  for (let p = 0; p < 12; p++) {
    const data = makeData(p, complex.input);

    const actual1 =
      complex.activateAndTrace(data, false, sparseComplexConfig)[0];
    const actual2 = simplifiedCreature.activateAndTrace(
      data,
      false,
      sparseSimplifiedConfig,
    )[0];

    assertAlmostEquals(
      actual1,
      actual2,
      0.000_01,
      `${p}) expected: ${actual1} actual: ${actual2}`,
    );
  }
});

Deno.test("simplify - simple IDENTITY chain folded into single output neuron", () => {
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

  const sparseComplexConfig = new SparseConfig(
    complex.exportJSON(),
    createBackPropagationConfig({}),
  );
  const sparseSimplifiedConfig = new SparseConfig(
    simplifiedCreature.exportJSON(),
    createBackPropagationConfig({}),
  );
  for (let p = 0; p < 12; p++) {
    const data = makeData(p, complex.input);

    const actual1 =
      complex.activateAndTrace(data, false, sparseComplexConfig)[0];
    const actual2 = simplifiedCreature.activateAndTrace(
      data,
      false,
      sparseSimplifiedConfig,
    )[0];

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

Deno.test("simplify - IDENTITY into MAXIMUM output is not simplified (aggregate squash is unsafe to fold)", () => {
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
  const creature = Creature.fromJSON(json);

  // IDENTITY folding into an aggregate squash (MAXIMUM) would change behaviour
  // because aggregation operates per-synapse — merging synapses alters the
  // comparison set. simplify() should correctly refuse.
  const simplifiedCreature = simplify(creature);
  assertEquals(
    simplifiedCreature,
    undefined,
    "Simplify must not fold IDENTITY into aggregate squash MAXIMUM",
  );

  // Verify the original creature still produces valid output after attempted simplify
  const exported = creature.exportJSON();
  assertEquals(
    exported.neurons.length,
    2,
    "Original creature should be unchanged",
  );
});
