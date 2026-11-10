// Child process for the CLI backend report test (Issue #4146).
//
// The parent test makes the FFI library unavailable and points the CLI at a
// fake binary. This child installs a reporter that prints each report on
// stdout, then runs one `trainDir` through the CLI path. The `--no-deadline`
// argument omits the hard deadline and the relative budget, so no deadline is
// carried even to a deadline-capable trainer.
import { Creature } from "@creature";
import { Costs } from "@costs";
import { makeDataDir } from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import { setTrainDirReporter } from "@architecture/training/TrainDirBackendReport.ts";

if (import.meta.main) {
  setTrainDirReporter((level, message) => {
    console.log(`${level}|${message}`);
  });
  const fixture = JSON.parse(
    Deno.readTextFileSync(
      new URL(
        "../../../fixtures/native-backprop/ffi-response-new-timed-out-expired.json",
        import.meta.url,
      ),
    ),
  );
  const creature = Creature.fromJSON(JSON.parse(fixture.bestCreatureJson));
  const records = [{
    input: new Float32Array([0.5]),
    output: new Float32Array([1]),
  }];
  const dataDir = makeDataDir(records, records.length, {
    input: creature.input,
    output: creature.output,
  });
  try {
    const deadlineOptions = Deno.args.includes("--no-deadline") ? {} : {
      trainingTimeOutMinutes: 1,
      hardDeadlineTS: 4_102_444_800_000,
    };
    trainDir(creature, dataDir, {
      iterations: 1,
      disableRandomSamples: true,
      ...deadlineOptions,
    }, Costs.find("MSE"));
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
}
