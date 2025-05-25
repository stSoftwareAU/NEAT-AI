import { fail } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import { makeCreatureActivationFunction } from "../../../src/optimize/MakeCreatureActivationFunction.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("large", () => {
  const directory = ".test/optimize/activate/Large";

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
});
