/**
 * TS-Rust scorer consistency test suite.
 *
 * Verifies that the pure Rust CLI scorer produces identical results to the
 * TypeScript scoring pipeline for the same creature and training data inputs.
 *
 * Issue #1968 - Create TS-Rust scorer consistency test suite.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../mod.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { calculate as calculateScore } from "../../src/architecture/Score.ts";
import { MSE } from "../../src/costs/MSE.ts";
import { MAE } from "../../src/costs/MAE.ts";
import { CrossEntropy } from "../../src/costs/CrossEntropy.ts";
import { MAPE } from "../../src/costs/MAPE.ts";
import { MSLE } from "../../src/costs/MSLE.ts";
import { HINGE } from "../../src/costs/HINGE.ts";
import type { CostInterface } from "../../src/costs/CostInterface.ts";

/** Relative tolerance for f32 precision differences. */
const RELATIVE_TOLERANCE = 1e-6;

/** Absolute tolerance for values very close to zero. */
const ABSOLUTE_TOLERANCE = 1e-8;

/** Path to the Rust scorer binary (release build). */
const RUST_SCORER_PATH = "target/release/rust_scorer";

/** Growth cost factor used across all tests. */
const GROWTH_COST = 0.0001;

/**
 * Interface matching the Rust scorer JSON output.
 */
interface RustScoreResult {
  score: number;
  error: number;
  complexityPenalty: number;
  recordCount: number;
  hiddenNeurons: number;
  synapseCount: number;
}

/**
 * Write binary training data to a directory.
 * Each record is packed as little-endian f32 values:
 * [input_0, ..., input_n, output_0, ..., output_m]
 */
function writeTrainingData(
  dir: string,
  records: { input: number[]; output: number[] }[],
): void {
  const recordSize = records[0].input.length + records[0].output.length;
  const buffer = new ArrayBuffer(records.length * recordSize * 4);
  const view = new DataView(buffer);

  let offset = 0;
  for (const record of records) {
    for (const val of record.input) {
      view.setFloat32(offset, val, true); // little-endian
      offset += 4;
    }
    for (const val of record.output) {
      view.setFloat32(offset, val, true);
      offset += 4;
    }
  }

  Deno.writeFileSync(`${dir}/0.bin`, new Uint8Array(buffer));
}

/**
 * Score a creature using the TypeScript pipeline.
 *
 * Activates the creature on each training record, computes cost,
 * then calculates the final score using Score.calculate().
 */
function scoreTsCreature(
  creatureJson: CreatureExport,
  records: { input: number[]; output: number[] }[],
  costFn: CostInterface,
  growthCost: number,
): { score: number; error: number } {
  const creature = Creature.fromJSON(creatureJson);

  let totalError = 0;
  for (const record of records) {
    const input = new Float32Array(record.input);
    const output = creature.activate(input);
    const target = new Float32Array(record.output);
    totalError += costFn.calculate(target, output);
  }

  const avgError = totalError / records.length;
  const score = calculateScore(creature, avgError, growthCost);

  return { score, error: avgError };
}

/**
 * Score a creature using the Rust CLI scorer binary.
 *
 * Invokes the rust_scorer binary via Deno.Command and parses the JSON output.
 */
async function scoreRustCreature(
  creaturePath: string,
  dataDir: string,
  costName: string,
  numInputs: number,
  numOutputs: number,
  growthCost: number,
): Promise<RustScoreResult> {
  const command = new Deno.Command(RUST_SCORER_PATH, {
    args: [
      "--creature",
      creaturePath,
      "--data",
      dataDir,
      "--cost",
      costName,
      "--inputs",
      String(numInputs),
      "--outputs",
      String(numOutputs),
      "--growth-cost",
      String(growthCost),
    ],
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
  });

  const output = await command.output();
  const stderr = new TextDecoder().decode(output.stderr);

  if (output.code !== 0) {
    throw new Error(
      `Rust scorer exited with code ${output.code}: ${stderr}`,
    );
  }

  const stdout = new TextDecoder().decode(output.stdout);
  return JSON.parse(stdout) as RustScoreResult;
}

