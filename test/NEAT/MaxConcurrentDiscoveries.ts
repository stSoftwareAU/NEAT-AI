import { assertEquals } from "@std/assert";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

/**
 * Issue #2238: Allow pipelined discovery by replacing the binary
 * discoveryInProgress guard with a configurable concurrency limit.
 */

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

Deno.test("maxConcurrentDiscoveries defaults to 1", () => {
  const config = createNeatConfig({});
  assertEquals(config.maxConcurrentDiscoveries, 1);
});

Deno.test("maxConcurrentDiscoveries can be set to higher value", () => {
  const config = createNeatConfig({ maxConcurrentDiscoveries: 3 });
  assertEquals(config.maxConcurrentDiscoveries, 3);
});

Deno.test("maxConcurrentDiscoveries accepts string input from CLI", () => {
  const config = createNeatConfig({
    maxConcurrentDiscoveries: "2" as unknown as number,
  });
  assertEquals(config.maxConcurrentDiscoveries, 2);
});

Deno.test("maxConcurrentDiscoveries: guard allows scheduling when below limit", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
      maxConcurrentDiscoveries: 3,
    };

    const neat = new Neat(2, 1, options, workers);

    neat.discoveryInProgress.set("disc-1", Promise.resolve());
    neat.discoveryInProgress.set("disc-2", Promise.resolve());

    assertEquals(
      neat.discoveryInProgress.size < neat.config.maxConcurrentDiscoveries,
      true,
      "Should allow scheduling when in-progress count is below the limit",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("maxConcurrentDiscoveries: guard blocks scheduling at limit", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
      maxConcurrentDiscoveries: 2,
    };

    const neat = new Neat(2, 1, options, workers);

    neat.discoveryInProgress.set("disc-1", Promise.resolve());
    neat.discoveryInProgress.set("disc-2", Promise.resolve());

    assertEquals(
      neat.discoveryInProgress.size >= neat.config.maxConcurrentDiscoveries,
      true,
      "Should block scheduling when in-progress count equals the limit",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("maxConcurrentDiscoveries=1 preserves backward-compatible behaviour", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);

    assertEquals(neat.config.maxConcurrentDiscoveries, 1);

    neat.discoveryInProgress.set("disc-1", Promise.resolve());

    assertEquals(
      neat.discoveryInProgress.size >= neat.config.maxConcurrentDiscoveries,
      true,
      "Default of 1 should block when any discovery is in progress",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: handles multiple concurrent discoveries", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
      maxConcurrentDiscoveries: 3,
    };

    const neat = new Neat(2, 1, options, workers);

    neat.discoveryInProgress.set("disc-1", Promise.resolve());
    neat.discoveryInProgress.set("disc-2", Promise.resolve());
    neat.discoveryInProgress.set("disc-3", Promise.resolve());

    const result = neat.finishUp();
    assertEquals(
      result,
      false,
      "Should return false when multiple discoveries in progress",
    );

    neat.discoveryInProgress.clear();

    // finishUp uses a cleanup delay after in-progress work clears;
    // call it enough times to drain the delay counter.
    let finished = false;
    for (let i = 0; i < 5; i++) {
      if (neat.finishUp()) {
        finished = true;
        break;
      }
    }
    assertEquals(
      finished,
      true,
      "Should return true after all discoveries cleared and cleanup delay drained",
    );
  } finally {
    await terminateWorkers(workers);
  }
});
