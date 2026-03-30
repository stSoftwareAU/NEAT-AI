/**
 * Issue #1901 - Data quantisation for training regularisation.
 *
 * Tests that quantisation correctly snaps continuous values to discrete
 * levels and handles edge cases.
 */
import {
  assertAlmostEquals,
  assertEquals,
  assertGreaterOrEqual,
  assertLessOrEqual,
} from "@std/assert";
import { quantiseBuffer } from "@propagate/DataQuantisation.ts";
import { DEFAULT_DATA_QUANTISATION_CONFIG } from "@config/DataQuantisationConfig.ts";
import { parseDataQuantisation } from "@config/NeatConfigParsers.ts";

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

Deno.test("DataQuantisation defaults are disabled", () => {
  assertEquals(DEFAULT_DATA_QUANTISATION_CONFIG.enabled, false);
  assertEquals(DEFAULT_DATA_QUANTISATION_CONFIG.inputLevels, 256);
  assertEquals(DEFAULT_DATA_QUANTISATION_CONFIG.outputLevels, 0);
});

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

Deno.test("DataQuantisation parser applies defaults when undefined", () => {
  const config = parseDataQuantisation(undefined);
  assertEquals(config.enabled, false);
  assertEquals(config.inputLevels, 256);
  assertEquals(config.outputLevels, 0);
});

Deno.test("DataQuantisation parser accepts overrides", () => {
  const config = parseDataQuantisation({
    enabled: true,
    inputLevels: 16,
    outputLevels: 8,
  });
  assertEquals(config.enabled, true);
  assertEquals(config.inputLevels, 16);
  assertEquals(config.outputLevels, 8);
});

Deno.test("DataQuantisation parser coerces numeric strings", () => {
  const config = parseDataQuantisation({
    inputLevels: "128",
    outputLevels: "64",
  });
  assertEquals(config.inputLevels, 128);
  assertEquals(config.outputLevels, 64);
});

Deno.test("DataQuantisation parser allows outputLevels of 0 (disabled)", () => {
  const config = parseDataQuantisation({
    outputLevels: 0,
  });
  assertEquals(config.outputLevels, 0);
});

// ---------------------------------------------------------------------------
// quantiseBuffer - basic quantisation
// ---------------------------------------------------------------------------

Deno.test("quantiseBuffer snaps values to discrete levels", () => {
  // 4 levels over range [0, 1] => bin centres at 0, 1/3, 2/3, 1
  const buffer = new Float32Array([0.0, 0.1, 0.4, 0.6, 0.9, 1.0]);
  quantiseBuffer(buffer, 4);

  // Expected: 0 -> 0, 0.1 -> 0, 0.4 -> 1/3, 0.6 -> 2/3, 0.9 -> 1, 1.0 -> 1
  assertAlmostEquals(buffer[0], 0.0, 1e-6);
  assertAlmostEquals(buffer[1], 0.0, 1e-6);
  assertAlmostEquals(buffer[2], 1 / 3, 1e-6);
  assertAlmostEquals(buffer[3], 2 / 3, 1e-6);
  assertAlmostEquals(buffer[4], 1.0, 1e-6);
  assertAlmostEquals(buffer[5], 1.0, 1e-6);
});

Deno.test("quantiseBuffer with 2 levels produces only min and max", () => {
  const buffer = new Float32Array([0.0, 0.3, 0.5, 0.7, 1.0]);
  quantiseBuffer(buffer, 2);

  // 2 levels => bin centres at 0 and 1
  assertAlmostEquals(buffer[0], 0.0, 1e-6);
  assertAlmostEquals(buffer[1], 0.0, 1e-6);
  assertAlmostEquals(buffer[2], 1.0, 1e-6);
  assertAlmostEquals(buffer[3], 1.0, 1e-6);
  assertAlmostEquals(buffer[4], 1.0, 1e-6);
});

Deno.test("quantiseBuffer respects level count (at most N distinct values)", () => {
  const levels = 4;
  const buffer = new Float32Array(100);
  for (let i = 0; i < 100; i++) {
    buffer[i] = i / 99; // Values 0..1
  }

  quantiseBuffer(buffer, levels);

  const distinct = new Set<number>();
  for (let i = 0; i < buffer.length; i++) {
    // Round to avoid floating point differences
    distinct.add(Math.round(buffer[i] * 1e9) / 1e9);
  }

  assertLessOrEqual(distinct.size, levels);
});

