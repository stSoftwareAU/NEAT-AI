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
    `export function example(${squashList.join(",")}){\n${inlineText}}`,
  );

  if (inlineText.includes(";;")) {
    fail("Double semicolons detected");
  }
  const shouldNotContain = [
    " IDENTITY",
    "=IDENTITY",
    " TANH",
    "=TANH",
    "STEP",
    "ABSOLUTE",
    "CLIPPED",
    "HARD_TANH",
    "ArcTan",
    "BIPOLAR(",
    "COMPLEMENT",
    "Cosine",
    "ReLU6",
    "SINE",
  ];
  shouldNotContain.forEach((text) => {
    if (inlineText.includes(text)) {
      fail(`${text} detected`);
    }
  });

  const sparseConfig = new SparseConfig(
    exportCreature,
    createBackPropagationConfig({}),
  );
  const expected = [
    0.2914523482322693,
    0.22125014662742615,
    0.1657249480485916,
    -0.3648700416088104,
    -0.03569267690181732,
    -0.1089940071105957,
    -0.09180060029029846,
  ];
  for (let p = 0; p < trainingSet.length; p++) {
    const dataSet: DataRecordInterface = trainingSet[p];
    const data = new Float32Array(dataSet.input);
    const activationA = creature.activate(data);
    const activationB = creature.activateAndTrace(
      data,
      false,
      sparseConfig,
    );
    assertAlmostEquals(activationA[0], expected[p]);
    assertAlmostEquals(activationA[0], activationB[0]);
  }
});
