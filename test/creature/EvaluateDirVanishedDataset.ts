/**
 * Regression tests for Issue #3412: a training dataset that vanishes mid-run
 * must fail loud as a DatasetError naming the missing file/directory, not a
 * misleading `AssertionError: Error is not finite: Infinity` (nor a bare
 * Deno.errors.NotFound swallowed into an Infinity score).
 */

import { assertEquals, assertRejects } from "@std/assert";
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { Costs } from "@costs";
import { DatasetError } from "@errors/DatasetError.ts";
import { initWasmForTests } from "../_initWasm.ts";

function buildDataSet(n: number): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      input: new Float32Array([(i % 5) / 5, (i % 3) / 3]),
      output: new Float32Array([i % 2 === 0 ? 0.9 : -0.9]),
    });
  }
  return rows;
}

Deno.test("evaluateDir - vanished directory throws DatasetError, not a finite-error assertion", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dir = makeDataDir(buildDataSet(20), 20);
  // Simulate a background disk-cleanup sweep deleting the dataset mid-run.
  await Deno.remove(dir, { recursive: true });

  const error = await creature
    .evaluateDir(dir, Costs.find("MSE"), false)
    .then(() => undefined)
    .catch((e) => e);

  if (!(error instanceof DatasetError)) {
    throw new Error(
      `expected DatasetError, got ${error?.constructor?.name}: ${error}`,
    );
  }
  assertEquals(error.reason, "DIRECTORY_MISSING");
  assertEquals(error.path, dir);
});

Deno.test("evaluateDir - .bin file vanishing between listing and read throws DatasetError", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dir = makeDataDir(buildDataSet(20), 20);
  try {
    // Cache a file list that references a file we then delete, mimicking a
    // file vanishing mid-iteration while the directory list is still held.
    const goneFile = `${dir}/does-not-exist.bin`;

    const error = await creature
      .evaluateDir(dir, Costs.find("MSE"), false, undefined, [goneFile])
      .then(() => undefined)
      .catch((e) => e);

    if (!(error instanceof DatasetError)) {
      throw new Error(
        `expected DatasetError, got ${error?.constructor?.name}: ${error}`,
      );
    }
    assertEquals(error.reason, "FILE_MISSING");
    assertEquals(error.path, goneFile);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("evaluateDir - empty dataset directory throws NO_DATA_FILES DatasetError", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dir = await Deno.makeTempDir({ prefix: "empty-dataset-" });
  try {
    const error = await assertRejects(
      () => creature.evaluateDir(dir, Costs.find("MSE"), false),
      DatasetError,
    );
    assertEquals(error.reason, "NO_DATA_FILES");
    assertEquals(error.path, dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
