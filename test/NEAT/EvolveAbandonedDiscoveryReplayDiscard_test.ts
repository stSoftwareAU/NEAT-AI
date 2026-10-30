/**
 * Issue #4115: a discovery or replay creature that `processCompletedResults`
 * has already merged into the population must not vanish silently when the
 * hard deadline abandons the generation before it commits. Each discarded
 * discovery and replay is logged once, as `discarded`, by the ID or key that
 * `processCompletedResults` recorded.
 *
 * The abandon lands deterministically between `processCompletedResults` and
 * the commit guard: the hook sits on the first `Mutator.prototype.mutate` call
 * of the generation, which `evolve()` makes after result processing and before
 * the guard. The hard-deadline argument is a fixed past instant (no timing API
 * is used).
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Neat } from "../../src/NEAT/Neat.ts";
import { evolve } from "../../src/NEAT/NeatEvolution.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import type { DiscoveryReplayDirResult } from "../../src/discovery/DiscoveryReplayRunnerTypes.ts";
import type { ResponseData } from "../../src/multithreading/workers/WorkerHandler.ts";
import { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";
import { getLogger, type Logger, setLogger } from "../../src/utils/Logger.ts";

/** A fixed epoch-ms instant that is always in the past. */
const PAST_HARD_DEADLINE_MS = 1_000;

const DISCOVERY_ID = "abandoned-discovery";
const REPLAY_KEY = "abandoned-replay";

/**
 * Matches only the discard lines this change emits. A bare "discarded" search
 * also hits unrelated summaries such as `[MutationOps] ... discarded=0`.
 */
const DISCARDED_LINE = /^(Discovery|Replay) .* discarded: /;

interface CapturedLine {
  level: string;
  text: string;
}

function createTestDataDir(): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 20; i++) {
    records.push({
      input: new Float32Array([Math.random(), Math.random()]),
      output: new Float32Array([Math.random()]),
    });
  }
  return makeDataDir(records, 2000);
}

async function terminateWorkers(workers: WorkerHandler[]): Promise<void> {
  await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
  for (const w of workers) {
    w.terminate();
  }
}

/** A completed discovery result; `withCreature` controls whether it improved. */
function makeDiscoveryResult(withCreature: boolean): ResponseData {
  const discover: Record<string, unknown> = { ID: DISCOVERY_ID };
  if (withCreature) {
    discover.improvedCreature = new Creature(2, 1, { layers: [{ count: 3 }] })
      .exportJSON();
  }
  return {
    taskID: 1,
    duration: 1,
    discover,
  } as unknown as ResponseData;
}

/** A completed replay result carrying one improved creature. */
function makeReplayResult(): DiscoveryReplayDirResult {
  return {
    original: { error: 0.5, score: 0.5 },
    improvement: {
      key: REPLAY_KEY,
      changeType: "x",
      error: 0.1,
      score: 0.9,
      scoreDelta: 0.4,
      message: "replayed",
      creature: new Creature(2, 1, { layers: [{ count: 3 }] }).exportJSON(),
    },
    evaluatedSingles: 1,
    evaluatedCombos: 0,
    pruned: 0,
    skippedAlreadyApplied: 0,
    skippedNotApplicable: 0,
  };
}

/** Build a populated Neat with no results queued yet. */
async function buildNeat(
  workers: WorkerHandler[],
  verbose = false,
): Promise<Neat> {
  const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
  const neat = new Neat(2, 1, {
    creatures: [seedCreature.exportJSON()],
    populationSize: 10,
    elitism: 2,
    verbose,
  } as NeatOptions, workers);
  await neat.populatePopulation(seedCreature);
  return neat;
}