/**
 * Assert that two values match within relative tolerance.
 * Uses absolute tolerance for values very close to zero.
 */
function assertWithinTolerance(
  actual: number,
  expected: number,
  label: string,
): void {
  const diff = Math.abs(actual - expected);
  const magnitude = Math.max(Math.abs(actual), Math.abs(expected));

  if (magnitude < ABSOLUTE_TOLERANCE) {
    assert(
      diff < ABSOLUTE_TOLERANCE,
      `${label}: absolute diff ${diff} exceeds tolerance ${ABSOLUTE_TOLERANCE} ` +
        `(TS=${expected}, Rust=${actual})`,
    );
  } else {
    const relativeError = diff / magnitude;
    assert(
      relativeError < RELATIVE_TOLERANCE,
      `${label}: relative error ${relativeError.toExponential(4)} ` +
        `exceeds tolerance ${RELATIVE_TOLERANCE} ` +
        `(TS=${expected}, Rust=${actual}, diff=${diff.toExponential(4)})`,
    );
  }
}

/**
 * Run a full consistency check for a given fixture.
 *
 * Creates temp files, scores with both TS and Rust, compares results.
 */
async function runConsistencyCheck(
  name: string,
  creatureJson: CreatureExport,
  records: { input: number[]; output: number[] }[],
  costName: string,
  costFn: CostInterface,
  growthCost: number,
): Promise<void> {
  const tmpDir = await Deno.makeTempDir({ prefix: "ts_rust_scorer_" });

  try {
    // Write creature JSON
    const creaturePath = `${tmpDir}/creature.json`;
    await Deno.writeTextFile(creaturePath, JSON.stringify(creatureJson));

    // Write training data
    const dataDir = `${tmpDir}/data`;
    await Deno.mkdir(dataDir);
    writeTrainingData(dataDir, records);

    // Score with TypeScript
    const tsResult = scoreTsCreature(
      creatureJson,
      records,
      costFn,
      growthCost,
    );

    // Score with Rust
    const rustResult = await scoreRustCreature(
      creaturePath,
      dataDir,
      costName,
      creatureJson.input,
      creatureJson.output,
      growthCost,
    );

    // Compare results
    assertWithinTolerance(rustResult.error, tsResult.error, `${name}: error`);
    assertWithinTolerance(rustResult.score, tsResult.score, `${name}: score`);
    assertEquals(
      rustResult.recordCount,
      records.length,
      `${name}: record count mismatch`,
    );
  } finally {
    // Clean up temp directory
    await Deno.remove(tmpDir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Create a minimal identity network: input → output with weight=1, bias=0. */
function makeIdentityCreature(
  numInputs: number,
  numOutputs: number,
): CreatureExport {
  const neurons = [];
  const synapses = [];

  for (let i = 0; i < numOutputs; i++) {
    neurons.push({
      type: "output" as const,
      uuid: `output-${i}`,
      bias: 0,
      squash: "IDENTITY",
    });
    // Connect each input to corresponding output (or first input to all outputs)
    const fromIdx = Math.min(i, numInputs - 1);
    synapses.push({
      fromUUID: `input-${fromIdx}`,
      toUUID: `output-${i}`,
      weight: 1.0,
    });
  }

  return {
    input: numInputs,
    output: numOutputs,
    neurons,
    synapses,
    semanticVersion: "4.0.0",
  };
}

// ---------------------------------------------------------------------------
// Test: Rust scorer binary exists
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: Rust scorer binary exists",
  permissions: { read: true },
  fn: () => {
    const stat = Deno.statSync(RUST_SCORER_PATH);
    assert(
      stat.isFile,
      "Rust scorer binary should exist at " + RUST_SCORER_PATH,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 1: Identity network, single input/output, MSE
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: identity network single I/O with MSE",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature = makeIdentityCreature(1, 1);
    const records = [
      { input: [0.5], output: [0.5] },
      { input: [0.0], output: [0.0] },
      { input: [1.0], output: [1.0] },
      { input: [-0.3], output: [-0.3] },
    ];

    await runConsistencyCheck(
      "identity-1x1-MSE",
      creature,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 2: Single hidden TANH neuron, MSE
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: single hidden TANH neuron with MSE",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          bias: 0.5,
          squash: "TANH",
        },
        {
          type: "output",
          uuid: "output-0",
          bias: 0.0,
          squash: "IDENTITY",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.0 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
      ],
      semanticVersion: "4.0.0",
    };

    const records = [
      { input: [0.0], output: [0.4621] },
      { input: [1.0], output: [0.9051] },
      { input: [-1.0], output: [-0.4621] },
    ];

    await runConsistencyCheck(
      "tanh-hidden-MSE",
      creature,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 3: LOGISTIC squash function
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: LOGISTIC squash function",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          bias: 0.0,
          squash: "LOGISTIC",
        },
        {
          type: "output",
          uuid: "output-0",
          bias: 0.0,
          squash: "IDENTITY",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 2.0 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
      ],
      semanticVersion: "4.0.0",
    };

    const records = [
      { input: [0.0], output: [0.5] },
      { input: [1.0], output: [0.88] },
      { input: [-1.0], output: [0.12] },
    ];

    await runConsistencyCheck(
      "logistic-MSE",
      creature,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 4: ReLU squash function
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: ReLU squash function",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          bias: -0.5,
          squash: "ReLU",
        },
        {
          type: "output",
          uuid: "output-0",
          bias: 0.1,
          squash: "IDENTITY",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.0 },
        { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.5 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 2.0 },
      ],
      semanticVersion: "4.0.0",
    };

    const records = [
      { input: [1.0, 0.5], output: [1.5] },
      { input: [0.0, 0.0], output: [0.0] },
      { input: [-1.0, 0.5], output: [0.0] },
      { input: [2.0, 1.0], output: [4.0] },
    ];

    await runConsistencyCheck(
      "relu-2x1-MSE",
      creature,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 5: Multiple squash functions in one network (SELU, Softplus, GELU)
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: multiple squash functions (SELU, Softplus, GELU)",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-selu",
          bias: 0.0,
          squash: "SELU",
        },
        {
          type: "hidden",
          uuid: "hidden-softplus",
          bias: 0.0,
          squash: "Softplus",
        },
        {
          type: "hidden",
          uuid: "hidden-gelu",
          bias: 0.0,
          squash: "GELU",
        },
        {
          type: "output",
          uuid: "output-0",
          bias: 0.0,
          squash: "IDENTITY",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-selu", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "hidden-softplus", weight: 0.7 },
        { fromUUID: "input-0", toUUID: "hidden-gelu", weight: 0.3 },
        { fromUUID: "hidden-selu", toUUID: "output-0", weight: 0.4 },
        { fromUUID: "hidden-softplus", toUUID: "output-0", weight: 0.3 },
        { fromUUID: "hidden-gelu", toUUID: "output-0", weight: 0.3 },
      ],
      semanticVersion: "4.0.0",
    };

    const records = [
      { input: [1.0, 0.5], output: [0.5] },
      { input: [-0.5, 1.0], output: [0.3] },
      { input: [0.0, 0.0], output: [0.0] },
    ];

    await runConsistencyCheck(
      "multi-squash-MSE",
      creature,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 6: No hidden neurons (direct input → output)
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: no hidden neurons, direct connections",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "output",
          uuid: "output-0",
          bias: 0.5,
          squash: "IDENTITY",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.7 },
        { fromUUID: "input-1", toUUID: "output-0", weight: -0.3 },
      ],
      semanticVersion: "4.0.0",
    };

    const records = [
      { input: [1.0, 2.0], output: [0.6] },
      { input: [0.0, 0.0], output: [0.5] },
      { input: [-1.0, 1.0], output: [-0.5] },
    ];

    await runConsistencyCheck(
      "no-hidden-MSE",
      creature,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 7: Large weights and biases
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: large weights and biases",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          bias: 50.0,
          squash: "TANH",
        },
        {
          type: "output",
          uuid: "output-0",
          bias: -10.0,
          squash: "IDENTITY",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 100.0 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: -50.0 },
      ],
      semanticVersion: "4.0.0",
    };

    const records = [
      { input: [1.0], output: [0.0] },
      { input: [-1.0], output: [0.0] },
      { input: [0.5], output: [0.0] },
    ];

    await runConsistencyCheck(
      "large-weights-MSE",
      creature,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 8: MAE cost function
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: MAE cost function",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          bias: 0.0,
          squash: "LOGISTIC",
        },
        {
          type: "output",
          uuid: "output-0",
          bias: 0.0,
          squash: "IDENTITY",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.5 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
      ],
      semanticVersion: "4.0.0",
    };

    const records = [
      { input: [0.0], output: [0.5] },
      { input: [1.0], output: [0.8] },
      { input: [-1.0], output: [0.2] },
    ];

    await runConsistencyCheck(
      "logistic-MAE",
      creature,
      records,
      "MAE",
      new MAE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 9: CrossEntropy cost function (output clamped to [0,1])
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: CrossEntropy cost function",
  permissions: { read: true, write: true, run: true },
  async fn() {
    // Use LOGISTIC output to guarantee output in (0,1)
    const creature: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "output",
          uuid: "output-0",
          bias: 0.0,
          squash: "LOGISTIC",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
      ],
      semanticVersion: "4.0.0",
    };

    // Targets in (0,1) range for cross entropy
    const records = [
      { input: [0.5], output: [0.7] },
      { input: [-0.5], output: [0.3] },
      { input: [0.0], output: [0.5] },
    ];

    await runConsistencyCheck(
      "logistic-CrossEntropy",
      creature,
      records,
      "CrossEntropy",
      new CrossEntropy(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 10: MAPE cost function
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: MAPE cost function",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature = makeIdentityCreature(1, 1);

    // Use positive targets for MAPE (avoids division by zero)
    const records = [
      { input: [1.0], output: [1.0] },
      { input: [2.0], output: [2.0] },
      { input: [0.5], output: [0.5] },
    ];

    await runConsistencyCheck(
      "identity-MAPE",
      creature,
      records,
      "MAPE",
      new MAPE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 11: MSLE cost function
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: MSLE cost function",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature = makeIdentityCreature(1, 1);

    // Use positive values for MSLE (log-based)
    const records = [
      { input: [1.0], output: [1.0] },
      { input: [2.0], output: [2.0] },
      { input: [0.5], output: [0.5] },
    ];

    await runConsistencyCheck(
      "identity-MSLE",
      creature,
      records,
      "MSLE",
      new MSLE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 12: HINGE cost function
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: HINGE cost function",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature = makeIdentityCreature(1, 1);

    // HINGE works with any values
    const records = [
      { input: [1.0], output: [1.0] },
      { input: [-1.0], output: [-1.0] },
      { input: [0.5], output: [0.5] },
    ];

    await runConsistencyCheck(
      "identity-HINGE",
      creature,
      records,
      "HINGE",
      new HINGE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 13: Multiple outputs
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: multiple outputs",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature: CreatureExport = {
      input: 2,
      output: 2,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          bias: 0.1,
          squash: "TANH",
        },
        {
          type: "output",
          uuid: "output-0",
          bias: 0.0,
          squash: "IDENTITY",
        },
        {
          type: "output",
          uuid: "output-1",
          bias: 0.0,
          squash: "IDENTITY",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.3 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
        { fromUUID: "hidden-0", toUUID: "output-1", weight: -1.0 },
      ],
      semanticVersion: "4.0.0",
    };

    const records = [
      { input: [1.0, 0.5], output: [0.5, -0.5] },
      { input: [0.0, 0.0], output: [0.0, 0.0] },
      { input: [-0.5, 1.0], output: [0.2, -0.2] },
    ];

    await runConsistencyCheck(
      "multi-output-MSE",
      creature,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 14: Medium network with multiple layers
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: medium network (multi-layer)",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature: CreatureExport = {
      input: 3,
      output: 1,
      neurons: [
        // Layer 1
        { type: "hidden", uuid: "h1-0", bias: 0.1, squash: "TANH" },
        { type: "hidden", uuid: "h1-1", bias: -0.2, squash: "LOGISTIC" },
        { type: "hidden", uuid: "h1-2", bias: 0.0, squash: "ReLU" },
        // Layer 2
        { type: "hidden", uuid: "h2-0", bias: 0.3, squash: "TANH" },
        { type: "hidden", uuid: "h2-1", bias: -0.1, squash: "LOGISTIC" },
        // Output
        { type: "output", uuid: "output-0", bias: 0.0, squash: "IDENTITY" },
      ],
      synapses: [
        // Input → Layer 1
        { fromUUID: "input-0", toUUID: "h1-0", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "h1-0", weight: -0.3 },
        { fromUUID: "input-1", toUUID: "h1-1", weight: 0.8 },
        { fromUUID: "input-2", toUUID: "h1-1", weight: 0.2 },
        { fromUUID: "input-0", toUUID: "h1-2", weight: 1.0 },
        { fromUUID: "input-2", toUUID: "h1-2", weight: -0.5 },
        // Layer 1 → Layer 2
        { fromUUID: "h1-0", toUUID: "h2-0", weight: 0.6 },
        { fromUUID: "h1-1", toUUID: "h2-0", weight: -0.4 },
        { fromUUID: "h1-1", toUUID: "h2-1", weight: 0.7 },
        { fromUUID: "h1-2", toUUID: "h2-1", weight: 0.3 },
        // Layer 2 → Output
        { fromUUID: "h2-0", toUUID: "output-0", weight: 1.0 },
        { fromUUID: "h2-1", toUUID: "output-0", weight: -0.5 },
      ],
      semanticVersion: "4.0.0",
    };

    const records = [
      { input: [1.0, 0.5, -0.3], output: [0.5] },
      { input: [0.0, 0.0, 0.0], output: [0.0] },
      { input: [-0.5, 1.0, 0.7], output: [0.3] },
      { input: [0.8, -0.4, 0.2], output: [0.1] },
      { input: [0.3, 0.7, -0.8], output: [-0.2] },
    ];

    await runConsistencyCheck(
      "medium-network-MSE",
      creature,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 15: Constant neuron
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: constant neuron",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "constant",
          uuid: "const-0",
          bias: 0.75,
        },
        {
          type: "output",
          uuid: "output-0",
          bias: 0.0,
          squash: "IDENTITY",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "const-0", toUUID: "output-0", weight: 1.0 },
      ],
      semanticVersion: "4.0.0",
    };

    const records = [
      { input: [0.0], output: [0.75] },
      { input: [1.0], output: [1.25] },
      { input: [-1.0], output: [0.25] },
    ];

    await runConsistencyCheck(
      "constant-neuron-MSE",
      creature,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 16: IF synapse type (condition/positive/negative)
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: IF neuron with typed synapses",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature: CreatureExport = {
      input: 3,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "if-0",
          bias: 0.0,
          squash: "IF",
        },
        {
          type: "output",
          uuid: "output-0",
          bias: 0.0,
          squash: "IDENTITY",
        },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "if-0",
          weight: 1.0,
          type: "condition",
        },
        {
          fromUUID: "input-1",
          toUUID: "if-0",
          weight: 1.0,
          type: "positive",
        },
        {
          fromUUID: "input-2",
          toUUID: "if-0",
          weight: 1.0,
          type: "negative",
        },
        { fromUUID: "if-0", toUUID: "output-0", weight: 1.0 },
      ],
      semanticVersion: "4.0.0",
    };

    const records = [
      // condition > 0 => use positive input
      { input: [1.0, 5.0, -3.0], output: [5.0] },
      // condition <= 0 => use negative input
      { input: [-1.0, 5.0, -3.0], output: [-3.0] },
      // condition = 0 => use negative input
      { input: [0.0, 10.0, 2.0], output: [2.0] },
    ];

    await runConsistencyCheck(
      "if-synapses-MSE",
      creature,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 17: Various squash functions (comprehensive)
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: comprehensive squash function coverage",
  permissions: { read: true, write: true, run: true },
  async fn() {
    // Test each squash function individually with a simple pass-through network
    const squashFunctions = [
      "IDENTITY",
      "ReLU",
      "TANH",
      "LOGISTIC",
      "SELU",
      "ELU",
      "LeakyReLU",
      "SOFTSIGN",
      "Softplus",
      "Swish",
      "Mish",
      "GELU",
      "SINE",
      "Cosine",
      "ArcTan",
      "GAUSSIAN",
      "BENT_IDENTITY",
      "BIPOLAR_SIGMOID",
      "BIPOLAR",
      "STEP",
      "COMPLEMENT",
      "ABSOLUTE",
      "SQUARE",
      "Cube",
      "HARD_TANH",
      "ReLU6",
    ];

    const checks = squashFunctions.map((squash) => {
      const creature: CreatureExport = {
        input: 1,
        output: 1,
        neurons: [
          {
            type: "hidden",
            uuid: "hidden-0",
            bias: 0.0,
            squash,
          },
          {
            type: "output",
            uuid: "output-0",
            bias: 0.0,
            squash: "IDENTITY",
          },
        ],
        synapses: [
          { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
          { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
        ],
        semanticVersion: "4.0.0",
      };

      // Use small input values to avoid numerical instability
      const records = [
        { input: [0.5], output: [0.3] },
        { input: [-0.5], output: [0.1] },
        { input: [0.0], output: [0.0] },
      ];

      return runConsistencyCheck(
        `squash-${squash}`,
        creature,
        records,
        "MSE",
        new MSE(),
        GROWTH_COST,
      );
    });

    await Promise.all(checks);
  },
});

// ---------------------------------------------------------------------------
// Test 18: Version penalty consistency
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: version penalty (v3 vs v4)",
  permissions: { read: true, write: true, run: true },
  async fn() {
    // Test with v3 (should have version penalty)
    const creatureV3: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", bias: 0.0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
      ],
      semanticVersion: "3.0.0",
    };

    const records = [
      { input: [0.5], output: [0.5] },
    ];

    await runConsistencyCheck(
      "version-v3-MSE",
      creatureV3,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );

    // Test with no version (should also have version penalty)
    const creatureNoVersion: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", bias: 0.0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
      ],
    };

    await runConsistencyCheck(
      "version-none-MSE",
      creatureNoVersion,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );
  },
});

// ---------------------------------------------------------------------------
// Test 19: Zero growth cost
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: zero growth cost",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "hidden-0", bias: 0.5, squash: "TANH" },
        { type: "output", uuid: "output-0", bias: 0.0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.0 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
      ],
      semanticVersion: "4.0.0",
    };

    const records = [
      { input: [0.0], output: [0.0] },
      { input: [1.0], output: [1.0] },
    ];

    await runConsistencyCheck(
      "zero-growth-cost",
      creature,
      records,
      "MSE",
      new MSE(),
      0.0, // no growth cost
    );
  },
});

// ---------------------------------------------------------------------------
// Test 20: Multiple training data files
// ---------------------------------------------------------------------------

Deno.test({
  name: "TS-Rust consistency: multiple records in single bin file",
  permissions: { read: true, write: true, run: true },
  async fn() {
    const creature = makeIdentityCreature(1, 1);

    // Generate 20 records
    const records = [];
    for (let i = 0; i < 20; i++) {
      const val = (i - 10) / 10; // values from -1.0 to 0.9
      records.push({ input: [val], output: [val] });
    }

    await runConsistencyCheck(
      "many-records-MSE",
      creature,
      records,
      "MSE",
      new MSE(),
      GROWTH_COST,
    );
  },
});
