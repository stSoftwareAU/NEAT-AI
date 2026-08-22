/**
 * The additional-generation wait must not flood the log while it waits
 * (Issue #3823 / GRQ#4284).
 *
 * #3823 fixed the spin itself — `finishUp` now drains
 * `additionalGenerationCount` in its wait branch — and
 * `test/NEAT/NeatFinishUp.ts` locks that the wait clears without another
 * `evolve()` call. What that leaves uncovered is the property the GRQ fleet
 * actually paid for: the **log volume**.
 *
 * GRQ-18 filled its disk twice in one day. `node.log` really had reached
 * 104,440,184 lines on one host and 99,063,629 on another, and ~99% of the
 * published tail was this one message:
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
 * Both hosts burned all three sampler attempts and produced nothing. So the
 * assertion that matters here is a count of lines, not a count of calls: one
 * line per credit consumed, never one line per poll.
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

const WAIT_MESSAGE = "Waiting for additional generation";

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

Deno.test("finishUp: the wait logs once per credit, not once per poll (#3823, GRQ#4284)", async () => {
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

    // Poll the way CreatureTraining's loop does: nothing in flight, and no
    // generation between calls. 1000 stands in for "forever" — pre-#3823 this
    // loop never finished, and GRQ-18 rode it to a hundred million log lines.
    let polls = 0;
    let finished = false;
    while (polls < 1000) {
      polls++;
      if (neat.finishUp()) {
        finished = true;
        break;
      }
    }
    assert(finished, "finishUp never let go after 1000 polls");

    const waitLines = log.lines.filter((l) => l.includes(WAIT_MESSAGE));
    assertEquals(
      waitLines.length,
      credits,
      `the wait logged ${waitLines.length} lines for ${credits} credits over ` +
        `${polls} polls — it must be bounded by the credits, not the polls`,
    );
  } finally {
    log.restore();
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: a wait with no credits logs nothing at all (#3823, GRQ#4284)", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  let log = { lines: [] as string[], restore: () => {} };

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);
    log = captureLog();

    for (let i = 0; i < 50; i++) neat.finishUp();

    assertEquals(
      log.lines.filter((l) => l.includes(WAIT_MESSAGE)).length,
      0,
      "a finished run must not log the wait message at all",
    );
  } finally {
    log.restore();
    await terminateWorkers(workers);
  }
});
