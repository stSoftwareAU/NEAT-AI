// Child process: real scheduling, worker processing, quarantine and evolveDir teardown.
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import { evolveDir } from "@creature/CreatureTraining.ts";
import { dirname } from "@std/path";
import { initWasmForTests } from "../../_initWasm.ts";

if (import.meta.main) {
  await initWasmForTests();
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const onReleased = () => released.resolve();
  Deno.addSignalListener("SIGUSR2", onReleased);
  const startedPath = Deno.env.get("NEAT_TEST_STARTED")!;
  const watcher = Deno.watchFs(dirname(startedPath));
  const observeEntry = (async () => {
    for await (const event of watcher) {
      if (!event.paths.includes(startedPath)) continue;
      const pid = Number(await Deno.readTextFile(startedPath));
      assert(Number.isSafeInteger(pid) && pid > 0);
      console.log(`NATIVE_CALL_STARTED pid=${pid}`);
      entered.resolve();
      return;
    }
  })().catch((error) => entered.reject(error));
  const dir = makeDataDir([
    { input: new Float32Array([0]), output: new Float32Array([1]) },
    { input: new Float32Array([1]), output: new Float32Array([0]) },
  ], 2);
  const creature = new Creature(1, 1);
  try {
    const result = await evolveDir(creature, dir, {
      threads: 2,
      heavyTaskWorkerCount: 1,
      populationSize: 4,
      iterations: 1,
      trainPerGen: 0,
      discoverySampleRate: 0,
      sparseRatio: 1,
      rustScorer: { enabled: false },
      exitOnUnreclaimableWorkers: false,
    }, {
      onNeatReady: (neat) => {
        const evolve = neat.evolve.bind(neat);
        neat.evolve = async (best) => {
          const trainingCreature = Creature.fromJSON(creature.exportJSON());
          const generation = await evolve(best);
          neat.scheduleTraining(trainingCreature, 5);
          const uuid = CreatureUtil.makeUUID(trainingCreature);
          const training = neat.trainingInProgress.get(uuid);
          const deadline = neat.trainingDeadlines.get(uuid);
          assert(
            training && deadline,
            "the production scheduler dispatched training",
          );
          // The outer harness signals only after C has entered its blocking call.
          await entered.promise;
          assertEquals(neat.abandonStuckTrainingTasks(deadline + 30_001), [
            uuid,
          ]);
          await training;
          assertEquals(neat.trainingInProgress.size, 0);
          console.log("TRAINING_QUARANTINED");
          return generation;
        };
      },
    });
    assert(Number.isFinite(result.score));
    assertEquals(result.generation, 1);
    console.log("EVOLVE_RETURNED");
    if (Deno.args.includes("--late-return")) await released.promise;
  } finally {
    watcher.close();
    await observeEntry;
    Deno.removeSignalListener("SIGUSR2", onReleased);
    await Deno.remove(dir, { recursive: true });
  }
  console.log("CALLER_LAST_STATEMENT");
}
