/**
 * Issue #4115: `processCompletedResults` records the identity of each discovery
 * and replay creature it merges, so an abandoned generation can name what it
 * discards. A result that merges nothing records nothing.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Neat } from "../../src/NEAT/Neat.ts";
import {
  type MergedExternalResults,
  processCompletedResults,
} from "../../src/NEAT/ProcessCompletedResults.ts";
import type { DiscoveryReplayDirResult } from "../../src/discovery/DiscoveryReplayRunnerTypes.ts";
import type { ResponseData } from "../../src/multithreading/workers/WorkerHandler.ts";
import { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";

const DISCOVERY_ID = "merged-discovery";
const REPLAY_KEY = "merged-replay";

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

function seed(): Creature {
  return new Creature(2, 1, { layers: [{ count: 3 }] });
}

function discoveryResult(withCreature: boolean): ResponseData {
  const discover: Record<string, unknown> = { ID: DISCOVERY_ID };
  if (withCreature) discover.improvedCreature = seed().exportJSON();
  return { taskID: 1, duration: 1, discover } as unknown as ResponseData;
}

function replayResult(key: string | undefined): DiscoveryReplayDirResult {
  return {
    original: { error: 0.5, score: 0.5 },
    improvement: {
      key,
      changeType: "x",
      error: 0.1,
      score: 0.9,
      scoreDelta: 0.4,
      message: "replayed",
      creature: seed().exportJSON(),
    },
    evaluatedSingles: 1,
    evaluatedCombos: 0,
    pruned: 0,
    skippedAlreadyApplied: 0,
    skippedNotApplicable: 0,
  } as unknown as DiscoveryReplayDirResult;
}

async function withNeat(
  run: (neat: Neat, fittest: Creature) => void,
): Promise<void> {
  const workers = [new WorkerHandler(createTestDataDir(), "MSE", true)];
  try {
    const fittest = seed();
    const neat = new Neat(2, 1, {
      creatures: [fittest.exportJSON()],
      populationSize: 10,
      elitism: 2,
    } as NeatOptions, workers);
    await neat.populatePopulation(fittest);
    run(neat, neat.population[0]);
  } finally {
    await terminateWorkers(workers);
  }
}

function emptySink(): MergedExternalResults {
  return { discoveryIDs: [], replayKeys: [] };
}

Deno.test("processCompletedResults: a merged discovery and replay are recorded by ID and key (Issue #4115)", async () => {
  await withNeat((neat, fittest) => {
    neat.discoveryComplete.push(discoveryResult(true));
    const replay = replayResult(REPLAY_KEY);
    neat.discoveryReplayQueue.getCompletedResults = () => [replay];

    const merged = emptySink();
    const creatures = processCompletedResults(
      neat,
      fittest,
      {} as never,
      merged,
    );

    assertEquals(creatures.length, 2);
    assertEquals(merged, {
      discoveryIDs: [DISCOVERY_ID],
      replayKeys: [REPLAY_KEY],
    });
  });
});

Deno.test("processCompletedResults: a replay without a key is recorded as 'replay' (Issue #4115)", async () => {
  await withNeat((neat, fittest) => {
    const replay = replayResult(undefined);
    neat.discoveryReplayQueue.getCompletedResults = () => [replay];

    const merged = emptySink();
    processCompletedResults(neat, fittest, {} as never, merged);

    assertEquals(merged, { discoveryIDs: [], replayKeys: ["replay"] });
  });
});

Deno.test("processCompletedResults: a discovery with no improved creature records nothing (Issue #4115)", async () => {
  await withNeat((neat, fittest) => {
    neat.discoveryComplete.push(discoveryResult(false));
    neat.discoveryReplayQueue.getCompletedResults = () => [];

    const merged = emptySink();
    const creatures = processCompletedResults(
      neat,
      fittest,
      {} as never,
      merged,
    );

    assertEquals(creatures.length, 0);
    assertEquals(merged, emptySink());
  });
});
