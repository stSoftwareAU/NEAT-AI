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
import { __setPredictiveCodingNowForTests } from "@architecture/training/TrainingPredictiveCoding.ts";
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

Deno.test("predictive-coding trainDir with disableRandomSamples trains on each file's leading share", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  const o = Creature.fromJSON(creature.exportJSON()).activate(
    new Float32Array([0, 0]),
  )[0];
  const dataSet: DataRecordInterface[] = [];
  for (let i = 0; i < 10; i++) {
    dataSet.push({
      input: new Float32Array([0, 0]),
      output: new Float32Array([i < 5 ? 0 : 10]),
    });
  }
  // MSE over one output is the squared difference.
  const prefixError = o * o;
  const fullError = (o * o + (10 - o) * (10 - o)) / 2;
  assert(
    Math.abs(fullError - prefixError) > 10,
    `expected values must differ: ${prefixError} vs ${fullError}`,
  );

  const half = runOnce(
    Creature.fromJSON(creature.exportJSON()),
    dataSet,
    { trainingSampleRate: 0.5, disableRandomSamples: true },
  );
  assertAlmostEquals(half.error, prefixError, 1e-4);

  const full = runOnce(
    Creature.fromJSON(creature.exportJSON()),
    dataSet,
    { trainingSampleRate: 1, disableRandomSamples: true },
  );
  assertAlmostEquals(full.error, fullError, 1e-3);
});

Deno.test("predictive-coding trainDir random sampling reads ceil(rate × records) per file", () => {
  const dataSet: DataRecordInterface[] = [];
  for (let i = 0; i < 10; i++) {
    dataSet.push({
      input: new Float32Array([i / 10, 1 - i / 10]),
      output: new Float32Array([i / 10]),
    });
  }
  // The clock is read once per processed sample plus a fixed overhead, so the
  // difference between runs counts samples.
  const countCalls = (rate: number): number => {
    let calls = 0;
    __setPredictiveCodingNowForTests(() => {
      calls++;
      return 0;
    });
    try {
      runOnce(
        new Creature(2, 1, { layers: [{ count: 3 }] }),
        dataSet,
        {
          trainingSampleRate: rate,
          disableRandomSamples: false,
          hardDeadlineTS: 1e15,
        },
      );
    } finally {
      __setPredictiveCodingNowForTests(undefined);
    }
    return calls;
  };
  const full = countCalls(1);
  assertEquals(countCalls(0.5), full - 5);
  assertEquals(countCalls(0.01), full - 9);
});
