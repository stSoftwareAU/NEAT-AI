import { assert, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import {
  type ResponseData,
  WorkerHandler,
} from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #4099: drive the scheduler and worker-response handler through evolveDir.
 * The worker promise settles after the last requested generation returns, before
 * finishUp decides whether a final result-processing generation is necessary.
 */

const TRAIN_UUID = "late-task-4099";

/**
 * A constant-output dataset the `trained` creature below fits exactly, so it is
 * the strictly best (and smallest) creature once re-scored and always survives
 * selection — the assertion on the population does not depend on random culling.
 */
function constantDataSet(value: number): DataRecordInterface[] {
  return [[0, 0], [0, 1], [1, 0], [1, 1]].map((input) => ({
    input: new Float32Array(input),
    output: new Float32Array([value]),
  }));
}

/** A 2-in/1-out creature whose every synapse weight is zero: a constant output. */
function constantCreature(): {
  json: ReturnType<Creature["exportJSON"]>;
  value: number;
} {
  const c = new Creature(2, 1);
  const json = c.exportJSON();
  for (const s of json.synapses) s.weight = 0;
  const value = Creature.fromJSON(json).activate(new Float32Array([0, 0]))[0];
  return { json, value };
}

function stripAnsi(text: string): string {
  return text.replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
    "",
  );
}

/** Every stored creature in a `creatureStore` directory. */
async function loadStoredCreatures(dir: string): Promise<Creature[]> {
  const creatures: Creature[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const json = JSON.parse(await Deno.readTextFile(`${dir}/${entry.name}`));
    creatures.push(Creature.fromJSON(json));
  }
  return creatures;
}

async function checkLateWorkerResult(
  traceWriteFailure: boolean,
): Promise<void> {
  await initWasmForTests();
  const { json: trainedJSON, value } = constantCreature();
  const dataSetDir = makeDataDir(constantDataSet(value), 2000);
  const creatureStore = await Deno.makeTempDir({ prefix: "neat-4099-" });
  const traceStore = traceWriteFailure
    ? await Deno.makeTempFile({ prefix: "neat-trace-4099-" })
    : undefined;
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  const lines: string[] = [];
  const previousLogger = getLogger();
  const originalTrainTracked = WorkerHandler.prototype.trainTracked;
  const originalTrain = WorkerHandler.prototype.train;
  let captured: Neat | undefined;
  let resolveTraining!: (response: ResponseData) => void;
  const response = new Promise<ResponseData>((resolve) => {
    resolveTraining = resolve;
  });
  let taskID: string | undefined;

  // Stub only the external training boundary; population scoring, selection,
  // scheduling, the response handler, final commit and persistence all run.
  const train = (_creature: Creature, _options: unknown, label?: string) => {
    taskID = (label ?? _creature.uuid!).slice(-8);
    return response;
  };
  WorkerHandler.prototype.trainTracked = function (
    c: Creature,
    options: unknown,
    label?: string,
  ) {
    return { taskID: 4099, response: train(c, options, label) };
  };
  // v7.0.62 dispatched with train(); keep the identical boundary regression
  // usable against that release as well as the tracked-dispatch implementation.
  WorkerHandler.prototype.train = train;

  const options: NeatOptions = {
    populationSize: 10,
    iterations: 1,
    trainPerGen: 1,
    threads: 1,
    verbose: false,
    creatureStore,
    ...(traceStore ? { traceStore } : {}),
  };

  try {
    const result = await evolveDir(creature, dataSetDir, options, {
      onNeatReady: (neat) => {
        captured = neat;
        const recorder: Logger = {
          debug: (...a: unknown[]) => lines.push(a.join(" ")),
          info: (...a: unknown[]) => lines.push(a.join(" ")),
          warn: (...a: unknown[]) => lines.push(a.join(" ")),
          error: (...a: unknown[]) => lines.push(a.join(" ")),
        };
        setLogger(recorder);

        const realEvolve = neat.evolve.bind(neat);
        let finalRequestedGeneration = true;
        neat.evolve = async (...args: Parameters<Neat["evolve"]>) => {
          const out = await realEvolve(...args);
          if (finalRequestedGeneration) {
            finalRequestedGeneration = false;
            assert(
              taskID,
              "the last requested generation must schedule training",
            );
            resolveTraining({
              taskID: 4099,
              duration: 1,
              train: {
                ID: taskID,
                creature: trainedJSON,
                error: 0,
                ...(traceWriteFailure ? { trace: trainedJSON } : {}),
              },
            } as ResponseData);
            // The production response handler registered before this await;
            // let it receive the result before evolveDir reaches finishUp.
            await response;
          }
          return out;
        };
      },
    });

    assert(captured, "the run must construct a population");
    assert(taskID, "a worker training task must have been dispatched");
    assert(
      result.terminationReason !== "overrun" &&
        result.terminationReason !== "hard-deadline",
      `the run must finish normally; got ${result.terminationReason}`,
    );
    const plain = stripAnsi(lines.join("\n"));
    assertEquals(
      plain.split("\n").filter((line) =>
        new RegExp(`Training\\s+${taskID}\\s+completed`).test(line)
      ).length,
      1,
      `the worker result must have exactly one completion; got: ${plain}`,
    );
    assert(
      !plain.includes(`Training failed for creature ${taskID}`),
      `a successful training task must not be reported as failed; got: ${plain}`,
    );
    assert(
      !plain.includes(`Training ${taskID} discarded`),
      `the late result must not be discarded; got: ${plain}`,
    );
    if (traceWriteFailure) {
      assert(
        plain.includes(`Training trace persistence failed for ${taskID}`),
        `the trace write fault must be reported independently; got: ${plain}`,
      );
    }
    const stored = await loadStoredCreatures(creatureStore);
    assert(
      stored.some((c) => getTag(c, "trainID") === taskID),
      "the late worker result must reach the persisted creature store",
    );
    assert(
      captured.population.some((c) => getTag(c, "trainID") === taskID),
      "the late worker result must reach the returned population",
    );
  } finally {
    WorkerHandler.prototype.trainTracked = originalTrainTracked;
    WorkerHandler.prototype.train = originalTrain;
    setLogger(previousLogger);
    await Deno.remove(dataSetDir, { recursive: true });
    await Deno.remove(creatureStore, { recursive: true });
    if (traceStore) await Deno.remove(traceStore);
  }
}

