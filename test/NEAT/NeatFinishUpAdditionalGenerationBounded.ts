/**
 * The additional-generation wait must terminate, and must not flood the log
 * while it waits (Issue #3823).
 *
 * GRQ-18 filled its disk twice in one day. `node.log` really had reached
 * 104,440,184 lines on one host and 99,063,629 on another, and ~99% of the
 * published tail was a single message:
 *
 *     $ grep -c "Waiting for additional generation" GRQ-18-sloth.log
 *     1980        # out of 2001 lines
 *
 * The ENOSPC then surfaced *from the logger itself*:
 *
 *     error: Uncaught (in promise) Error: No space left on device (os error 28)
 *         at Object.info (…/src/utils/Logger.ts:57:17)
 *         at Neat.finishUp (…/src/NEAT/Neat.ts:677:19)
 *         at Module.evolveDir (…/src/creature/CreatureTraining.ts:571:16)
 *
 * `additionalGenerationCount` is normally worked off by `evolve()`, which
 * decrements it at the top of each generation. But `CreatureTraining`'s
 * `while (true)` loop reaches `finishUp` from two branches that do NOT run a
 * generation — the `shouldStopStartingGenerations` branch and the `completed`
 * branch. Both do `finishUp` → `awaitInFlightTasks()` → loop, and
 * `awaitInFlightTasks()` returns immediately when nothing is in flight. Once
 * the run has stopped starting generations, therefore, nothing could ever
 * reach the decrement: `finishUp` logged and returned `false` forever, as fast
 * as the process could call `console.info`.
 *
 * These tests poll `finishUp` the way that loop does and assert the wait both
 * terminates and stays quiet.
 */

import { assert, assertEquals } from "@std/assert";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

function createTestDataDir(input: number, output: number): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 10; i++) {
    records.push({
      input: new Float32Array(
        Array.from({ length: input }, () => Math.random()),
      ),
      output: new Float32Array(
        Array.from({ length: output }, () => Math.random()),
      ),
    });
  }
  return makeDataDir(records, 2000);
}

function createTestWorkers(dataDir: string): WorkerHandler[] {
  return [new WorkerHandler(dataDir, "MSE", true)];
}

async function terminateWorkers(workers: WorkerHandler[]): Promise<void> {
  await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
  for (const w of workers) {
    w.terminate();
  }
}

/** Record every line the code under test logs, and stay silent otherwise. */
function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const previous = getLogger();
  const recorder: Logger = {
    debug: (...args: unknown[]) => lines.push(args.join(" ")),
    info: (...args: unknown[]) => lines.push(args.join(" ")),
    warn: (...args: unknown[]) => lines.push(args.join(" ")),
    error: (...args: unknown[]) => lines.push(args.join(" ")),
  };
  setLogger(recorder);
  return { lines, restore: () => setLogger(previous) };
}

/**
 * Poll `finishUp` the way CreatureTraining's loop does — nothing in flight, no
 * generation between calls — and report when it let go.
 */
function pollUntilDone(
  neat: Neat,
  maxPolls: number,
): { polls: number; finished: boolean } {
  for (let polls = 1; polls <= maxPolls; polls++) {
    if (neat.finishUp()) {
      return { polls, finished: true };
    }
  }
  return { polls: maxPolls, finished: false };
}

Deno.test("finishUp: the additional-generation wait terminates when no generation can run (Issue #3823)", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  // Installed AFTER construction: the Neat constructor installs its own logger
  // from the resolved config, which would replace an earlier recorder.
  let log = { lines: [] as string[], restore: () => {} };

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);
    log = captureLog();

    // The credit NeatEvolution grants at the end of a generation that produced
    // trained creatures.
    neat.additionalGenerationCount = 1;

    // 1000 polls stands in for "forever": pre-fix this loop never finished, and
    // GRQ-18 rode it to a hundred million log lines.
    const { polls, finished } = pollUntilDone(neat, 1000);

    assert(
      finished,
      "finishUp never let go — the additional-generation wait cannot terminate",
    );
    assert(
      polls <= 2,
      `expected the single granted credit to be consumed in one poll, took ${polls}`,
    );

    const waitLines = log.lines.filter((l) =>
      l.includes("Waiting for additional generation")
    );
    assertEquals(
      waitLines.length,
      1,
      `the wait logged ${waitLines.length} times for one credit:\n${
        waitLines.slice(0, 5).join("\n")
      }`,
    );
  } finally {
    log.restore();
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: log volume is bounded by the credits granted, not by poll count (Issue #3823)", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  // Installed AFTER construction: the Neat constructor installs its own logger
  // from the resolved config, which would replace an earlier recorder.
  let log = { lines: [] as string[], restore: () => {} };

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);
    log = captureLog();

    const credits = 5;
    neat.additionalGenerationCount = credits;

    const { polls, finished } = pollUntilDone(neat, 1000);

    assert(finished, "finishUp never let go after 1000 polls");
    assertEquals(
      polls,
      credits + 1,
      "each poll should consume exactly one credit, then finish",
    );

    const waitLines = log.lines.filter((l) =>
      l.includes("Waiting for additional generation")
    );
    assertEquals(
      waitLines.length,
      credits,
      "one line per credit consumed — never one line per poll",
    );
    // The remaining count is in the line, so a stalled wait is diagnosable
    // from the log without reading the source.
    assert(
      waitLines[0].includes("remaining"),
      `the wait line should carry the remaining count: ${waitLines[0]}`,
    );
    assertEquals(neat.additionalGenerationCount, 0);
  } finally {
    log.restore();
    await terminateWorkers(workers);
  }
});
