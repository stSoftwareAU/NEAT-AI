import { Creature } from "../../../src/Creature.ts";

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

  // WASM activation (Issue #1238: JS codegen removed)
  const input = new Float32Array(creature.input);
  for (let i = 0; i < creature.input; i++) {
    input[i] = Math.random() * 2 - 1;
  }
  const output = creature.activate(input, false);
  if (output.length !== creature.output || !output.every(Number.isFinite)) {
    throw new Error("WASM activation should produce valid output");
  }
});
