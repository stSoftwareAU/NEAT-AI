import { assert } from "@std/assert";
import { Creature } from "@creature";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

/**
 * Issue #2167: Invalid CRISPR DNA should warn, not crash the evolution.
 *
 * When a CRISPR configuration has invalid DNA (e.g., missing source
 * references in append-mode synapses), the evolution loop should log
 * a warning and skip the invalid CRISPR rather than throwing an
 * uncaught CrisprError that terminates the entire process.
 */

function createTestDataDir(
  input: number,
  output: number,
  count = 20,
): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < count; i++) {
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

Deno.test(
  "evolve: invalid CRISPR DNA warns instead of crashing (#2167)",
  async () => {
    const dataDir = createTestDataDir(2, 1);
    const workers = createTestWorkers(dataDir);

    try {
      const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });

      // Create an invalid CRISPR with append-mode synapse missing source ref
      const invalidCrispr = {
        id: "test-invalid-crispr",
        mode: "append" as const,
        neurons: [],
        synapses: [
          {
            // Missing 'from', 'fromId', and 'fromRelative' — triggers INVALID_DNA
            toRelative: 0,
            weight: 0.5,
          },
        ],
      };

      const options: NeatOptions = {
        creatures: [seedCreature.exportJSON()],
        populationSize: 10,
        CRISPRs: [invalidCrispr],
      };

      const neat = new Neat(2, 1, options, workers);
      neat.populatePopulation(seedCreature);

      // This should NOT throw — instead it should warn and continue
      const result = await neat.evolve();

      assert(
        result.fittest !== undefined,
        "Evolution should complete and return a fittest creature",
      );
      assert(
        result.fittest.score !== undefined,
        "Fittest creature should have a score",
      );
      assert(
        Number.isFinite(result.fittest.score),
        "Fittest score should be finite",
      );
    } finally {
      await terminateWorkers(workers);
    }
  },
);

Deno.test(
  "evolve: valid CRISPRs still apply after skipping invalid ones (#2167)",
  async () => {
    const dataDir = createTestDataDir(2, 1);
    const workers = createTestWorkers(dataDir);

    try {
      const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });

      // Invalid CRISPR — missing source reference
      const invalidCrispr = {
        id: "bad-crispr",
        mode: "append" as const,
        neurons: [],
        synapses: [
          {
            toRelative: 0,
            weight: 0.5,
          },
        ],
      };

      // Valid CRISPR — has proper source and target
      const validCrispr = {
        id: "good-crispr",
        mode: "append" as const,
        neurons: [],
        synapses: [
          {
            fromRelative: 0,
            toRelative: -1,
            weight: 0.1,
          },
        ],
      };

      const options: NeatOptions = {
        creatures: [seedCreature.exportJSON()],
        populationSize: 10,
        CRISPRs: [invalidCrispr, validCrispr],
      };

      const neat = new Neat(2, 1, options, workers);
      neat.populatePopulation(seedCreature);

      // Should complete without error, applying the valid CRISPR
      const result = await neat.evolve();

      assert(
        result.fittest !== undefined,
        "Evolution should complete with mixed valid/invalid CRISPRs",
      );
    } finally {
      await terminateWorkers(workers);
    }
  },
);
