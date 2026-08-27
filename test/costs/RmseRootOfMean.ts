/**
 * Issue #3853: RMSE over a dataset is the **root of the mean** squared error,
 * never the **mean of the per-record roots**.
 *
 * `RMSE.calculate` returns the root of one record's mean squared error, so
 * accumulating it the way a mean-style cost is accumulated (sum the per-record
 * values, divide by the record count) yields `mean(sqrt(...))`. Because `sqrt`
 * is concave that is strictly smaller than `sqrt(mean(...))` whenever the
 * per-record errors differ — which is why the TypeScript scoring path and the
 * native `rust_scorer` reported different numbers for the same creature and the
 * same dataset.
 *
 * These tests pin the documented formula, `RMSE = sqrt((1/n) * Σ(y - y')²)`,
 * on both `evaluateDir` engine paths: the fused WASM batch path taken by
 * forward-only creatures, and the per-record path taken by recurrent creatures
 * and by any creature scored with output-range constraints.
 */
import { assert, assertAlmostEquals } from "@std/assert";
import { Costs, type Creature } from "../../mod.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import {
  buildFixtureCreature,
  buildFixtureDataSet,
  FIXTURE_RECORDS,
} from "../_costFixtures.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Force the TypeScript/WASM engine. Without this the environment decides
 * (`NEAT_AI_RUST_SCORER_ENABLED`), and these tests are about what the
 * TypeScript path itself computes.
 */
const SCORER_OFF: RequiredRustScorerConfig = {
  enabled: false,
  binaryPath: "rust_scorer",
  timeoutMs: 0,
  env: {},
  batch: false,
};

/** Mean of the per-record RMSE values — the value the buggy accumulation produced. */
function meanOfRoots(creature: Creature, rows: DataRecordInterface[]): number {
  const rmse = Costs.find("RMSE");
  let sum = 0;
  for (const row of rows) {
    creature.clearState();
    const output = creature.activate(row.input, false);
    sum += rmse.calculate(row.output, Float32Array.from(output));
  }
  return sum / rows.length;
}

async function assertRootOfMean(forwardOnly: boolean): Promise<void> {
  await initWasmForTests();

  const rows = buildFixtureDataSet();
  const dataDir = makeDataDir(rows, FIXTURE_RECORDS);
  try {
    const creature = buildFixtureCreature(forwardOnly);
    const mse = await creature.evaluateDir(
      dataDir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      SCORER_OFF,
    );
    const rmse = await creature.evaluateDir(
      dataDir,
      Costs.find("RMSE"),
      false,
      undefined,
      undefined,
      SCORER_OFF,
    );

    assert(mse.error > 0, `MSE should be positive, was ${mse.error}`);
    assertAlmostEquals(
      rmse.error,
      Math.sqrt(mse.error),
      1e-6,
      `RMSE (${rmse.error}) should be the root of the mean squared error ` +
        `(${Math.sqrt(mse.error)})`,
    );

    // Guard against a vacuous assertion: on this dataset the two accumulations
    // genuinely differ (sqrt is concave, so mean-of-roots is the smaller
    // value), and the test would fail on the mean-of-roots number.
    const buggy = meanOfRoots(buildFixtureCreature(forwardOnly), rows);
    assert(
      rmse.error - buggy > 1e-4,
      `dataset must separate mean-of-roots (${buggy}) from root-of-mean ` +
        `(${rmse.error}) for this test to mean anything`,
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
  }
}

Deno.test("RMSE evaluateDir: forward-only creature reports sqrt(mean squared error)", async () => {
  await assertRootOfMean(true);
});

Deno.test("RMSE evaluateDir: recurrent creature reports sqrt(mean squared error)", async () => {
  await assertRootOfMean(false);
});

Deno.test("RMSE evaluateDir: output-range penalty stays additive on top of the root", async () => {
  await initWasmForTests();

  const rows = buildFixtureDataSet();
  const dataDir = makeDataDir(rows, FIXTURE_RECORDS);
  try {
    const creature = buildFixtureCreature(true);
    // Outputs are LOGISTIC, so this range is violated on every record and the
    // penalty is a strictly positive addition to the reported error.
    const ranges = [
      { min: 2, max: 3, penaltyWeight: 1 },
      { min: 2, max: 3, penaltyWeight: 1 },
    ];

    const plain = await creature.evaluateDir(
      dataDir,
      Costs.find("RMSE"),
      false,
      undefined,
      undefined,
      SCORER_OFF,
    );
    const penalised = await creature.evaluateDir(
      dataDir,
      Costs.find("RMSE"),
      false,
      ranges,
      undefined,
      SCORER_OFF,
    );
    const mse = await creature.evaluateDir(
      dataDir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      SCORER_OFF,
    );
    const penalisedMse = await creature.evaluateDir(
      dataDir,
      Costs.find("MSE"),
      false,
      ranges,
      undefined,
      SCORER_OFF,
    );

    // The penalty must not be folded into the squared-error sum: the amount it
    // adds to RMSE is the same amount it adds to MSE (a mean of penalties).
    const rmsePenalty = penalised.error - plain.error;
    const msePenalty = penalisedMse.error - mse.error;
    assert(rmsePenalty > 0, `penalty should be positive, was ${rmsePenalty}`);
    assertAlmostEquals(
      rmsePenalty,
      msePenalty,
      1e-6,
      `output-range penalty must be additive in error units for RMSE ` +
        `(${rmsePenalty}) exactly as it is for MSE (${msePenalty})`,
    );
    assertAlmostEquals(plain.error, Math.sqrt(mse.error), 1e-6);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
  }
});
