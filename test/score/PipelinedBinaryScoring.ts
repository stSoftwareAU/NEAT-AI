/**
 * Issue #2331 - Pipelined binary file scoring
 *
 * Verifies that evaluateDir with double-buffered async I/O produces
 * correct and deterministic results across many small binary files.
 * The pipelined approach overlaps disk reads with WASM scoring; these
 * tests confirm that scoring order and numerical results are preserved.
 */
import { assert, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import { Costs } from "@costs";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";

/**
 * Generate a deterministic dataset of the given size.
 */
function generateDataset(
  count: number,
  inputCount: number,
  outputCount: number,
): DataRecordInterface[] {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < count; i++) {
    const input = new Float32Array(inputCount);
    const output = new Float32Array(outputCount);
    for (let j = 0; j < inputCount; j++) {
      input[j] = Math.sin(i * 0.1 + j * 0.7) * 0.8;
    }
    for (let j = 0; j < outputCount; j++) {
      output[j] = Math.tanh(input[j % inputCount] + (j * 0.3));
    }
    records.push({ input, output });
  }
  return records;
}

/**
 * Build a simple forward-only creature for testing.
 */
function buildTestCreature(inputCount: number, outputCount: number): Creature {
  return Creature.fromJSON({
    input: inputCount,
    output: outputCount,
    neurons: [
      { type: "hidden", uuid: "h-0", squash: "TANH", bias: 0.1 },
      { type: "hidden", uuid: "h-1", squash: "TANH", bias: -0.2 },
      ...Array.from({ length: outputCount }, (_, i) => ({
        type: "output" as const,
        uuid: `output-${i}`,
        squash: "IDENTITY",
        bias: 0,
      })),
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h-1", weight: -0.3 },
      { fromUUID: "h-0", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "h-1", toUUID: "output-1", weight: 0.6 },
    ],
  });
}

/**
 * Determinism: evaluateDir returns the same result on repeated calls
 * with the same creature and dataset partitioned into many small files.
 */
Deno.test({
  name:
    "Issue #2331: evaluateDir is deterministic across multiple calls with many files",
  async fn() {
    const INPUT = 2;
    const OUTPUT = 2;
    const RECORDS = 200;
    const PARTITION = 10; // 20 small files

    const dataset = generateDataset(RECORDS, INPUT, OUTPUT);
    const dataDir = makeDataDir(dataset, PARTITION);

    try {
      const creature = buildTestCreature(INPUT, OUTPUT);
      const cost = Costs.find("MSE");

      const result1 = await creature.evaluateDir(dataDir, cost, false);
      const result2 = await creature.evaluateDir(dataDir, cost, false);

      assert(Number.isFinite(result1.error), "First result should be finite");
      assert(Number.isFinite(result2.error), "Second result should be finite");
      assertGreater(result1.error, 0, "Error should be positive");
      // Float64 accumulation may differ by machine epsilon across calls
      // due to WASM internal state; verify within tight tolerance.
      const tolerance = 1e-12;
      assert(
        Math.abs(result1.error - result2.error) < tolerance,
        `evaluateDir must be deterministic: ${result1.error} vs ${result2.error}`,
      );

      creature.dispose();
    } finally {
      await Deno.remove(dataDir, { recursive: true });
    }
  },
});

/**
 * Many small files: evaluateDir handles 50+ binary files correctly,
 * exercising the pipelined file-open and double-buffer paths.
 */
