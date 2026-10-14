import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { EvolveDirDeps } from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { DeDuplicator } from "@architecture/DeDuplicator.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { computeHardDeadlineTS } from "@neat/HardDeadline.ts";
import { initWasmForTests } from "../_initWasm.ts";

// Issue #4061: a generation abandoned past the hard deadline during its dedup
// await must not dispose the previous population's members. The abandon lands
// after the early abandon check and before the re-check that guards disposal.

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
    "NEAT: a generation abandoned mid-commit leaves the previous population undisposed (Issue #4061)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({ prefix: "neat-4061-mid-" });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    // Far-future start: only the injected clock drives the hard deadline.
    const start = Date.UTC(3000, 0, 1);
    const hardDeadline = computeHardDeadlineTS(start, 1)!;
    // Stays inside the hard cap until generation 2 is abandoned, then jumps past it.
    const breachMS = hardDeadline + 1_000;
    let clock = start;
    const now = () => clock;

    const background: { generationTwo?: Promise<unknown> } = {};
    let liveNeat: Neat | undefined;
    let abandonOnDedup = false;
    let hookFired = false;
    // Generation 2's dedup promise, so the check can wait for its continuation.
    let heldDedup: Promise<void> | undefined;
    // Generation 1's population, snapshotted at the start of generation 2.
    let previousPopulation: Creature[] = [];
    // The members the post-commit disposal would dispose: generation 1 members
    // not carried into the committed population. Set inside the hook.
    let captured: Creature[] = [];

    // Generation 2 is parked inside its dedup await, after the abandon, and is
    // released only once evolveDir has returned and restored the caller.
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
        hookFired = true;
        // The commit has landed, so liveNeat.population is the new population.
        const committed = new Set(liveNeat.population);
        captured = previousPopulation.filter((member) =>
          !committed.has(member)
        );
        clock = breachMS;
        liveNeat.abandonInFlightPastHardDeadline(hardDeadline, breachMS);
        // Released only after teardown has disposed this population, so the
        // real dedup must not run on it; resolve without touching the members.
        heldDedup = held.then(() => undefined);
        return heldDedup;
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
          previousPopulation = [...neat.population];
          abandonOnDedup = true;
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

    try {
      // The finally always releases the held generation and restores the
      // prototype, so a failing evolveDir cannot leave generation 2 parked.
      const result = await evolveDir(creature, dataSetDir, options, deps)
        .finally(() => {
          releaseHeld();
          DeDuplicator.prototype.perform = originalPerform;
        });

      assert(
        hookFired,
        "the abandon hook must fire during generation 2's dedup",
      );
      assert(background.generationTwo, "generation 2 must have started");
      // Generation 2 resumes only now, after the caller has been restored.
      await background.generationTwo.catch(() => undefined);
      // Generation 2 resumes its dedup only after release; wait for that
      // continuation so its post-commit disposal has run before the check.
      await heldDedup?.catch(() => undefined);

      assert(
        captured.length > 0,
        "the previous population must be captured before generation 2 commits",
      );
      captured.forEach((member, index) => {
        assert(
          member.neurons.length >= member.input + member.output,
          `previous-population member ${index} was disposed by an abandoned generation (neurons: ${member.neurons.length}, input: ${member.input}, output: ${member.output})`,
        );
      });

      assertEquals(
        result.terminationReason,
        "hard-deadline",
        "the hard cap, not an overrun, must end the run",
      );
    } finally {
      await Deno.remove(dataSetDir, { recursive: true });
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});
