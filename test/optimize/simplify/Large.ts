import { assertAlmostEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import { makeCreatureActivationFunction } from "../../../src/optimize/MakeCreatureActivationFunction.ts";
import { simplify } from "../../../src/optimize/Simplify.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";
import { makeData } from "./ABSOLUTE.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Simplify Large", () => {
  const directory = ".test/optimize/simplify/Large";
  Deno.mkdirSync(directory, { recursive: true });

  const complex = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  );
  complex.fix();
  const exportCreature = complex.exportJSON();
  Deno.writeTextFileSync(
    `${directory}/complex.json`,
    JSON.stringify(exportCreature, null, 1),
  );
  let simplifiedCreature: Creature = complex;
  for (let i = 0; i < 100; i++) {
    const next = simplify(simplifiedCreature);
    if (next) {
      simplifiedCreature = next;
    } else {
      break;
    }
  }
  const exportSimplified = simplifiedCreature.exportJSON();
  Deno.writeTextFileSync(
    `${directory}/simplified.json`,
    JSON.stringify(exportSimplified, null, 1),
  );

  const { inlineText, squashList } = makeCreatureActivationFunction(
    simplifiedCreature,
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

    const actual1 = complex.activate(data, false)[0];
    const actual2 =
      simplifiedCreature.activateAndTrace(data, false, sparseSimpliedConfig)[0];

    assertAlmostEquals(
      actual1,
      actual2,
      0.005,
      `${p}) expected: ${actual1} actual: ${actual2}`,
    );
  }
});
