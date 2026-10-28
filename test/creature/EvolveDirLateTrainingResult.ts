import { assert, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #4099 (PR #4104 review): end-to-end guard that a training result which
 * settles after the final generation's `processCompletedResults()` but before
 * `finishUp()` is merged by a further `evolve()` and persisted — not dropped at
 * teardown.
 *
 * The result is settled through the production hook
 * (`Neat.recordTrainingComplete`) from a wrapper around the captured
 * `neat.evolve`, immediately after the last scheduled generation returns. The
 * assertions are on outcomes only: the completion log line, the absence of a
 * discard line, and the trained creature in the returned population and in the
 * creature store.
 */

const TRAIN_ID = "late4099";
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

Deno.test({
  name:
    "evolveDir: a training result settled after the last generation is merged and persisted, not discarded (Issue #4099)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const { json: trainedJSON, value } = constantCreature();
    const dataSetDir = makeDataDir(constantDataSet(value), 2000);
    const creatureStore = await Deno.makeTempDir({ prefix: "neat-4099-" });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    const lines: string[] = [];
    const warnings: string[] = [];
    const previousLogger = getLogger();
    let captured: Neat | undefined;
    let evolveCalls = 0;
    let settled = false;

    const options: NeatOptions = {
      populationSize: 10,
      iterations: 1,
      threads: 1,
      verbose: false,
      creatureStore,
    };

    try {
      const result = await evolveDir(creature, dataSetDir, options, {
        onNeatReady: (neat) => {
          captured = neat;
          // Installed after construction: the Neat constructor resets the logger.
          const recorder: Logger = {
            debug: (...a: unknown[]) => lines.push(a.join(" ")),
            info: (...a: unknown[]) => lines.push(a.join(" ")),
            warn: (...a: unknown[]) => {
              warnings.push(a.join(" "));
              lines.push(a.join(" "));
            },
            error: (...a: unknown[]) => lines.push(a.join(" ")),
          };
          setLogger(recorder);

          const realEvolve = neat.evolve.bind(neat);
          neat.evolve = async (...args: Parameters<Neat["evolve"]>) => {
            const out = await realEvolve(...args);
            evolveCalls++;
            if (evolveCalls === 1) {
              // The last scheduled generation (iterations = 1) has just run its
              // processCompletedResults(); the training task settles now.
              neat.trainingInProgress.set(TRAIN_UUID, Promise.resolve());
              settled = neat.recordTrainingComplete(
                TRAIN_UUID,
                neat.abandonEpoch,
                {
                  taskID: 1,
                  duration: 1,
                  train: {
                    ID: TRAIN_ID,
                    creature: trainedJSON,
                    error: 0.5,
                  },
                } as never,
              );
            }
            return out;
          };
        },
      });

      assert(settled, "the late training result must have been recorded");
      assert(captured, "onNeatReady must have handed back the Neat instance");
      assert(
        evolveCalls >= 2,
        `a settled-but-unmerged result must lead to another evolve(); got ${evolveCalls} call(s)`,
      );
      assert(
        result.terminationReason !== "overrun" &&
          result.terminationReason !== "hard-deadline",
        `the run must finish normally; got ${result.terminationReason}`,
      );

      const plain = stripAnsi(lines.join("\n"));
      assert(
        new RegExp(`Training\\s+${TRAIN_ID}\\s+completed`).test(plain),
        `the late result must be logged as completed; got: ${plain}`,
      );
      assert(
        !warnings.some((w) => w.includes("discarded at teardown")),
        `nothing may be discarded on a normal finish; got: ${
          warnings.join(" | ")
        }`,
      );
      assertEquals(captured.trainingComplete.length, 0);

      // The merged creature reaches the population and the creature store.
      assert(
        captured.population.some((c) => getTag(c, "trainID") === TRAIN_ID),
        "the trained creature must be in the returned population",
      );
      const stored = await loadStoredCreatures(creatureStore);
      assert(
        stored.some((c) => getTag(c, "trainID") === TRAIN_ID),
        "the trained creature must be persisted to the creature store",
      );
    } finally {
      setLogger(previousLogger);
      await Deno.remove(dataSetDir, { recursive: true });
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
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
