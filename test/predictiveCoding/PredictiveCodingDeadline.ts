/**
 * Issue #4146: the predictive-coding trainer honours the per-task deadline,
 * checked after every sample, and discards the partial iteration it stopped in.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Costs } from "@costs";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "@config/PredictiveCodingConfig.ts";
import { trainWithPredictiveCoding } from "@predictiveCoding/PredictiveCodingTrainer.ts";

const pcConfig = { ...DEFAULT_PREDICTIVE_CODING_CONFIG, enabled: true };

function setup() {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
  const dir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
  return { creature, dir };
}

Deno.test("PC trainer with a passed deadline stops and discards the partial iteration", () => {
  const { creature, dir } = setup();
  try {
    const before = JSON.stringify(creature.exportJSON());
    const result = trainWithPredictiveCoding(
      creature,
      [dir + "/0.bin"],
      pcConfig,
      Costs.find("MSE"),
      { iterations: 50, targetError: 0, timeoutTS: 1 },
    );
    assertEquals(result.timedOut, true);
    assertEquals(result.completedIterations, 0);
    assertEquals(JSON.stringify(creature.exportJSON()), before);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("PC trainer keeps the iterations completed before the deadline", () => {
  const { creature, dir } = setup();
  try {
    // One now() call per sample, returning 0, 1, 2, ... The first iteration
    // reads 4 samples (now = 0..3), none past 5. The second iteration sees
    // 4, 5, 6: 6 > 5 on its third sample, so exactly one iteration completes.
    let tick = 0;
    const result = trainWithPredictiveCoding(
      creature,
      [dir + "/0.bin"],
      pcConfig,
      Costs.find("MSE"),
      { iterations: 50, targetError: 0, timeoutTS: 5, now: () => tick++ },
    );
    assertEquals(result.timedOut, true);
    assertEquals(result.completedIterations, 1);
    assert(Number.isFinite(result.error));
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("PC trainer with no deadline completes every iteration", () => {
  const { creature, dir } = setup();
  try {
    const result = trainWithPredictiveCoding(
      creature,
      [dir + "/0.bin"],
      pcConfig,
      Costs.find("MSE"),
      { iterations: 3, targetError: 0 },
    );
    assertEquals(result.timedOut, false);
    assertEquals(result.completedIterations, 3);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
