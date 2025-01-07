import { assertAlmostEquals, fail } from "@std/assert";
import type { DataRecordInterface } from "../../../src/architecture/DataSet.ts";
import { Creature } from "../../../src/Creature.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";
import { makeCreatureActivationFunction } from "../../../src/optimize/MakeCreatureActivationFunction.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("large", () => {
  const directory = ".test/optimize/activate/Large";
  const trainingSet = JSON.parse(
    Deno.readTextFileSync("test/propagate/large/td.json"),
  );

  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  );
  creature.fix();
  try {
    Deno.removeSync(directory, { recursive: true });
  } catch (e) {
    const name = (e as { name: string }).name;
    if (name !== "NotFound") {
      console.error(e);
    }
  }
  Deno.mkdirSync(directory, { recursive: true });
  const exportCreature = creature.exportJSON();
  Deno.writeTextFileSync(
    `${directory}/creature.json`,
    JSON.stringify(exportCreature, null, 1),
  );

  const { inlineText, squashList } = makeCreatureActivationFunction(creature);

  Deno.writeTextFileSync(
    `${directory}/inline.js`,
    `export function example(${squashList.join(",")}){\n${inlineText}\n}`,
  );

  if( inlineText.includes(";;") ){
    fail("Double semicolons detected");
  }
  const sparseConfig = new SparseConfig(
    exportCreature,
    createBackPropagationConfig({}),
  );
  trainingSet.forEach((dataSet: DataRecordInterface) => {
    const data = new Float32Array(dataSet.input);
    const outputA = creature.activate(data);
    const outputB = creature.activateAndTrace(
      data,
      false,
      sparseConfig,
    );
    
    assertAlmostEquals(outputA[0], outputB[0]);
  });
});
