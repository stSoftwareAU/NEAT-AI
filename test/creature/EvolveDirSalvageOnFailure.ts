import { assert, assertRejects } from "@std/assert";
import { Creature } from "@creature";
import type { Neat } from "@neat/Neat.ts";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { EvolveDirDeps } from "@creature/CreatureTraining.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { ScorerStrictError } from "@errors/ScorerStrictError.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * GRQ #4418: a `ScorerStrictError` raised mid-run used to escape `evolveDir`
 * as an unhandled rejection — the run's workers, checkpoint and champion
 * restore were all skipped, so the completed generations were lost and the
 * task only learnt of the failure when the wall-clock cap killed it hours
 * later.
 *
 * The failure must stay loud (it still propagates) *and* the models already
 * evolved must be salvaged to the creature store first.
 */

function tinyDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

function makeRecordingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (...args) => lines.push(args.join(" ")),
    info: (...args) => lines.push(args.join(" ")),
    warn: (...args) => lines.push(args.join(" ")),
    error: (...args) => lines.push(args.join(" ")),
  };
  return { logger, lines };
}

async function storedCreatureCount(dir: string): Promise<number> {
  let count = 0;
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".json")) count++;
  }
  return count;
}

Deno.test({
  name:
    "evolveDir: a scorer failure mid-run fails loud and still salvages the evolved models",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-evolve-salvage-",
    });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    const { logger, lines } = makeRecordingLogger();
    const options: NeatOptions = {
      populationSize: 6,
      iterations: 8,
      timeoutMinutes: 5,
      threads: 1,
      creatureStore,
      logger,
    };

    // The second generation's fitness raises the exact failure GRQ-26 saw.
    const scorerFailure = new ScorerStrictError(
      "Rust scorer batch call failed (exit 158) for 4 creature(s)",
      "EXEC_FAILURE",
      { exitCode: 158 },
    );
    const deps: EvolveDirDeps = {
      onNeatReady: (neat: Neat) => {
        const original = neat.fitness.calculate.bind(neat.fitness);
        let calls = 0;
        neat.fitness.calculate = (population, additionalWorkers, signal) => {
          calls++;
          if (calls > 1) return Promise.reject(scorerFailure);
          return original(population, additionalWorkers, signal);
        };
      },
    };

    const priorLogger = getLogger();
    try {
      const thrown = await assertRejects(
        () => evolveDir(creature, dataSetDir, options, deps),
        ScorerStrictError,
      );
      assert(
        thrown === scorerFailure,
        "the scorer's own diagnostic must reach the caller unchanged",
      );

      assert(
        await storedCreatureCount(creatureStore) > 0,
        "models evolved before the failure must be checked in, not lost",
      );

      const joined = lines.join("\n");
      assert(
        joined.includes("ScorerStrictError") ||
          joined.includes("exit 158"),
        `the failure must be logged loudly by the run, got: ${joined}`,
      );
    } finally {
      setLogger(priorLogger);
      await Deno.remove(dataSetDir, { recursive: true });
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});
