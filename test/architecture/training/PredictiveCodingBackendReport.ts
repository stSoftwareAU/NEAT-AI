/**
 * Issue #4146 (PR #4149) — the predictive-coding trainer reports its backend
 * line too: a missing line must not read as "the task never reached trainDir".
 * There is no native trainer and no deadline on this path.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Costs } from "@costs";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import { setTrainDirReporter } from "@architecture/training/TrainDirBackendReport.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "@config/PredictiveCodingConfig.ts";

Deno.test("predictive-coding trainDir reports backend=wasm, no deadline, no capability", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  const lines: string[] = [];
  setTrainDirReporter((level, message) => lines.push(`${level}|${message}`));
  try {
    trainDir(
      creature,
      dataSetDir,
      {
        iterations: 1,
        targetError: 0.001,
        disableRandomSamples: true,
        predictiveCoding: {
          ...DEFAULT_PREDICTIVE_CODING_CONFIG,
          enabled: true,
        },
      },
      Costs.find("MSE"),
    );
  } finally {
    setTrainDirReporter(undefined);
    Deno.removeSync(dataSetDir, { recursive: true });
  }

  const backendLines = lines.filter((l) => l.includes("[training-backend]"));
  assertEquals(backendLines.length, 1);
  const match = /^info\|\[training-backend\] task=\S+ (.*)$/.exec(
    backendLines[0],
  );
  assertEquals(
    match?.[1],
    "backend=wasm deadlineSent=no capability=none",
  );
});
