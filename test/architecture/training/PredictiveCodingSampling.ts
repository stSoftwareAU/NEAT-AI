/**
 * Issue #4180 — `trainDir` on the predictive-coding path honours
 * `trainingSampleRate` and `disableRandomSamples`, using the standard loop's
 * per-file record selection.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Costs } from "@costs";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import { setTrainDirReporter } from "@architecture/training/TrainDirBackendReport.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "@config/PredictiveCodingConfig.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";

function runOnce(
  creature: Creature,
  dataSet: DataRecordInterface[],
  options: Partial<TrainOptions>,
) {
  const dir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
  setTrainDirReporter(() => {});
  try {
    return trainDir(
      creature,
      dir,
      {
        iterations: 1,
        targetError: 0,
        predictiveCoding: {
          ...DEFAULT_PREDICTIVE_CODING_CONFIG,
          enabled: true,
        },
        ...options,
      },
      Costs.find("MSE"),
    );
  } finally {
    setTrainDirReporter(undefined);
    Deno.removeSync(dir, { recursive: true });
  }
}

/** The untrained output for input [0, 0]; every record below uses that input. */
function untrainedOutput(creature: Creature): number {
  return Creature.fromJSON(creature.exportJSON()).activate(
    new Float32Array([0, 0]),
  )[0];
}

Deno.test("predictive-coding trainDir with disableRandomSamples trains on each file's leading share", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  const o = untrainedOutput(creature);
  // Targets are offsets from the untrained output, so the per-record errors
  // (MSE over one output = squared offset) are 1 for the leading 5 records and
  // 100 for the trailing 5, whatever the random creature outputs.
  const dataSet: DataRecordInterface[] = [];
  for (let i = 0; i < 10; i++) {
    dataSet.push({
      input: new Float32Array([0, 0]),
      output: new Float32Array([o + (i < 5 ? 1 : 10)]),
    });
  }
  const prefixError = 1;
  const fullError = (1 + 100) / 2;
  assert(
    Math.abs(fullError - prefixError) > 10,
    `expected values must differ: ${prefixError} vs ${fullError}`,
  );

  const half = runOnce(
    Creature.fromJSON(creature.exportJSON()),
    dataSet,
    { trainingSampleRate: 0.5, disableRandomSamples: true },
  );
  assertAlmostEquals(half.error, prefixError, 1e-3);

  const full = runOnce(
    Creature.fromJSON(creature.exportJSON()),
    dataSet,
    { trainingSampleRate: 1, disableRandomSamples: true },
  );
  assertAlmostEquals(full.error, fullError, 1e-2);
});

/** Number of set bits in a non-negative integer. */
function bitCount(n: number): number {
  let count = 0;
  for (let v = n; v > 0; v = Math.floor(v / 2)) count += v % 2;
  return count;
}

Deno.test("predictive-coding trainDir random sampling trains on ceil(rate × records) records per file", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  const o = untrainedOutput(creature);
  // Record k's error is 2^k, so the summed error over any subset of records is
  // an integer whose set bits name exactly the records that were read.
  const dataSet: DataRecordInterface[] = [];
  for (let k = 0; k < 10; k++) {
    dataSet.push({
      input: new Float32Array([0, 0]),
      output: new Float32Array([o + Math.sqrt(2 ** k)]),
    });
  }
  // `error` is the mean over the records read, so `error × n` must be a
  // whole number with exactly n set bits (n distinct records) and below 2^10.
  const assertReads = (rate: number, n: number) => {
    const result = runOnce(
      Creature.fromJSON(creature.exportJSON()),
      dataSet,
      { trainingSampleRate: rate, disableRandomSamples: false },
    );
    const sum = result.error * n;
    const rounded = Math.round(sum);
    assertAlmostEquals(sum, rounded, 1e-2, `rate ${rate}: sum ${sum}`);
    assert(rounded > 0 && rounded < 1024, `rate ${rate}: sum ${rounded}`);
    assertEquals(bitCount(rounded), n, `rate ${rate}: sum ${rounded}`);
  };

  assertReads(1, 10);
  assertReads(0.5, 5);
  assertReads(0.01, 1);
});
