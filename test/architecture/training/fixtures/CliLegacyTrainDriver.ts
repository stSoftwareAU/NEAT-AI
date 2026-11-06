// Child process for the hermetic legacy CLI train test (Issue #4119).
//
// Runs the real exported `trainDir` against a fake legacy CLI that replays the
// output a real legacy `neat_ai_backpropagation train` wrote, and prints one
// JSON line describing what the caller observed.
import { Creature } from "@creature";
import { Costs } from "@costs";
import { makeDataDir } from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import { type Logger, setLogger } from "@utils/Logger.ts";

/** 2100-01-01T00:00:00Z: a fixed hard deadline, so no clock is read here. */
const FAR_FUTURE_DEADLINE_TS = 4_102_444_800_000;

if (import.meta.main) {
  const fixtures = new URL(
    "../../../fixtures/native-backprop/cli-train-legacy/",
    import.meta.url,
  );
  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync(new URL("input-creature.json", fixtures)),
    ),
  );
  const warnings: string[] = [];
  const recorder: Logger = {
    debug() {},
    info() {},
    warn(...args: unknown[]) {
      warnings.push(args.map((arg) => String(arg)).join(" "));
    },
    error() {},
  };
  setLogger(recorder);

  const records = [{
    input: new Float32Array([0.5]),
    output: new Float32Array([1]),
  }];
  const dataDir = makeDataDir(records, records.length, {
    input: creature.input,
    output: creature.output,
  });
  const before = JSON.stringify(creature.exportJSON().synapses);
  try {
    const result = trainDir(creature, dataDir, {
      iterations: 3,
      disableRandomSamples: true,
      trainingTimeOutMinutes: 5,
      hardDeadlineTS: FAR_FUTURE_DEADLINE_TS,
    }, Costs.find("MSE"));
    console.log(JSON.stringify({
      error: Number.isFinite(result.error) ? result.error : null,
      iteration: result.iteration,
      timedOut: result.timedOut ?? null,
      bestMeasure: result.bestMeasure ?? null,
      weightsChanged: before !== JSON.stringify(creature.exportJSON().synapses),
      warnings,
    }));
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
}
