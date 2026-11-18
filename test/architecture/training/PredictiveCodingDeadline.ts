/**
 * Issue #4146 — `trainDir` on the predictive-coding path honours the task
 * deadline, reports the outcome, and writes a `finalised` phase line.
 */

import { assert, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
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

function run(
  options: Partial<TrainOptions>,
  untrainedError?: string,
) {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  if (untrainedError !== undefined) {
    addTag(creature, "untrained-error", untrainedError);
  }
  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
  const dir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
  const lines: string[] = [];
  setTrainDirReporter((_level, message) => lines.push(message));
  try {
    const result = trainDir(
      creature,
      dir,
      {
        targetError: 0.001,
        disableRandomSamples: true,
        predictiveCoding: {
          ...DEFAULT_PREDICTIVE_CODING_CONFIG,
          enabled: true,
        },
        ...options,
      },
      Costs.find("MSE"),
    );
    return { result, lines };
  } finally {
    setTrainDirReporter(undefined);
    Deno.removeSync(dir, { recursive: true });
  }
}

const phaseLines = (lines: string[]) =>
  lines.filter((l) => l.includes("[training-phase]"));

Deno.test("predictive-coding trainDir past its deadline is an unmeasured timeout", () => {
  const { result, lines } = run(
    { hardDeadlineTS: 1, iterations: 50 },
    "0.25",
  );
  assertEquals(result.timedOut, true);
  assertEquals(result.bestMeasure, "unmeasured");
  assertEquals(result.error, 0.25);
  const phases = phaseLines(lines);
  assertEquals(phases.length, 1);
  assert(
    new RegExp(
      `^\\[training-phase\\] task=${result.ID} phase=finalised timedOut=yes msFromDeadline=\\d+$`,
    ).test(phases[0]),
    phases[0],
  );
});

Deno.test("predictive-coding timeout with no carried error is NaN", () => {
  const { result } = run({ hardDeadlineTS: 1, iterations: 50 });
  assertEquals(result.timedOut, true);
  assert(Number.isNaN(result.error));
});

Deno.test("predictive-coding trainDir with no deadline is unchanged", () => {
  const { result, lines } = run({ iterations: 1 });
  assertEquals("timedOut" in result, false);
  const phases = phaseLines(lines);
  assertEquals(phases.length, 1);
  assert(
    phases[0].endsWith("phase=finalised timedOut=no msFromDeadline=none"),
    phases[0],
  );
});

Deno.test("predictive-coding trainDir timed out after one full iteration is a full measure", () => {
  // A counter clock: one call computes the deadline (now = 0, so the deadline
  // is hardDeadlineTS = 3), then one call per sample. The first iteration's two
  // samples see 1 and 2; the second iteration's see 3 and then 4 > 3, so the
  // deadline passes after exactly one full iteration. The phase line reads 5.
  let tick = 0;
  __setPredictiveCodingNowForTests(() => tick++);
  try {
    const { result, lines } = run(
      { hardDeadlineTS: 3, iterations: 50, targetError: 0 },
      "123",
    );
    assertEquals(result.timedOut, true);
    assertEquals(result.bestMeasure, "full");
    assertEquals(result.iteration, 1);
    assert(Number.isFinite(result.error), String(result.error));
    assert(result.error !== 123, "error must be measured, not the carried tag");
    const phases = phaseLines(lines);
    assertEquals(phases.length, 1);
    assertEquals(
      phases[0],
      `[training-phase] task=${result.ID} phase=finalised timedOut=yes msFromDeadline=2`,
    );
  } finally {
    __setPredictiveCodingNowForTests(undefined);
  }
});