Deno.test({
  name:
    "evolveDir: a worker training promise settled after the last generation is merged and persisted (Issue #4099)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => checkLateWorkerResult(false),
});

Deno.test({
  name:
    "evolveDir: trace persistence failure preserves one completed training outcome (Issue #4099)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => checkLateWorkerResult(true),
});

Deno.test({
  name:
    "evolveDir: a SIGTERM stop names a training task still in flight instead of leaving it silent (Issue #4099)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const { value } = constantCreature();
    const dataSetDir = makeDataDir(constantDataSet(value), 2000);
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    const warnings: string[] = [];
    const previousLogger = getLogger();
    const realAddSignalListener = Deno.addSignalListener;
    let sigtermListener: (() => void) | undefined;
    let captured: Neat | undefined;
    let evolveCalls = 0;

    // Capture the handler so the stop is delivered deterministically, without a
    // real signal or a wait.
    Deno.addSignalListener = ((
      signal: Deno.Signal,
      handler: () => void,
    ) => {
      if (signal === "SIGTERM") sigtermListener = handler;
      return realAddSignalListener(signal, handler);
    }) as typeof Deno.addSignalListener;

    try {
      await evolveDir(creature, dataSetDir, {
        populationSize: 10,
        iterations: 50,
        threads: 1,
        verbose: true,
      }, {
        onNeatReady: (neat) => {
          captured = neat;
          setLogger({
            debug: () => {},
            info: () => {},
            warn: (...a: unknown[]) => warnings.push(a.join(" ")),
            error: () => {},
          });

          const realEvolve = neat.evolve.bind(neat);
          neat.evolve = async (...args: Parameters<Neat["evolve"]>) => {
            const out = await realEvolve(...args);
            evolveCalls++;
            if (evolveCalls === 1) {
              // A task is scheduled and still pending when the stop arrives.
              neat.trainingInProgress.set(
                TRAIN_UUID,
                new Promise<void>(() => {}),
              );
              assert(sigtermListener, "evolveDir must listen for SIGTERM");
              sigtermListener();
            }
            return out;
          };
        },
      });

      assertEquals(
        evolveCalls,
        1,
        "the interrupted stop must break out of the loop after one generation",
      );
      assert(captured, "onNeatReady must have handed back the Neat instance");
      const plain = stripAnsi(warnings.join("\n"));
      assert(
        plain.includes(
          `Training ${
            TRAIN_UUID.substring(TRAIN_UUID.length - 8)
          } abandoned at teardown`,
        ),
        `the in-flight task must be named as abandoned; got: ${plain}`,
      );
      assertEquals(captured.trainingInProgress.size, 0);
    } finally {
      Deno.addSignalListener = realAddSignalListener;
      setLogger(previousLogger);
      await Deno.remove(dataSetDir, { recursive: true });
    }
  },
});
