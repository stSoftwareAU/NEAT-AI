/**
 * Integration tests for the `fitnessSampleRate` ranking-pass subsample applied
 * inside the streaming `evaluateDir` binary reader (Issue #3257).
 *
 * These are implementation-independent "what" tests: rather than inspecting
 * internal counters, they build a synthetic binary corpus and assert that
 * scoring the full corpus at a sub-`1` rate produces the *same* average error
 * as scoring a corpus that contains only the sampled records — proving the
 * reader kept exactly the deterministic stratified stride and did less work.
 * The default rate `1` must reproduce the full-corpus error bit-for-bit.
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { Costs } from "@costs";
import { shouldScoreRecord } from "@creature/FitnessSubsample.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Build a corpus where odd-indexed records carry a systematically different
 * target from even-indexed ones, so a 0.5 stride (which keeps odd indices)
 * yields a genuinely different mean error from the full corpus.
 */
function buildDataSet(n: number): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i % 7) / 7;
    const b = ((i * 3) % 11) / 11;
    // Even records target one extreme, odd records the other.
    const t = i % 2 === 0 ? 0.9 : -0.9;
    rows.push({
      input: new Float32Array([a, b]),
      output: new Float32Array([t]),
    });
  }
  return rows;
}

/** Records that the deterministic stride keeps at `rate` (single-file order). */
function sampledSubset(
  rows: DataRecordInterface[],
  rate: number,
): DataRecordInterface[] {
  return rows.filter((_, i) => shouldScoreRecord(i, rate));
}

Deno.test("evaluateDir - default rate 1 matches undefined (full corpus)", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const rows = buildDataSet(40);
  const dir = makeDataDir(rows, 40); // single .bin file → deterministic order
  try {
    const full = await creature.evaluateDir(dir, Costs.find("MSE"), false);
    const explicitOne = await creature.evaluateDir(
      dir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      undefined,
      1,
    );
    assertEquals(explicitOne.error, full.error);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("evaluateDir - fused path subsample scores exactly the sampled records", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const rows = buildDataSet(40);
  const fullDir = makeDataDir(rows, 40);
  const reducedDir = makeDataDir(sampledSubset(rows, 0.5), 40);
  try {
    const full = await creature.evaluateDir(fullDir, Costs.find("MSE"), false);
    const reduced = await creature.evaluateDir(
      reducedDir,
      Costs.find("MSE"),
      false,
    );
    const subsampled = await creature.evaluateDir(
      fullDir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      undefined,
      0.5,
    );

    // Subsampling the full corpus == scoring only the sampled records.
    assertAlmostEquals(subsampled.error, reduced.error, 1e-6);
    // And the crafted corpus makes the subsample genuinely differ from full,
    // proving records were actually skipped (not silently full-scored).
    assertEquals(
      Math.abs(subsampled.error - full.error) > 1e-3,
      true,
      `subsample ${subsampled.error} should differ from full ${full.error}`,
    );
  } finally {
    await Deno.remove(fullDir, { recursive: true });
    await Deno.remove(reducedDir, { recursive: true });
  }
});

Deno.test("evaluateDir - per-record path subsample scores exactly the sampled records", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const rows = buildDataSet(40);
  const fullDir = makeDataDir(rows, 40);
  const reducedDir = makeDataDir(sampledSubset(rows, 0.5), 40);
  // Issue #1620: a non-empty output range disables the fused path, forcing the
  // per-record loop so its subsample skip is exercised too. The bounds are
  // wide enough to add no penalty, isolating the subsample behaviour.
  const ranges = [{ min: -2, max: 2, penaltyWeight: 1 }];
  try {
    const reduced = await creature.evaluateDir(
      reducedDir,
      Costs.find("MSE"),
      false,
      ranges,
    );
    const subsampled = await creature.evaluateDir(
      fullDir,
      Costs.find("MSE"),
      false,
      ranges,
      undefined,
      undefined,
      0.5,
    );
    assertAlmostEquals(subsampled.error, reduced.error, 1e-6);
  } finally {
    await Deno.remove(fullDir, { recursive: true });
    await Deno.remove(reducedDir, { recursive: true });
  }
});