/** A logger that records every line with its level, minus ANSI colour codes. */
function captureLogger(captured: CapturedLine[]): Logger {
  // deno-lint-ignore no-control-regex
  const ansi = /\x1b\[[0-9;]*m/g;
  const at = (level: string) => (...args: unknown[]) => {
    captured.push({
      level,
      text: args.map(String).join(" ").replace(ansi, ""),
    });
  };
  return {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
  };
}

Deno.test(
  "evolve: a discovery and a replay discarded by a hard-deadline abandon are each logged once as discarded (Issue #4115)",
  async () => {
    const workers = [new WorkerHandler(createTestDataDir(), "MSE", true)];
    const previousLogger = getLogger();
    const originalMutate = Mutator.prototype.mutate;
    const captured: CapturedLine[] = [];
    let hookFired = false;

    try {
      const neat = await buildNeat(workers);
      neat.discoveryComplete.push(makeDiscoveryResult(true));
      const replayResult = makeReplayResult();
      neat.discoveryReplayQueue.getCompletedResults = () => [replayResult];
      // Members are identified by object reference after the run.
      const before = [...neat.population];

      Mutator.prototype.mutate = function (
        this: Mutator,
        creatures: Creature[],
      ): void {
        if (!hookFired) {
          hookFired = true;
          neat.generationsCompleted = 1;
          assert(
            neat.abandonInFlightPastHardDeadline(PAST_HARD_DEADLINE_MS),
            "the hard-deadline abandon must actually fire",
          );
        }
        originalMutate.call(this, creatures);
      };
      setLogger(captureLogger(captured));

      await evolve(neat);

      assert(hookFired, "the abandon must land before the commit guard");
      assert(
        captured.some((line) =>
          line.text.includes("abandoned past the hard deadline")
        ),
        "the generation must log that it was abandoned past the hard deadline",
      );
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Discovery ${DISCOVERY_ID} discarded`)
        ),
        [{
          level: "warn",
          text:
            `Discovery ${DISCOVERY_ID} discarded: generation abandoned past the hard deadline`,
        }],
        "the discarded discovery must be logged exactly once, as a warning",
      );
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Replay ${REPLAY_KEY} discarded`)
        ),
        [{
          level: "warn",
          text:
            `Replay ${REPLAY_KEY} discarded: generation abandoned past the hard deadline`,
        }],
        "the discarded replay must be logged exactly once, as a warning",
      );
      assertEquals(
        neat.population.length,
        before.length,
        "an abandoned generation must not change membership",
      );
      // Membership by reference: a committed generation would swap in bred and
      // merged creatures, which are new objects. Order is not asserted here
      // because fitness sorts neat.population in place before the commit guard.
      const members = new Set(before);
      assert(
        neat.population.every((c) => members.has(c)),
        "an abandoned generation must not replace neat.population's members",
      );
    } finally {
      Mutator.prototype.mutate = originalMutate;
      setLogger(previousLogger);
      await terminateWorkers(workers);
    }
  },
);

Deno.test(
  "evolve: a discovery and a replay merged in a generation that commits are not logged as discarded (Issue #4115)",
  async () => {
    const workers = [new WorkerHandler(createTestDataDir(), "MSE", true)];
    const previousLogger = getLogger();
    const captured: CapturedLine[] = [];

    try {
      // verbose logs the "Added ... creature" lines that prove both merged.
      const neat = await buildNeat(workers, true);
      neat.discoveryComplete.push(makeDiscoveryResult(true));
      neat.discoveryReplayQueue.getCompletedResults = () => [
        makeReplayResult(),
      ];
      setLogger(captureLogger(captured));

      await evolve(neat);

      assertEquals(
        captured.filter((line) =>
          line.text.includes("[Neat] Added discovered creature")
        ).length,
        1,
        "the discovery must be merged into the population",
      );
      assertEquals(
        captured.filter((line) =>
          line.text.includes("[Neat] Added replayed creature")
        ).length,
        1,
        "the replay must be merged into the population",
      );
      assertEquals(
        captured.filter((line) => DISCARDED_LINE.test(line.text)),
        [],
        "a generation that commits must not log any discarded line",
      );
    } finally {
      setLogger(previousLogger);
      await terminateWorkers(workers);
    }
  },
);

Deno.test(
  "evolve: a discovery with no improved creature discarded by a hard-deadline abandon logs no discarded line (Issue #4115)",
  async () => {
    const workers = [new WorkerHandler(createTestDataDir(), "MSE", true)];
    const previousLogger = getLogger();
    const originalMutate = Mutator.prototype.mutate;
    const captured: CapturedLine[] = [];
    let hookFired = false;

    try {
      const neat = await buildNeat(workers);
      // Nothing improved, so nothing is merged and nothing can be discarded.
      neat.discoveryComplete.push(makeDiscoveryResult(false));

      Mutator.prototype.mutate = function (
        this: Mutator,
        creatures: Creature[],
      ): void {
        if (!hookFired) {
          hookFired = true;
          neat.generationsCompleted = 1;
          assert(
            neat.abandonInFlightPastHardDeadline(PAST_HARD_DEADLINE_MS),
            "the hard-deadline abandon must actually fire",
          );
        }
        originalMutate.call(this, creatures);
      };
      setLogger(captureLogger(captured));

      await evolve(neat);

      assert(hookFired, "the abandon must land before the commit guard");
      assert(
        captured.some((line) =>
          line.text.includes("abandoned past the hard deadline")
        ),
        "the generation must log that it was abandoned past the hard deadline",
      );
      assertEquals(
        captured.filter((line) => DISCARDED_LINE.test(line.text)),
        [],
        "a discovery that merged no creature must not be logged as discarded",
      );
    } finally {
      Mutator.prototype.mutate = originalMutate;
      setLogger(previousLogger);
      await terminateWorkers(workers);
    }
  },
);
