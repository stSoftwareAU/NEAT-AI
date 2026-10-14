import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { EvolveDirDeps } from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { computeHardDeadlineTS } from "@neat/HardDeadline.ts";
import { initWasmForTests } from "../_initWasm.ts";

// Issue #4061: a generation 2 abandoned at the hard cap must not empty the caller creature.
// Generation 1 runs normally; the injected clock jumps past the hard cap as generation 2 starts.
// Generation 2's real evolve is gated until evolveDir has returned, so its background work is genuine.

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
    "evolveDir: a generation 2 abandoned at the hard deadline leaves the caller creature whole",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({ prefix: "neat-4061-" });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    // Run start on the real wall clock. `finishGeneration` reads `Date.now()` for
    // its soft-timeout check, so a start far in the past would look timed out
    // after generation 1 and end the run before generation 2 begins. With
    // timeoutMinutes = 1 the hard cap is start + 2 minutes.
    const start = Date.now();
    const hardDeadline = computeHardDeadlineTS(start, 1)!;
    // Sits inside the clock until generation 2 begins, then jumps past the hard cap.
    const breachMS = hardDeadline + 1_000;
    let clock = start;
    const now = () => clock;

    // Generation 2's real evolve settles only once this gate is released.
    const gate = Promise.withResolvers<void>();
    const background: { generationTwo?: Promise<unknown> } = {};

    const deps: EvolveDirDeps = {
      startTimeMS: start,
      now,
      teardownBudgetMS: 1_000,
      onNeatReady: (neat) => {
        const realEvolve = neat.evolve.bind(neat);
        let calls = 0;
        (neat as { evolve: Neat["evolve"] }).evolve = (
          previousFittest?: Creature,
        ) => {
          calls++;
          if (calls !== 2) return realEvolve(previousFittest);
          // Generation 2 starts past the hard cap, so the abandon watchdog fires within one poll.
          clock = breachMS;
          const gated = realEvolve(previousFittest).then(async (r) => {
            await gate.promise;
            return r;
          });
          background.generationTwo = gated;
          return gated;
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

    const result = await evolveDir(creature, dataSetDir, options, deps);
    // evolveDir has returned; now let the abandoned generation 2 finish in the background.
    gate.resolve();
    await background.generationTwo?.catch(() => undefined);

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
    assert(background.generationTwo, "generation 2 must have started");

    const uuid = CreatureUtil.makeUUID(creature);
    assert(uuid.length > 0, "the caller creature must produce a UUID");
    assert(
      creature.neurons.length > creature.input,
      `the caller must keep its hidden neurons, got ${creature.neurons.length} neuron(s) for ${creature.input} input(s) and ${creature.output} output(s)`,
    );
    creature.validate();

    await Deno.remove(dataSetDir, { recursive: true });
    await Deno.remove(creatureStore, { recursive: true });
  },
});