// ---------------------------------------------------------------------------
// quantiseBuffer - edge cases
// ---------------------------------------------------------------------------

Deno.test("quantiseBuffer with single value does nothing", () => {
  const buffer = new Float32Array([5.0]);
  quantiseBuffer(buffer, 256);
  assertAlmostEquals(buffer[0], 5.0, 1e-6);
});

Deno.test("quantiseBuffer with all identical values does nothing", () => {
  const buffer = new Float32Array([3.0, 3.0, 3.0, 3.0]);
  quantiseBuffer(buffer, 4);
  for (let i = 0; i < buffer.length; i++) {
    assertAlmostEquals(buffer[i], 3.0, 1e-6);
  }
});

Deno.test("quantiseBuffer with two values snaps correctly", () => {
  const buffer = new Float32Array([1.0, 2.0]);
  quantiseBuffer(buffer, 3);

  // Range [1, 2], 3 levels => centres at 1.0, 1.5, 2.0
  assertAlmostEquals(buffer[0], 1.0, 1e-6);
  assertAlmostEquals(buffer[1], 2.0, 1e-6);
});

Deno.test("quantiseBuffer with empty buffer does nothing", () => {
  const buffer = new Float32Array(0);
  quantiseBuffer(buffer, 256); // Should not throw
  assertEquals(buffer.length, 0);
});

// ---------------------------------------------------------------------------
// quantiseBuffer - negative range
// ---------------------------------------------------------------------------

Deno.test("quantiseBuffer works with negative values (-1 to 1 range)", () => {
  // 3 levels over [-1, 1] => bin centres at -1, 0, 1
  const buffer = new Float32Array([-1.0, -0.4, 0.0, 0.4, 1.0]);
  quantiseBuffer(buffer, 3);

  assertAlmostEquals(buffer[0], -1.0, 1e-6);
  assertAlmostEquals(buffer[1], 0.0, 1e-6);
  assertAlmostEquals(buffer[2], 0.0, 1e-6);
  assertAlmostEquals(buffer[3], 0.0, 1e-6);
  assertAlmostEquals(buffer[4], 1.0, 1e-6);
});

// ---------------------------------------------------------------------------
// quantiseBuffer - determinism
// ---------------------------------------------------------------------------

Deno.test("quantiseBuffer is deterministic (same input => same output)", () => {
  const input = new Float32Array([0.1, 0.25, 0.5, 0.75, 0.9]);
  const buf1 = new Float32Array(input);
  const buf2 = new Float32Array(input);

  quantiseBuffer(buf1, 8);
  quantiseBuffer(buf2, 8);

  assertEquals(buf1, buf2);
});

// ---------------------------------------------------------------------------
// quantiseBuffer - preserves min/max
// ---------------------------------------------------------------------------

Deno.test("quantiseBuffer preserves original min and max", () => {
  const buffer = new Float32Array([-1.0, -0.5, 0.0, 0.5, 1.0]);
  quantiseBuffer(buffer, 5);

  // Min and max should be preserved exactly
  let min = buffer[0];
  let max = buffer[0];
  for (let i = 1; i < buffer.length; i++) {
    if (buffer[i] < min) min = buffer[i];
    if (buffer[i] > max) max = buffer[i];
  }

  assertAlmostEquals(min, -1.0, 1e-6);
  assertAlmostEquals(max, 1.0, 1e-6);
});

// ---------------------------------------------------------------------------
// quantiseBuffer - values stay within original range
// ---------------------------------------------------------------------------

Deno.test("quantiseBuffer keeps values within original range", () => {
  const buffer = new Float32Array(50);
  for (let i = 0; i < 50; i++) {
    buffer[i] = -1 + (2 * i) / 49;
  }

  quantiseBuffer(buffer, 16);

  for (let i = 0; i < buffer.length; i++) {
    assertGreaterOrEqual(buffer[i], -1.0 - 1e-6);
    assertLessOrEqual(buffer[i], 1.0 + 1e-6);
  }
});