Deno.test({
  name: "Issue #2331: evaluateDir handles 50+ small binary files correctly",
  async fn() {
    const INPUT = 3;
    const OUTPUT = 1;
    const RECORDS = 250;
    const PARTITION = 5; // 50 small files

    const dataset = generateDataset(RECORDS, INPUT, OUTPUT);
    const dataDir = makeDataDir(dataset, PARTITION);

    try {
      const creature = Creature.fromJSON({
        input: INPUT,
        output: OUTPUT,
        neurons: [
          { type: "hidden", uuid: "h-0", squash: "TANH", bias: 0.1 },
          {
            type: "output" as const,
            uuid: "output-0",
            squash: "IDENTITY",
            bias: 0,
          },
        ],
        synapses: [
          { fromUUID: "input-0", toUUID: "h-0", weight: 0.5 },
          { fromUUID: "input-1", toUUID: "h-0", weight: -0.3 },
          { fromUUID: "h-0", toUUID: "output-0", weight: 0.8 },
        ],
      });

      const cost = Costs.find("MSE");
      const result = await creature.evaluateDir(dataDir, cost, false);

      assert(Number.isFinite(result.error), "Result should be finite");
      assertGreater(result.error, 0, "Error should be positive");

      creature.dispose();
    } finally {
      await Deno.remove(dataDir, { recursive: true });
    }
  },
});

/**
 * Consistency: evaluating with a single large file produces the same
 * result as evaluating the same data split across many small files.
 * This confirms that double-buffering and file-boundary handling
 * do not introduce numerical drift.
 */
Deno.test({
  name:
    "Issue #2331: single-file vs multi-file evaluation produces identical results",
  async fn() {
    const INPUT = 2;
    const OUTPUT = 2;
    const RECORDS = 100;

    const dataset = generateDataset(RECORDS, INPUT, OUTPUT);

    // Single file (all records in one partition)
    const singleFileDir = makeDataDir(dataset, RECORDS);
    // Many files (5 records per file = 20 files)
    const multiFileDir = makeDataDir(dataset, 5);

    try {
      const creature = buildTestCreature(INPUT, OUTPUT);
      const cost = Costs.find("MSE");

      const singleResult = await creature.evaluateDir(
        singleFileDir,
        cost,
        false,
      );
      const multiResult = await creature.evaluateDir(
        multiFileDir,
        cost,
        false,
      );

      assert(
        Number.isFinite(singleResult.error),
        "Single-file result should be finite",
      );
      assert(
        Number.isFinite(multiResult.error),
        "Multi-file result should be finite",
      );

      // Floating-point addition order may differ slightly between single-file
      // and multi-file evaluation due to intermediate sum accumulation.
      // Allow a tiny tolerance for floating-point reorder effects.
      const tolerance = 1e-6;
      assert(
        Math.abs(singleResult.error - multiResult.error) < tolerance,
        `Single-file error (${singleResult.error}) and multi-file error ` +
          `(${multiResult.error}) should match within tolerance ${tolerance}`,
      );

      creature.dispose();
    } finally {
      await Deno.remove(singleFileDir, { recursive: true });
      await Deno.remove(multiFileDir, { recursive: true });
    }
  },
});

/**
 * Per-record path: evaluateDir works correctly for the non-fused
 * per-record scoring path (e.g., with output range constraints).
 */
Deno.test({
  name:
    "Issue #2331: per-record scoring path with output ranges is deterministic",
  async fn() {
    const INPUT = 2;
    const OUTPUT = 2;
    const RECORDS = 100;
    const PARTITION = 10; // 10 files

    const dataset = generateDataset(RECORDS, INPUT, OUTPUT);
    const dataDir = makeDataDir(dataset, PARTITION);

    try {
      const creature = buildTestCreature(INPUT, OUTPUT);
      const cost = Costs.find("MSE");

      // Output ranges force the per-record (non-fused) path.
      const outputRanges = [
        { min: -1, max: 1, penaltyWeight: 1.0 },
      ];

      const result1 = await creature.evaluateDir(
        dataDir,
        cost,
        false,
        outputRanges,
      );
      const result2 = await creature.evaluateDir(
        dataDir,
        cost,
        false,
        outputRanges,
      );

      assert(Number.isFinite(result1.error), "First result should be finite");
      assert(Number.isFinite(result2.error), "Second result should be finite");
      // Float64 accumulation may differ by machine epsilon across calls.
      const tolerance = 1e-12;
      assert(
        Math.abs(result1.error - result2.error) < tolerance,
        `Per-record path must be deterministic: ${result1.error} vs ${result2.error}`,
      );

      creature.dispose();
    } finally {
      await Deno.remove(dataDir, { recursive: true });
    }
  },
});
