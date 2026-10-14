import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { EvolveDirDeps } from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DeDuplicator } from "@architecture/DeDuplicator.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { computeHardDeadlineTS } from "@neat/HardDeadline.ts";
import { initWasmForTests } from "../_initWasm.ts";

// Issue #4061: a generation 2 abandoned after its population commit must not
// leave the caller creature without neurons. The abandon is triggered while
// generation 2's deduplication is pending: that is after the commit and before
// the post-commit disposal of the previous population. The disposal then runs
// before evolveDir's persist step restores the champion from the previous best
// creature.

/** Minimal 2-in / 1-out dataset; the model never needs to converge here. */
function tinyDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

Deno.test({
  name:
    "evolveDir: a generation 2 abandoned after its commit leaves the caller creature whole",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({ prefix: "neat-4061-" });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    // Far-future start: the run's own real-clock checks stay well before its
    // end, so only the injected clock below drives the hard deadline.
    const start = Date.UTC(3000, 0, 1);
    const hardDeadline = computeHardDeadlineTS(start, 1)!;
    // Stays inside the hard cap until generation 2 is abandoned, then jumps past it.
    const breachMS = hardDeadline + 1_000;
    let clock = start;
    const now = () => clock;

    const background: { generationTwo?: Promise<unknown> } = {};
    let liveNeat: Neat | undefined;
    let abandonOnDedup = false;
    let callerOutsideCommittedPopulation = false;
    let previousPopulation: Creature[] = [];

    // Generation 2 is parked inside its dedup await, after the abandon, and is
    // released only once evolveDir has returned and restored the caller. Without
    // the hold, the abandoned generation runs its post-commit disposal before
    // the caller is restored and the test cannot observe the bug.
    let releaseHeld: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });

    const originalPerform = DeDuplicator.prototype.perform;
    DeDuplicator.prototype.perform = function (
      this: DeDuplicator,
      creatures: Creature[],
    ) {
      if (abandonOnDedup && liveNeat) {
        abandonOnDedup = false;
        // The commit has landed; the previous population is not yet disposed.
        clock = breachMS;
        liveNeat.abandonInFlightPastHardDeadline(hardDeadline, breachMS);
        // Generation 1 disposed the caller (it was not carried forward) and
        // the run restores it only after evolveDir returns. Make the caller a
        // member of the previous population that the commit did not carry
        // forward: exactly what the post-commit disposal empties when it is
        // not skipped. The disposal iterates this array after the dedup await.
        previousPopulation.push(creature);
        callerOutsideCommittedPopulation = !creatures.includes(creature);
        // The held dedup deliberately skips the real pass: by release time the
        // run's teardown has disposed these members, and deduplicating them
        // would throw before generation 2 reaches its post-commit disposal.
        return held.then(() => undefined);
      }
      return originalPerform.call(this, creatures);
    };

    const deps: EvolveDirDeps = {
      startTimeMS: start,
      now,
      teardownBudgetMS: 1_000,
      onNeatReady: (neat) => {
        liveNeat = neat;
        const realEvolve = neat.evolve.bind(neat);
        let calls = 0;
        (neat as { evolve: Neat["evolve"] }).evolve = (
          previousFittest?: Creature,
        ) => {
          calls++;
          if (calls !== 2) return realEvolve(previousFittest);
          abandonOnDedup = true;
          // The array generation 2 will commit over: its previous population.
          previousPopulation = neat.population;
          const generationTwo = realEvolve(previousFittest);
          background.generationTwo = generationTwo;
          return generationTwo;
        };
      },
    };

    // Several iterations so generation 1 does not complete the run and generation 2 is reached.
    const options: NeatOptions = {
      populationSize: 10,
      iterations: 5,
      timeoutMinutes: 1,
      threads: 1,
      creatureStore,
    };

    // The finally always releases the held generation, so a failing evolveDir
    // cannot leave the abandoned generation parked forever.
    const result = await evolveDir(creature, dataSetDir, options, deps)
      .finally(() => {
        releaseHeld();
        DeDuplicator.prototype.perform = originalPerform;
      });
    assert(background.generationTwo, "generation 2 must have started");
    assert(
      callerOutsideCommittedPopulation,
      "the caller must be outside generation 2's committed population",
    );
    // Generation 2 resumes only now, after the caller has been restored.
    await background.generationTwo.catch(() => undefined);

    const uuid = CreatureUtil.makeUUID(creature);
    assert(uuid.length > 0, "the caller creature must produce a UUID");
    assert(
      creature.neurons.length > creature.input,
      `the caller must keep its hidden neurons, got ${creature.neurons.length} neuron(s) for ${creature.input} input(s) and ${creature.output} output(s)`,
    );
    assert(
      creature.neurons.length >= creature.input + creature.output,
      `the caller must keep its input and output neurons, got ${creature.neurons.length} neuron(s)`,
    );
    creature.validate();

    assertEquals(
      result.generation,
      1,
      "the run must bank generation 1 and abandon generation 2",
    );
    assertEquals(
      result.terminationReason,
      "hard-deadline",
      "the hard cap, not an overrun, must end the run",
    );

    await Deno.remove(dataSetDir, { recursive: true });
    await Deno.remove(creatureStore, { recursive: true });
  },
});
