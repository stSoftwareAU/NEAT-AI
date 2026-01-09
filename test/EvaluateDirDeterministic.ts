import { assertEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import { Costs } from "../src/Costs.ts";

function writeBin(path: string, floats: number[]) {
  const buf = new Float32Array(floats);
  Deno.writeFileSync(path, new Uint8Array(buf.buffer));
}

Deno.test("Creature.evaluateDir is deterministic across runs (sorted file order)", () => {
  const dir = Deno.makeTempDirSync({ prefix: "neat-eval-deterministic-" });
  try {
    // Simple creature: 1 input -> 1 output identity
    const creature = new Creature(1, 1, {
      layers: [{ count: 1, squash: "IDENTITY" }],
    });
    creature.fix();

    // Two .bin files with one record each: [input, target]
    // Record format is float32 valuesCount = input + output.
    writeBin(`${dir}/b.bin`, [1, 1]);
    writeBin(`${dir}/a.bin`, [2, 2]);

    const cost = Costs.find("MSE");
    const r1 = creature.evaluateDir(dir, cost, false).error;
    const r2 = creature.evaluateDir(dir, cost, false).error;

    assertEquals(r1, r2);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
