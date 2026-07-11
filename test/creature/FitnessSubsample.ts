/**
 * Unit tests for the deterministic, stratified fitness record subsample
 * (Issue #3257).
 *
 * These verify the pure selection maths that both the streaming `evaluateDir`
 * reader and the ranking-pass benchmark rely on: the rate clamp mirrors
 * `trainingSampleRate`, the stride keeps exactly `floor(N * rate)` records,
 * the selection is fully deterministic (no RNG), and the optional phase
 * rotates the strata without changing the kept count.
 */

import { assert, assertEquals } from "@std/assert";
import {
  DEFAULT_FITNESS_SAMPLE_RATE,
  expectedSampledCount,
  MIN_FITNESS_SAMPLE_RATE,
  resolveFitnessSampleRate,
  shouldScoreRecord,
} from "../../src/creature/FitnessSubsample.ts";

function countKept(total: number, rate: number, phase = 0): number {
  let kept = 0;
  for (let i = 0; i < total; i++) {
    if (shouldScoreRecord(i, rate, phase)) kept++;
  }
  return kept;
}

Deno.test("resolveFitnessSampleRate - defaults to full corpus", () => {
  assertEquals(
    resolveFitnessSampleRate(undefined),
    DEFAULT_FITNESS_SAMPLE_RATE,
  );
  assertEquals(resolveFitnessSampleRate(undefined), 1);
});

Deno.test("resolveFitnessSampleRate - non-finite collapses to 1", () => {
  assertEquals(resolveFitnessSampleRate(Number.NaN), 1);
  assertEquals(resolveFitnessSampleRate(Number.POSITIVE_INFINITY), 1);
});

Deno.test("resolveFitnessSampleRate - clamps to [MIN, 1]", () => {
  assertEquals(resolveFitnessSampleRate(2), 1);
  assertEquals(resolveFitnessSampleRate(0), MIN_FITNESS_SAMPLE_RATE);
  assertEquals(resolveFitnessSampleRate(-0.5), MIN_FITNESS_SAMPLE_RATE);
  assertEquals(resolveFitnessSampleRate(0.5), 0.5);
});

Deno.test("shouldScoreRecord - rate 1 keeps every record", () => {
  for (let i = 0; i < 1000; i++) {
    assert(shouldScoreRecord(i, 1), `record ${i} must be kept at rate 1`);
  }
});

Deno.test("shouldScoreRecord - negative index is never kept", () => {
  assert(!shouldScoreRecord(-1, 0.5));
});

Deno.test("shouldScoreRecord - keeps exactly floor(N*rate) records", () => {
  for (const total of [10, 100, 997, 2048]) {
    for (const rate of [0.5, 0.25, 0.1, 0.05]) {
      assertEquals(
        countKept(total, rate),
        Math.floor(total * rate),
        `total=${total} rate=${rate}`,
      );
    }
  }
});

Deno.test("shouldScoreRecord - stride is evenly spread (stratified)", () => {
  // At rate 0.5 the kept records must alternate — never two adjacent gaps of
  // the same parity clustering at one end.
  const kept: number[] = [];
  for (let i = 0; i < 10; i++) {
    if (shouldScoreRecord(i, 0.5)) kept.push(i);
  }
  assertEquals(kept, [1, 3, 5, 7, 9]);
});

Deno.test("shouldScoreRecord - is deterministic across calls", () => {
  const runA: boolean[] = [];
  const runB: boolean[] = [];
  for (let i = 0; i < 500; i++) runA.push(shouldScoreRecord(i, 0.17));
  for (let i = 0; i < 500; i++) runB.push(shouldScoreRecord(i, 0.17));
  assertEquals(runA, runB);
});

Deno.test("shouldScoreRecord - phase rotates strata, keeps count stable", () => {
  const total = 100;
  const rate = 0.3;
  const base = countKept(total, rate, 0);
  // A non-zero phase selects a different set but the same-sized set (within
  // one record, due to the prefix boundary) so ranking cost stays ~constant.
  for (const phase of [1, 7, 33]) {
    const shifted = countKept(total, rate, phase);
    assert(
      Math.abs(shifted - base) <= 1,
      `phase ${phase} kept ${shifted}, base ${base}`,
    );
  }
  // The selected set genuinely differs for at least one phase.
  const setA = new Set<number>();
  const setB = new Set<number>();
  for (let i = 0; i < total; i++) {
    if (shouldScoreRecord(i, rate, 0)) setA.add(i);
    if (shouldScoreRecord(i, rate, 1)) setB.add(i);
  }
  let differs = false;
  for (const v of setA) {
    if (!setB.has(v)) {
      differs = true;
      break;
    }
  }
  assert(differs, "phase 1 must differ from phase 0");
});

Deno.test("expectedSampledCount - matches the stride", () => {
  assertEquals(expectedSampledCount(0, 0.5), 0);
  assertEquals(expectedSampledCount(100, 1), 100);
  assertEquals(expectedSampledCount(100, 0.25), 25);
  assertEquals(expectedSampledCount(997, 0.1), 99);
  // Out-of-range rate is clamped before counting.
  assertEquals(expectedSampledCount(100, 2), 100);
});
