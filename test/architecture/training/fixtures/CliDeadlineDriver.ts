// Child process for the hermetic CLI deadline tests.
import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Costs } from "@costs";
import { makeDataDir } from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";

if (import.meta.main) {
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
    const result = trainDir(creature, dataDir, {
      iterations: 1,
      disableRandomSamples: true,
      trainingTimeOutMinutes: 1,
      hardDeadlineTS: Deno.args[0] === "none"
        ? undefined
        : Number(Deno.args[0]),
    }, Costs.find("MSE"));
    assertEquals(result.timedOut, true);
    assertEquals(result.bestMeasure, "unmeasured");
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
}
