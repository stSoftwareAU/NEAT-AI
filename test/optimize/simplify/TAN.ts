import { assert, assertAlmostEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { simplify } from "../../../src/optimize/Simplify.ts";
import { TAN } from "../../../src/methods/activations/types/TAN.ts";
import { makeData } from "./ABSOLUTE.ts";

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
      const expected = complexActuals[i];
      const actual = simplifiedActuals[i];
      // TAN is numerically sensitive and small platform/JIT differences can
      // accumulate through the simplified code path. Near asymptotes, TAN
      // outputs can be very large (1000+), so use a relative tolerance for
      // large values and an absolute tolerance for small values.
      const magnitude = Math.max(Math.abs(expected), Math.abs(actual), 1);
      const tolerance = Math.max(0.04, magnitude * 0.001); // 0.1% relative or 0.04 absolute
      assertAlmostEquals(
        expected,
        actual,
        tolerance,
        `${p}) expected: ${expected} actual: ${actual}`,
      );
    }
  }
});
