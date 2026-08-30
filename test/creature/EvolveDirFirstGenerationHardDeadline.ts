import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { EvolveDirDeps } from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { EvolveResult } from "@neat/NeatEvolution.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { HARD_DEADLINE_WATCHDOG_INTERVAL_MS } from "@neat/HardDeadline.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * A first generation slower than `timeoutMinutes + grace` still lands —
 * Issue #3940.
 *
 * On GRQ-26 a 15-minute run reported
 * `abandoning the in-flight generation and keeping the 0 generation(s) already
 * evolved`: the T+grace cap fired *during* generation 1, so the population was
 * never scored and there was no winner to publish. The cap is now floored at
 * one completed generation — the same floor `shouldStopStartingGenerations`
 * has always applied.
 *
 * The cap is driven by an injected clock that steps past T+grace at the moment
 * generation 1 starts (#2888): no assertion measures elapsed time, and the run
 * is held open only long enough for the abandon watchdog to have had its
 * chance to fire.
 */

function tinyDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

/**
 * Hold generation 1 open past at least one watchdog poll, so a cap that was
 * still armed would certainly have abandoned it. Nothing is measured — the
 * gate only guarantees the abandon had its opportunity.
 */
function watchdogPollGate(): Promise<void> {
  return new Promise<void>((resolve) =>
    setTimeout(resolve, HARD_DEADLINE_WATCHDOG_INTERVAL_MS + 100)
  );
}

Deno.test({
  name:
    "evolveDir: a first generation that outlasts the hard deadline is completed, not abandoned",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({ prefix: "neat-3940-" });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    const start = Date.now();
    // The clock sits inside the cap until generation 1 begins, then jumps an
    // hour past it — a first generation slower than `timeoutMinutes + grace`.
    let pastHardDeadline = false;
    const now = () => pastHardDeadline ? start + 60 * 60 * 1000 : start;

    let captured: Neat | undefined;
    const deps: EvolveDirDeps = {
      startTimeMS: start,
      now,
      teardownBudgetMS: 1_000,
      onNeatReady: (neat) => {
        captured = neat;
        const realEvolve = neat.evolve.bind(neat);
        let firstGeneration = true;
        (neat as { evolve: Neat["evolve"] }).evolve = async (
          previousFittest?: Creature,
        ): Promise<EvolveResult> => {
          if (firstGeneration) {
            firstGeneration = false;
            pastHardDeadline = true;
            await watchdogPollGate();
          }
          return await realEvolve(previousFittest);
        };
      },
    };

    const options: NeatOptions = {
      populationSize: 10,
      iterations: 1,
      timeoutMinutes: 1,
      threads: 1,
      creatureStore,
    };

    const result = await evolveDir(creature, dataSetDir, options, deps);

    assert(
      result.generation >= 1,
      `evolveDir must never return zero generations, got ${result.generation}`,
    );
    assert(Number.isFinite(result.score), "best score must be finite");
    assert(Number.isFinite(result.error), "best error must be finite");

    // There is a winner to publish: the champion was restored onto the
    // caller's creature and the store holds it.
    const activation = creature.activate(new Float32Array([1, 0]))[0];
    assert(
      Number.isFinite(activation),
      "the returned champion must activate to a finite value",
    );
    let stored = 0;
    for await (const entry of Deno.readDir(creatureStore)) {
      if (entry.isFile && entry.name.endsWith(".json")) stored++;
    }
    assert(stored > 0, "a zero-generation run leaves nothing to publish");

    // #2892 / #2896 behaviour resumes the moment a generation is banked: the
    // cap ends the run rather than letting it start another generation.
    assertEquals(result.terminationReason, "hard-deadline");
    assert(captured, "onNeatReady must have handed back the Neat instance");
    assertEquals(
      captured.generationsCompleted,
      result.generation,
      "the run must count the generations it actually completed",
    );

    await Deno.remove(dataSetDir, { recursive: true });
    await Deno.remove(creatureStore, { recursive: true });
  },
});
