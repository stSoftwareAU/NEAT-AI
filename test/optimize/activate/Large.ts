import { Creature } from "../../../src/Creature.ts";
import { initWasmActivation } from "../../../src/wasm/WasmActivation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("large", async () => {
  const directory = ".test/optimize/activate/Large";
  await initWasmActivation();

  const creature = Creature.fromJSON(
    JSON.parse(
      await Deno.readTextFile("test/propagate/large/creature.json"),
    ),
  );
  creature.fix();
  try {
    await Deno.remove(directory, { recursive: true });
  } catch (e) {
    const name = (e as { name: string }).name;
    if (name !== "NotFound") {
      console.error(e);
    }
  }
  await Deno.mkdir(directory, { recursive: true });

  const exportCreature = creature.exportJSON();
  await Deno.writeTextFile(
    `${directory}/creature.json`,
    JSON.stringify(exportCreature, null, 1),
  );
});
