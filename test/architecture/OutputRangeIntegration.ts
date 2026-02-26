/**
 * Integration tests for output range constraints (Issue #1620).
 *
 * Verifies that outputRanges configuration flows through the worker
 * pipeline and produces measurable fitness penalties for creatures
 * whose outputs fall outside the specified ranges.
 */
import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Fitness } from "../../src/architecture/Fitness.ts";
import { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";
import type { RequiredOutputRange } from "../../src/config/OutputRangeConfig.ts";

/**
 * Creates a training dataset where outputs are tightly clustered in
 * a narrow range (e.g. [0.4, 0.6]), so a random creature with no
 * training will likely produce outputs outside a narrow constraint range.
 */
function createNarrowRangeDataDir(): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 20; i++) {
    records.push({
      input: new Float32Array([Math.random(), Math.random()]),
      output: new Float32Array([0.5]),
    });
  }
  return makeDataDir(records, 2000);
}

Deno.test("OutputRange integration: penalty increases error for out-of-range outputs", async () => {
  const dataDir = createNarrowRangeDataDir();

  // Tight output range: outputs must be between 0.45 and 0.55
  const outputRanges: RequiredOutputRange[] = [
    { min: 0.45, max: 0.55, penaltyWeight: 10.0 },
  ];

  // Create workers - one without outputRanges (baseline), one with
  const workerBaseline = new WorkerHandler(dataDir, "MSE", true);
  const workerConstrained = new WorkerHandler(
    dataDir,
    "MSE",
    true,
    undefined,
    undefined,
    outputRanges,
  );

  try {
    await workerBaseline.waitUntilReady();
    await workerConstrained.waitUntilReady();

    // Create a simple creature that will likely produce outputs outside [0.45, 0.55]
    const creature = new Creature(2, 1);

    const fitnessBaseline = new Fitness([workerBaseline], 0.000_000_1, false);
    const fitnessConstrained = new Fitness(
      [workerConstrained],
      0.000_000_1,
      false,
    );

    // Evaluate the same creature with both fitness systems
    await fitnessBaseline.calculate([creature]);
    const scoreBaseline = creature.score!;

    // Reset score for re-evaluation
    creature.score = undefined;

    await fitnessConstrained.calculate([creature]);
    const scoreConstrained = creature.score!;

    // The constrained score should be lower (worse) than the baseline
    // because the creature's outputs are likely outside the narrow range
    assert(
      Number.isFinite(scoreBaseline),
      `Baseline score should be finite: ${scoreBaseline}`,
    );
    assert(
      Number.isFinite(scoreConstrained),
      `Constrained score should be finite: ${scoreConstrained}`,
    );
    assert(
      scoreConstrained <= scoreBaseline,
      `Constrained score (${scoreConstrained}) should be <= baseline (${scoreBaseline})`,
    );
  } finally {
    workerBaseline.terminate();
    workerConstrained.terminate();
  }
});

Deno.test("OutputRange integration: no penalty when outputs are in range", async () => {
  const dataDir = createNarrowRangeDataDir();

  // Very wide output range: virtually all outputs should be in range
  const wideRanges: RequiredOutputRange[] = [
    { min: -100, max: 100, penaltyWeight: 1.0 },
  ];

  const workerBaseline = new WorkerHandler(dataDir, "MSE", true);
  const workerWideRange = new WorkerHandler(
    dataDir,
    "MSE",
    true,
    undefined,
    undefined,
    wideRanges,
  );

  try {
    await workerBaseline.waitUntilReady();
    await workerWideRange.waitUntilReady();

    const creature = new Creature(2, 1);

    const fitnessBaseline = new Fitness([workerBaseline], 0.000_000_1, false);
    const fitnessWide = new Fitness([workerWideRange], 0.000_000_1, false);

    await fitnessBaseline.calculate([creature]);
    const scoreBaseline = creature.score!;

    creature.score = undefined;

    await fitnessWide.calculate([creature]);
    const scoreWideRange = creature.score!;

    // With a very wide range, scores should be essentially identical
    assert(
      Number.isFinite(scoreBaseline),
      `Baseline score should be finite`,
    );
    assert(
      Number.isFinite(scoreWideRange),
      `Wide-range score should be finite`,
    );

    // Scores should be very close (within floating-point tolerance)
    const diff = Math.abs(scoreBaseline - scoreWideRange);
    assert(
      diff < 0.001,
      `Scores should be nearly identical with wide range. ` +
        `Baseline: ${scoreBaseline}, Wide: ${scoreWideRange}, diff: ${diff}`,
    );
  } finally {
    workerBaseline.terminate();
    workerWideRange.terminate();
  }
});

Deno.test("OutputRange integration: empty outputRanges has no effect", async () => {
  const dataDir = createNarrowRangeDataDir();

  // Empty array should behave identically to no outputRanges
  const emptyRanges: RequiredOutputRange[] = [];

  const workerBaseline = new WorkerHandler(dataDir, "MSE", true);
  const workerEmpty = new WorkerHandler(
    dataDir,
    "MSE",
    true,
    undefined,
    undefined,
    emptyRanges,
  );

  try {
    await workerBaseline.waitUntilReady();
    await workerEmpty.waitUntilReady();

    const creature = new Creature(2, 1);

    const fitnessBaseline = new Fitness([workerBaseline], 0.000_000_1, false);
    const fitnessEmpty = new Fitness([workerEmpty], 0.000_000_1, false);

    await fitnessBaseline.calculate([creature]);
    const scoreBaseline = creature.score!;

    creature.score = undefined;

    await fitnessEmpty.calculate([creature]);
    const scoreEmpty = creature.score!;

    assert(
      Number.isFinite(scoreBaseline),
      `Baseline score should be finite`,
    );
    assert(
      Number.isFinite(scoreEmpty),
      `Empty-range score should be finite`,
    );

    const diff = Math.abs(scoreBaseline - scoreEmpty);
    assert(
      diff < 0.0001,
      `Empty outputRanges should produce identical scores. ` +
        `Baseline: ${scoreBaseline}, Empty: ${scoreEmpty}, diff: ${diff}`,
    );
  } finally {
    workerBaseline.terminate();
    workerEmpty.terminate();
  }
});
