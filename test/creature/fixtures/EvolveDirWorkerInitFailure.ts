import { assert, assertEquals, assertRejects } from "@std/assert";
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import { evolveDir } from "@creature/CreatureTraining.ts";
import { initWasmForTests } from "../../_initWasm.ts";

if (import.meta.main) {
  await initWasmForTests();
  const failureUrl = new URL("./RejectWorkerInit.ts", import.meta.url).href;
  globalThis.Worker = new Proxy(Worker, {
    construct(Target, args) {
      return new Target(failureUrl, args[1]);
    },
  });
  const dir = makeDataDir([
    { input: new Float32Array([0]), output: new Float32Array([1]) },
  ], 1);
  try {
    const evolve = () =>
      evolveDir(new Creature(1, 1), dir, {
        threads: Deno.args.includes("--parallel") ? 2 : 1,
        populationSize: 4,
        iterations: 1,
        trainPerGen: 0,
        discoverySampleRate: 0,
        rustScorer: { enabled: false },
      });
    if (Deno.args.includes("--native")) {
      await assertRejects(evolve, Error, "fixture worker init rejected");
      console.log("NATIVE_INIT_REFUSED");
    } else {
      const result = await evolve();
      assert(Number.isFinite(result.score));
      assertEquals(result.generation, 1);
      console.log("WASM_RUN_COMPLETE");
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
