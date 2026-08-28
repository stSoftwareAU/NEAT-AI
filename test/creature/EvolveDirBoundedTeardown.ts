import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { EvolveDirDeps } from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * GRQ #4472: the post-loop teardown is bounded, so `evolveDir` returns even
 * when a worker cannot be stopped.
 *
 * Breaking out of the generation loop on time is only half of returning control
 * to the caller: the teardown that follows terminates every worker and drains
 * the background replay queue. A worker wedged in a native scorer / WASM call
 * may not honour `terminate()`, and before this change that unbounded step held
 * the run open indefinitely — the GRQ-22 shape, where a child produced no log
 * output for ~2.5 h after its deadline had passed.
 *
 * The wedge is injected by replacing one handler's `terminate()` with a promise
 * that never settles, which is what a handler we cannot stop looks like from
 * the teardown's side. The run is put past its hard cap with an injected past
 * `startTimeMS` (no real sleeps — policy #2888), and `teardownBudgetMS` keeps
 * the abandon prompt. Against the pre-#4472 teardown this test does not fail an
 * assertion — it never returns at all.
 */

/** Minimal 2-in / 1-out dataset; the model never needs to converge here. */
function tinyDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

/** Load every persisted creature from a `creatureStore` directory. */
async function loadStoredCreatures(dir: string): Promise<Creature[]> {
  const creatures: Creature[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const json = JSON.parse(await Deno.readTextFile(`${dir}/${entry.name}`));
    creatures.push(Creature.fromJSON(json));
  }
  return creatures;
}

Deno.test({
  name:
    "evolveDir returns and persists the champion when a worker's terminate() never resolves (GRQ #4472)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-4472-teardown-",
    });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    let captured: Neat | undefined;
    let terminateCalls = 0;

    const deps: EvolveDirDeps = {
      // One hour in the past: with timeoutMinutes = 1 both the soft end time
      // and the hard cap sit ~58 min behind the wall clock, so the loop breaks
      // on the hard-cap branch at generation 1.
      startTimeMS: Date.now() - 60 * 60 * 1000,
      // Abandon the wedged worker promptly instead of after the production
      // default; the test asserts on the outcome, never on elapsed time.
      teardownBudgetMS: 1,
      onNeatReady: (neat) => {
        captured = neat;
        // Never-resolving training work so only the hard cap can end the loop.
        neat.trainingInProgress.set("stuck-train", new Promise<void>(() => {}));
        // A worker we cannot stop: terminate() is asked, and never answers.
        for (const worker of neat.workers) {
          worker.terminate = () => {
            terminateCalls++;
            return new Promise<void>(() => {});
          };
        }
      },
    };

    const result = await evolveDir(creature, dataSetDir, {
      populationSize: 10,
      iterations: 1,
      timeoutMinutes: 1,
      threads: 1,
      creatureStore,
    }, deps);

    assert(captured, "onNeatReady must have handed back the Neat instance");
    assert(
      terminateCalls > 0,
      "the teardown must still ask every worker to stop",
    );
    assert(Number.isFinite(result.score), "best score must be finite");
    assertEquals(
      result.generation,
      1,
      "the hard-cap branch must break on the first completed cycle",
    );

    // The evolved best creature reached disk despite the wedged worker — this
    // is the improvement the deadline-abandon path must never throw away.
    const stored = await loadStoredCreatures(creatureStore);
    assert(stored.length > 0, "creatureStore must contain at least one file");
    assertEquals(stored[0].input, 2, "stored creature input must round-trip");
    assertEquals(stored[0].output, 1, "stored creature output must round-trip");

    // …and it was restored onto the caller's creature.
    const activation = creature.activate(new Float32Array([1, 0]))[0];
    assert(
      Number.isFinite(activation),
      "restored best creature must activate to a finite value",
    );

    await Deno.remove(dataSetDir, { recursive: true });
    await Deno.remove(creatureStore, { recursive: true });
  },
});

Deno.test({
  name:
    "evolveDir returns and persists the champion when a worker's terminate() throws (GRQ #4472)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-4472-throwing-",
    });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    const deps: EvolveDirDeps = {
      startTimeMS: Date.now() - 60 * 60 * 1000,
      teardownBudgetMS: 1,
      onNeatReady: (neat) => {
        neat.trainingInProgress.set("stuck-train", new Promise<void>(() => {}));
        for (const worker of neat.workers) {
          worker.terminate = () => {
            throw new Error("native scorer refused to unwind");
          };
        }
      },
    };

    const result = await evolveDir(creature, dataSetDir, {
      populationSize: 10,
      iterations: 1,
      timeoutMinutes: 1,
      threads: 1,
      creatureStore,
    }, deps);

    assert(Number.isFinite(result.score), "best score must be finite");

    // Before #4472 the unguarded `w.terminate()` threw straight out of
    // evolveDir, so the champion restore and the checkpoint write never ran and
    // the caller saw a rejection instead of a result. Both must now survive.
    const stored = await loadStoredCreatures(creatureStore);
    assert(
      stored.length > 0,
      "a throwing terminate() must not cost us the checkpoint",
    );
    assertEquals(stored[0].input, 2, "stored creature input must round-trip");

    await Deno.remove(dataSetDir, { recursive: true });
    await Deno.remove(creatureStore, { recursive: true });
  },
});

Deno.test({
  name:
    "evolveDir returns when the replay drain never settles past the hard deadline (GRQ #4472)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-4472-drain-",
    });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    let drainCalls = 0;
    const deps: EvolveDirDeps = {
      startTimeMS: Date.now() - 60 * 60 * 1000,
      teardownBudgetMS: 1,
      onNeatReady: (neat) => {
        neat.trainingInProgress.set("stuck-train", new Promise<void>(() => {}));
        // A drain that never settles — the replay-queue half of the GRQ-22
        // wedge. Before #4472 this `await` had no bound at all and the run
        // never returned.
        neat.discoveryReplayQueue.waitForCompletion = () => {
          drainCalls++;
          return new Promise<void>(() => {});
        };
      },
    };

    const result = await evolveDir(creature, dataSetDir, {
      populationSize: 10,
      iterations: 1,
      timeoutMinutes: 1,
      threads: 1,
      creatureStore,
    }, deps);

    assertEquals(drainCalls, 1, "the teardown must still attempt the drain");
    assert(Number.isFinite(result.score), "best score must be finite");

    const stored = await loadStoredCreatures(creatureStore);
    assert(
      stored.length > 0,
      "a wedged drain must not cost us the checkpoint",
    );

    await Deno.remove(dataSetDir, { recursive: true });
    await Deno.remove(creatureStore, { recursive: true });
  },
});
