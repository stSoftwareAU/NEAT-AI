import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  buildHypotenuseDataSet,
  HYPOTENUSE_HOLD_OUT,
} from "./_hypotenuseDataSet.ts";

/**
 * The hypotenuse regression suite (`test/NEAT/Ratios.ts`) is only meaningful
 * while the probe input it asserts on has been held out of training — the
 * point is that the creature *generalises*, not that it memorised a row
 * (Issue #4026). That property used to live inside the suite's own loop,
 * where the only way to check it was to read the code. It is now a named
 * function, so these are "what" tests: they call it and assert on the records
 * it returns.
 */

Deno.test("buildHypotenuseDataSet - default grid holds out the probe row", () => {
  const ts = buildHypotenuseDataSet();

  assert(ts.length > 0, "the default grid must produce records");
  assert(
    ts.every((record) => record.input[0] !== HYPOTENUSE_HOLD_OUT),
    `no record may carry input[0] === ${HYPOTENUSE_HOLD_OUT}`,
  );
});

Deno.test("buildHypotenuseDataSet - every record is the true hypotenuse", () => {
  for (const record of buildHypotenuseDataSet({ step: 25 })) {
    const [i, j] = record.input;
    assertEquals(record.output.length, 1);
    assertEquals(record.output[0], Math.fround(Math.sqrt(i * i + j * j)));
  }
});

Deno.test("buildHypotenuseDataSet - the stride spans the whole grid", () => {
  const step = 5;
  const size = 100;
  const ts = buildHypotenuseDataSet({ step, size });

  const first = ts.map((record) => record.input[0]);
  const second = ts.map((record) => record.input[1]);

  assertEquals(Math.min(...first), 0);
  assertEquals(Math.max(...first), size - step);
  assertEquals(Math.min(...second), 0);
  assertEquals(Math.max(...second), size - step);
  // 20 strides per axis, less the held-out row of 20.
  assertEquals(ts.length, 20 * 20 - 20);
});

Deno.test("buildHypotenuseDataSet - step 1 reproduces the dense grid", () => {
  const ts = buildHypotenuseDataSet({ step: 1 });
  assertEquals(ts.length, 100 * 100 - 100);
});

Deno.test("buildHypotenuseDataSet - a hold-out off the grid keeps every row", () => {
  const ts = buildHypotenuseDataSet({ step: 25, holdOut: -1 });
  assertEquals(ts.length, 4 * 4);
});

Deno.test("buildHypotenuseDataSet - rejects an unusable stride", () => {
  for (const step of [0, -5, 2.5, 200, Number.NaN]) {
    assertThrows(
      () => buildHypotenuseDataSet({ step }),
      RangeError,
      "step",
      `step ${step} must be refused rather than silently coerced`,
    );
  }
});

Deno.test("buildHypotenuseDataSet - rejects an unusable grid size", () => {
  for (const size of [0, -1, 7.5]) {
    assertThrows(
      () => buildHypotenuseDataSet({ size }),
      RangeError,
      "size",
    );
  }
});
