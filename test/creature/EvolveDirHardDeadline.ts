import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { EvolveDirDeps } from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * End-to-end T+15 hard-deadline guard — Issue #2902, part of #2892.
 *
 * Proves that `evolveDir(timeoutMinutes = T)` returns with consistent state
 * once the absolute hard cap (T + min(15, T) minutes) passes, even when
 * discovery / training work is stubbed to never resolve. The cap is driven by
 * an injected past `startTimeMS` rather than real sleeps, so every assertion is
 * behavioural (state + return value), never an elapsed-time measurement — the
 * policy from #2888. The whole suite stays well inside the 120 s test budget.
 *
 * Linkage to #2896: the run terminates because the finish-up cycle takes the
 * `abandonInFlightPastHardDeadline` branch, which breaks on the *first*
 * completed cycle (so the run returns at `generation === 1`). Against the
 * pre-#2896 behaviour the finish-up cycle could only clear the stuck task and
 * then spin through further evolve() generations / waits before stopping, so a
 * run that returns at exactly generation 1 with a never-resolving in-flight
 * task could not have happened. Verified by temporarily neutering the branch:
 * the `result.generation === 1` assertion then fails (the run reaches
 * generation 2+), confirming the test genuinely depends on the hard cap.
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

/**
 * Build the shared options + a past-start deps seam so the soft timeout and the
 * T+15 hard cap are already behind the wall clock when the first finish-up
 * cycle runs. `captureNeat` lets the caller stub in-flight work and inspect the
 * in-flight maps after the run.
 */
function hardDeadlineDeps(captureNeat: (neat: Neat) => void): EvolveDirDeps {
  return {
    // One hour in the past: with timeoutMinutes = 1 the soft endTime (start +
    // 1 min) and the hard cap (start + 1 min + 1 min grace) both sit ~58 min
    // before now, so abandonInFlightPastHardDeadline fires on generation 1.
    startTimeMS: Date.now() - 60 * 60 * 1000,
    onNeatReady: captureNeat,
  };
}

function baseOptions(creatureStore: string): NeatOptions {
  return {
    populationSize: 10,
    iterations: 1,
    timeoutMinutes: 1,
    threads: 1,
    creatureStore,
  };
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
    "evolveDir T+15 guard: training-mode run returns once the hard cap passes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({ prefix: "neat-t15-train-" });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    let captured: Neat | undefined;
    const deps = hardDeadlineDeps((neat) => {
      captured = neat;
      // Stubbed never-resolving training work — only the hard cap can release
      // the finish-up cycle (no Rust FFI involved).
      neat.trainingInProgress.set("stuck-train", new Promise<void>(() => {}));
    });

    const result = await evolveDir(
      creature,
      dataSetDir,
      baseOptions(creatureStore),
      deps,
    );

    // The function returned (no hang) with a finite best result loaded onto the
    // caller's creature.
    assert(Number.isFinite(result.score), "best score must be finite");
    assert(Number.isFinite(result.error), "best error must be finite");
    // #2896 linkage: the hard-cap branch breaks on the *first* completed cycle,
    // before finishUp() can ask for more wait generations. Against the
    // pre-#2896 behaviour the finish-up cycle would clear the stub and spin
    // through extra evolve() generations (generation > 1) before stopping, so a
    // run that returns at exactly generation 1 with a never-resolving in-flight
    // task can only have taken the abandonInFlightPastHardDeadline branch.
    assertEquals(
      result.generation,
      1,
      "the hard-cap branch must break on the first completed cycle",
    );
    // The best creature found was loaded onto the caller's creature: it is a
    // valid, activatable network that round-trips through JSON.
    const activation = creature.activate(new Float32Array([1, 0]))[0];
    assert(
      Number.isFinite(activation),
      "loaded best creature must activate to a finite value",
    );
    assertEquals(
      Creature.fromJSON(creature.exportJSON()).input,
      2,
      "loaded best creature must round-trip through JSON",
    );

    // In-flight bookkeeping was abandoned by the hard-cap branch.
    assert(captured, "onNeatReady must have handed back the Neat instance");
    assertEquals(
      captured.trainingInProgress.size,
      0,
      "trainingInProgress must be empty after the hard-cap break",
    );
    assertEquals(
      captured.discoveryInProgress.size,
      0,
      "discoveryInProgress must be empty after the hard-cap break",
    );
    assertEquals(
      captured.discoveryReplayQueue.isReplayInProgress(),
      false,
      "no replay may be left wedged after the run returns",
    );

    // creatureStore was written and the persisted creatures are loadable.
    const stored = await loadStoredCreatures(creatureStore);
    assert(stored.length > 0, "creatureStore must contain at least one file");
    for (const loaded of stored) {
      assertEquals(loaded.input, 2, "stored creature input must round-trip");
      assertEquals(loaded.output, 1, "stored creature output must round-trip");
    }

    await Deno.remove(dataSetDir, { recursive: true });
    await Deno.remove(creatureStore, { recursive: true });
  },
});

Deno.test({
  name:
    "evolveDir T+15 guard: discovery-mode run (stubbed) returns once the hard cap passes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({ prefix: "neat-t15-disc-" });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    let captured: Neat | undefined;
    const deps = hardDeadlineDeps((neat) => {
      captured = neat;
      // Discovery stubbed so CI needs no Rust FFI: a never-resolving promise
      // standing in for an in-flight discovery task.
      neat.discoveryInProgress.set("stuck-disc", new Promise<void>(() => {}));
    });

    const result = await evolveDir(
      creature,
      dataSetDir,
      baseOptions(creatureStore),
      deps,
    );

    assert(Number.isFinite(result.score), "best score must be finite");
    assert(Number.isFinite(result.error), "best error must be finite");
    // #2896 linkage: see the training-mode test — breaking at exactly
    // generation 1 with a never-resolving stub proves the hard-cap branch fired.
    assertEquals(
      result.generation,
      1,
      "the hard-cap branch must break on the first completed cycle",
    );

    assert(captured, "onNeatReady must have handed back the Neat instance");
    assertEquals(
      captured.discoveryInProgress.size,
      0,
      "discoveryInProgress must be empty after the hard-cap break",
    );
    assertEquals(
      captured.trainingInProgress.size,
      0,
      "trainingInProgress must be empty after the hard-cap break",
    );

    const stored = await loadStoredCreatures(creatureStore);
    assert(stored.length > 0, "creatureStore must contain at least one file");
    assertEquals(stored[0].input, 2, "stored creature input must round-trip");
    assertEquals(stored[0].output, 1, "stored creature output must round-trip");

    await Deno.remove(dataSetDir, { recursive: true });
    await Deno.remove(creatureStore, { recursive: true });
  },
});
