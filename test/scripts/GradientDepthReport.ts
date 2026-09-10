/**
 * Tests for scripts/gradientDepthReport.ts
 *
 * Issue #3972 — the report is the artefact a human reads, so its input parsing
 * has to refuse bad data loudly rather than quietly profiling the wrong rows.
 */

import {
  assertAlmostEquals,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import { probeGradientDepth } from "@propagate/GradientDepthProbe.ts";
import {
  numericFlag,
  parseFlags,
  parseObservations,
  renderProfile,
  syntheticObservations,
} from "../../scripts/gradientDepthReport.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test("gradientDepthReport - synthetic observations are seeded and reproducible", () => {
  const first = syntheticObservations(4, 3, 7);
  const again = syntheticObservations(4, 3, 7);
  const other = syntheticObservations(4, 3, 8);

  assertEquals(first.length, 3);
  assertEquals(first[0].length, 4);
  assertEquals([...first[0]], [...again[0]]);
  assertEquals([...first[0]].every((v) => v >= -1 && v < 1), true);
  assertEquals([...first[0]].join() === [...other[0]].join(), false);
});

Deno.test("gradientDepthReport - a corpus is parsed, a malformed one is refused", () => {
  const rows = parseObservations("[[0.5, -0.5], [1, 0]]", 2);
  assertEquals(rows.length, 2);
  assertEquals([...rows[0]], [0.5, -0.5]);

  assertThrows(
    () => parseObservations("[]", 2),
    RangeError,
    "non-empty JSON array",
  );
  assertThrows(
    () => parseObservations("[[1]]", 2),
    RangeError,
    "array of 2 numbers",
  );
  assertThrows(
    () => parseObservations('[[1, "x"]]', 2),
    RangeError,
    "not a finite number",
  );
  assertThrows(
    () => parseObservations("[[1, null]]", 2),
    RangeError,
    "not a finite number",
  );
});

Deno.test("gradientDepthReport - an unknown or valueless flag is refused", () => {
  const flags = parseFlags(["--creature", "a.json", "--seed", "9"], [
    "creature",
    "seed",
  ]);
  assertEquals(flags.get("creature"), "a.json");
  assertEquals(flags.get("seed"), "9");

  assertThrows(
    () => parseFlags(["--nope", "1"], ["creature"]),
    RangeError,
    'unknown flag "--nope"',
  );
  assertThrows(
    () => parseFlags(["--creature"], ["creature"]),
    RangeError,
    "needs a value",
  );
  assertThrows(
    () => parseFlags(["creature", "a.json"], ["creature"]),
    RangeError,
    "expected a --flag",
  );
});

Deno.test("gradientDepthReport - renders a profile as a Markdown table", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 2 },
      { fromUUID: "h1", toUUID: "output-0", weight: 3 },
    ],
  });

  const profile = probeGradientDepth(creature, [new Float32Array([0.5])]);
  const markdown = renderProfile("unit", profile, "test rows");

  assertStringIncludes(markdown, "## unit");
  assertStringIncludes(markdown, "- observations: 1 rows (test rows)");
  assertStringIncludes(markdown, "- deepest layer: 2");
  assertStringIncludes(markdown, "- serial chain: depth 1–2, 2 neurons");
  assertStringIncludes(markdown, "| 1 | 1 | 1 | 0.0% | 3.00e+0 |");
});

Deno.test("gradientDepthReport - numeric flags refuse anything that is not a number", () => {
  assertEquals(numericFlag("seed", undefined, 42), 42);
  assertEquals(numericFlag("seed", "7", 42), 7);
  assertEquals(numericFlag("scale", "0.01", 1), 0.01);

  // `Number("abc")` is NaN — seeding an RNG with it, or asking for NaN rows,
  // used to pass silently.
  assertThrows(
    () => numericFlag("seed", "abc", 42),
    RangeError,
    "must be a finite number",
  );
  assertThrows(
    () => numericFlag("samples", "2.5", 64, { integer: true }),
    RangeError,
    "must be a whole number",
  );
  assertThrows(
    () => numericFlag("samples", "-5", 64, { integer: true, minimum: 1 }),
    RangeError,
    "must be at least 1",
  );
});

Deno.test("gradientDepthReport - the scale factor widens the synthetic rows", () => {
  const wide = syntheticObservations(8, 4, 3);
  const narrow = syntheticObservations(8, 4, 3, 0.01);

  assertEquals([...narrow[0]].every((v) => Math.abs(v) <= 0.01), true);
  // Same seed, same draw — so the rows differ only by the scale factor.
  for (let i = 0; i < wide[0].length; i++) {
    assertAlmostEquals(narrow[0][i] * 100, wide[0][i], 1e-5);
  }
});
