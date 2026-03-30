/**
 * Unit tests for the shared safeZoneAdjustment() utility function.
 *
 * Verifies that the extracted safe zone logic behaves correctly
 * with configurable safeMin, safeMax, and fadeWidth parameters.
 *
 * @module
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { safeZoneAdjustment } from "@methods/activations/SafeZoneAdjustment.ts";

// --- Non-finite input ---

Deno.test("safeZoneAdjustment: returns 0 for NaN rawInput", () => {
  assertEquals(safeZoneAdjustment(NaN, 0.1, 1, -10, 10), 0);
});

Deno.test("safeZoneAdjustment: returns 0 for Infinity rawInput", () => {
  assertEquals(safeZoneAdjustment(Infinity, 0.1, 1, -10, 10), 0);
});

Deno.test("safeZoneAdjustment: returns 0 for -Infinity rawInput", () => {
  assertEquals(safeZoneAdjustment(-Infinity, 0.1, 1, -10, 10), 0);
});

// --- Inside safe zone ---

Deno.test("safeZoneAdjustment: returns 1 inside safe zone", () => {
  assertEquals(safeZoneAdjustment(0, 0.1, 1, -10, 10), 1);
  assertEquals(safeZoneAdjustment(5, 0.1, 1, -10, 10), 1);
  assertEquals(safeZoneAdjustment(-5, 0.1, 1, -10, 10), 1);
});

Deno.test("safeZoneAdjustment: returns 1 at safe zone boundaries", () => {
  assertEquals(safeZoneAdjustment(-10, 0.1, 1, -10, 10), 1);
  assertEquals(safeZoneAdjustment(10, 0.1, 1, -10, 10), 1);
});

// --- Weight adjustment logic ---

Deno.test("safeZoneAdjustment: returns 0 in safe zone when weight too small and improving", () => {
  // weight=0.0001 (too small), weight*error > 0 means improving
  assertEquals(safeZoneAdjustment(0, 0.1, 0.0001, -10, 10), 0);
});

Deno.test("safeZoneAdjustment: returns 0 in safe zone when weight too large and improving", () => {
  // weight=5000 (too large), weight*error < 0 means improving
  assertEquals(safeZoneAdjustment(0, -0.1, 5000, -10, 10), 0);
});

Deno.test("safeZoneAdjustment: returns 1 in safe zone when weight is normal", () => {
  assertEquals(safeZoneAdjustment(0, 0.1, 1, -10, 10), 1);
  assertEquals(safeZoneAdjustment(0, -0.1, 1, -10, 10), 1);
});

// --- Outside safe zone and getting worse ---

Deno.test("safeZoneAdjustment: returns 0 when below safeMin and error negative", () => {
  assertEquals(safeZoneAdjustment(-15, -0.1, 1, -10, 10), 0);
});

Deno.test("safeZoneAdjustment: returns 0 when above safeMax and error positive", () => {
  assertEquals(safeZoneAdjustment(15, 0.1, 1, -10, 10), 0);
});

// --- Fade zone above safeMax ---

Deno.test("safeZoneAdjustment: fade zone above safeMax with default fadeWidth=10", () => {
  // rawInput=15, safeMax=10, fade = 1 - (15-10)/10 = 0.5
  assertAlmostEquals(safeZoneAdjustment(15, -0.1, 1, -10, 10), 0.5, 0.001);
});

Deno.test("safeZoneAdjustment: fade zone just outside safeMax", () => {
  // rawInput=11, safeMax=10, fade = 1 - (11-10)/10 = 0.9
  assertAlmostEquals(safeZoneAdjustment(11, -0.1, 1, -10, 10), 0.9, 0.001);
});

Deno.test("safeZoneAdjustment: fade zone at edge of fade region above", () => {
  // rawInput=20, safeMax=10, fade = 1 - (20-10)/10 = 0
  assertAlmostEquals(safeZoneAdjustment(20, -0.1, 1, -10, 10), 0, 0.001);
});

// --- Fade zone below safeMin ---

Deno.test("safeZoneAdjustment: fade zone below safeMin", () => {
  // rawInput=-15, safeMin=-10, fade = 1 - (-10-(-15))/10 = 0.5
  assertAlmostEquals(safeZoneAdjustment(-15, 0.1, 1, -10, 10), 0.5, 0.001);
});

Deno.test("safeZoneAdjustment: fade zone just outside safeMin", () => {
  // rawInput=-11, safeMin=-10, fade = 1 - (1)/10 = 0.9
  assertAlmostEquals(safeZoneAdjustment(-11, 0.1, 1, -10, 10), 0.9, 0.001);
});

// --- Far outside safe zone returns 0 ---

Deno.test("safeZoneAdjustment: returns 0 far beyond fade zone", () => {
  assertEquals(safeZoneAdjustment(100, -0.1, 1, -10, 10), 0);
  assertEquals(safeZoneAdjustment(-100, 0.1, 1, -10, 10), 0);
});

// --- Custom safeMin/safeMax ---

Deno.test("safeZoneAdjustment: respects custom GELU bounds [-6, 6]", () => {
  assertEquals(safeZoneAdjustment(0, 0.1, 1, -6, 6), 1);
  assertEquals(safeZoneAdjustment(6, 0.1, 1, -6, 6), 1);
  // rawInput=11, safeMax=6, fade = 1 - (11-6)/10 = 0.5
  assertAlmostEquals(safeZoneAdjustment(11, -0.1, 1, -6, 6), 0.5, 0.001);
});

Deno.test("safeZoneAdjustment: respects custom Softplus bounds [-10, 20]", () => {
  assertEquals(safeZoneAdjustment(15, 0.1, 1, -10, 20), 1);
  assertEquals(safeZoneAdjustment(20, 0.1, 1, -10, 20), 1);
  // rawInput=25, safeMax=20, fade = 1 - (25-20)/10 = 0.5
  assertAlmostEquals(safeZoneAdjustment(25, -0.1, 1, -10, 20), 0.5, 0.001);
});

Deno.test("safeZoneAdjustment: respects custom Exponential bounds [-10, 30]", () => {
  assertEquals(safeZoneAdjustment(25, 0.1, 1, -10, 30), 1);
  // rawInput=35, safeMax=30, fade = 1 - (35-30)/10 = 0.5
  assertAlmostEquals(safeZoneAdjustment(35, -0.1, 1, -10, 30), 0.5, 0.001);
});

// --- Custom fadeWidth ---

Deno.test("safeZoneAdjustment: respects custom fadeWidth=20", () => {
  // LeakyReLU-style: safeMin=-50, safeMax=50, fadeWidth=20
  assertEquals(safeZoneAdjustment(40, 0.1, 1, -50, 50, 20), 1);
  // rawInput=60, safeMax=50, fade = 1 - (60-50)/20 = 0.5
  assertAlmostEquals(safeZoneAdjustment(60, -0.1, 1, -50, 50, 20), 0.5, 0.001);
  assertEquals(safeZoneAdjustment(70, -0.1, 1, -50, 50, 20), 0);
});

Deno.test("safeZoneAdjustment: respects custom fadeWidth=3", () => {
  // GAUSSIAN-style: safeMin=-3, safeMax=3, fadeWidth=3
  assertEquals(safeZoneAdjustment(0, 0.1, 1, -3, 3, 3), 1);
  // rawInput=4.5, safeMax=3, fade = 1 - (4.5-3)/3 = 0.5
  assertAlmostEquals(safeZoneAdjustment(4.5, -0.1, 1, -3, 3, 3), 0.5, 0.001);
  assertEquals(safeZoneAdjustment(6, -0.1, 1, -3, 3, 3), 0);
  assertEquals(safeZoneAdjustment(7, -0.1, 1, -3, 3, 3), 0);
});

Deno.test("safeZoneAdjustment: respects custom fadeWidth=4", () => {
  // BIPOLAR_SIGMOID-style: safeMin=-4, safeMax=4, fadeWidth=4
  assertEquals(safeZoneAdjustment(0, 0.1, 1, -4, 4, 4), 1);
  // rawInput=6, safeMax=4, fade = 1 - (6-4)/4 = 0.5
  assertAlmostEquals(safeZoneAdjustment(6, -0.1, 1, -4, 4, 4), 0.5, 0.001);
});

// --- All results must be in [0, 1] ---

Deno.test("safeZoneAdjustment: all results are in [0, 1] range", () => {
  const inputs = [-1000, -50, -10, -1, 0, 1, 10, 50, 1000];
  const errors = [-1, -0.1, 0, 0.1, 1];
  const weights = [-10, -1, -0.001, 0.001, 1, 10];

  for (const raw of inputs) {
    for (const err of errors) {
      for (const w of weights) {
        const result = safeZoneAdjustment(raw, err, w, -10, 10);
        if (result < 0 || result > 1) {
          throw new Error(
            `safeZoneAdjustment(${raw}, ${err}, ${w}, -10, 10) = ${result}, expected [0, 1]`,
          );
        }
      }
    }
  }
});
