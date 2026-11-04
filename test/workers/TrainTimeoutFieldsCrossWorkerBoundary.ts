/**
 * Issue #4119 — a deadline-capable native train result must keep its
 * `timedOut` and `bestMeasure` across the worker boundary, and a result that
 * carries neither (the TypeScript loop, a legacy engine) must produce a
 * response with no such keys at all.
 *
 * `WorkerProcessor` calls the native `trainDir` directly and has no seam to
 * inject a result, so the `train` payload is built by
 * `buildTrainResponseBody`, the function it uses. The clone check reproduces
 * the boundary: a worker response is structured-cloned on its way out.
 */

import { assertEquals, assertFalse } from "@std/assert";
import type { TrainingResult } from "@architecture/training/TrainingTypes.ts";
import type {
  CreatureExport,
  CreatureTrace,
} from "@architecture/CreatureInterfaces.ts";
import { buildTrainResponseBody } from "@multithreading/workers/WorkerTrainResponse.ts";

const creature = { neurons: [], synapses: [] } as unknown as CreatureExport;
const trace = {} as CreatureTrace;

function resultWith(
  extra: Partial<TrainingResult> = {},
): TrainingResult {
  return {
    ID: "abcd1234",
    iteration: 3,
    error: 0.5,
    trace,
    compact: undefined,
    ...extra,
  };
}

Deno.test("a deadline-stopped native result keeps timedOut and bestMeasure in the response", () => {
  const body = buildTrainResponseBody(
    resultWith({ timedOut: true, bestMeasure: "partial" }),
    creature,
  );

  assertEquals(body.timedOut, true);
  assertEquals(body.bestMeasure, "partial");
  assertEquals(body.error, 0.5);
  assertEquals(body.ID, "abcd1234");
});

Deno.test("the deadline fields survive a structured clone of the response", () => {
  const body = buildTrainResponseBody(
    resultWith({ timedOut: false, bestMeasure: "full" }),
    creature,
  );
  const cloned = structuredClone({ train: body }).train;

  assertEquals(cloned.timedOut, false);
  assertEquals(cloned.bestMeasure, "full");
});

Deno.test("a result without deadline fields yields a response with no such keys", () => {
  const body = buildTrainResponseBody(resultWith(), creature);

  assertFalse("timedOut" in body);
  assertFalse("bestMeasure" in body);
  assertFalse("timedOut" in structuredClone(body));
  assertFalse("bestMeasure" in structuredClone(body));
});
