import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { Neat } from "@neat/Neat.ts";
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

/**
 * Issue #3823: regression — the over-run branch must not spin.
 *
 * `Neat.additionalGenerationCount` ("do at least one more loop") is set by
 * `evolve()` whenever trained creatures were folded in. Once the over-run
 * guard fires, `evolve()` is never called again, so nothing decremented the
 * counter, `finishUp()` refused to finish, and — with nothing in flight —
 * `awaitInFlightTasks()` returned immediately. The loop then spun at full
 * speed, flooding the log with `Waiting for additional generation` until the
 * hard deadline (up to the full 15-minute grace window).
 *
 * The clock advances 1ms per read so the pre-fix behaviour terminates at the
 * hard cap instead of hanging the suite; the assertion is on the number of
 * wait lines, which was in the hundreds before the fix and is at most one now.
 */
Deno.test({
  name:
    "over-run enforcement: a pending additional generation does not spin the finish-up loop",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-overrun-additional-generation-",
    });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    const startMS = Date.now();
    // Start inside the over-run window (expected 60s) but still one second
    // short of the hard cap at start + 120s.
    let nowMS = startMS;
    let neat: Neat | undefined;

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
          nowMS = startMS + 119_000;
          // Simulate the generation having folded in trained creatures.
          assert(neat, "onNeatReady must have run before the first generation");
          neat.additionalGenerationCount = 1;
        }
      },
    };

    const deps: EvolveDirDeps = {
      startTimeMS: startMS,
      // Advance a millisecond per read: harmless for the fixed path (a couple
      // of reads), and a bounded escape hatch for the pre-fix spin.
      now: () => ++nowMS,
      overrunEnforcementFactor: 1,
      onNeatReady: (n) => {
        neat = n;
      },
    };

    const priorLogger = getLogger();
    try {
      const result = await evolveDir(creature, dataSetDir, options, deps);

      const waitLines = lines.filter((line) =>
        line.includes("Waiting for additional generation")
      );
      assert(
        waitLines.length <= 1,
        `finish-up must not spin on a pending additional generation — got ${waitLines.length} wait log lines`,
      );
      assertEquals(
        result.terminationReason,
        "overrun",
        "the run must still end via graceful over-run self-termination",
      );
      assert(
        Number.isFinite(result.score),
        "evolved population must commit a finite best score",
      );
    } finally {
      setLogger(priorLogger);
      await Deno.remove(dataSetDir, { recursive: true });
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});
