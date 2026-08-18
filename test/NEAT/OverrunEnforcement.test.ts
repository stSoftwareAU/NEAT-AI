import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { EvolveDirDeps } from "@creature/CreatureTraining.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Over-run enforcement (GRQ #4141): when elapsed exceeds expected duration
 * (`timeoutMinutes`) by the configured factor, stop starting new generations
 * and finish cleanly with the evolved population committed. The exit path
 * must be graceful self-termination, not the T+15 hard-deadline / wall-clock
 * cap branch.
 *
 * Clock is injected (#2888) — no elapsed-time measurement in assertions.
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
    "over-run enforcement: elapsed past expected × factor stops new generations and finishes cleanly",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-overrun-enforcement-",
    });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    // Anchor at the real wall clock so finishGeneration's Date.now() timedOut
    // check stays false (a few milliseconds of real work). The injected clock
    // then jumps past expected (1 min) without crossing the T+15 hard cap
    // (1 min + 1 min grace).
    const startMS = Date.now();
    let nowMS = startMS;

    const { logger, lines } = makeRecordingLogger();
    const options: NeatOptions = {
      populationSize: 6,
      iterations: 8,
      timeoutMinutes: 1,
      threads: 1,
      creatureStore,
      logger,
      onTrainingEvent: (event) => {
        if (event.kind === "generation_complete" && event.generation === 1) {
          // Mid-run: elapsed = 90s > expected 60s × factor 1, but still
          // before the hard cap at start + 120s.
          nowMS = startMS + 90_000;
        }
      },
    };

    const deps: EvolveDirDeps = {
      startTimeMS: startMS,
      now: () => nowMS,
      overrunEnforcementFactor: 1,
    };

    const priorLogger = getLogger();
    try {
      const result = await evolveDir(creature, dataSetDir, options, deps);

      assertEquals(
        result.generation,
        1,
        "no new generation may start after the over-run threshold",
      );
      assertEquals(
        result.terminationReason,
        "overrun",
        "exit path must be graceful over-run self-termination, not the deadline/cap",
      );
      assert(
        Number.isFinite(result.score),
        "evolved population must commit a finite best score",
      );

      const stored = await loadStoredCreatures(creatureStore);
      assert(
        stored.length > 0,
        "creatureStore must contain the committed population",
      );

      const joined = lines.join("\n");
      assert(
        joined.includes("Training over-run"),
        "the over-run self-termination path must be logged",
      );
      assert(
        !joined.includes("Hard deadline (timeoutMinutes + grace) exceeded"),
        "the T+15 hard-deadline / cap branch must not be the terminating mechanism",
      );
    } finally {
      setLogger(priorLogger);
      await Deno.remove(dataSetDir, { recursive: true });
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});
