/**
 * Unit tests for weight/bias magnitude clamping utilities.
 *
 * Issue #2378: Defence-in-depth clamp that caps runaway weight/bias
 * magnitudes at Number.MAX_SAFE_INTEGER before they can overflow the
 * scorer or saturate downstream penalty curves.
 *
 * @module
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  clampWeightBias,
  clampWeightBiasDetail,
  MAX_SAFE_WEIGHT_BIAS,
} from "@utils/WeightBiasClamp.ts";

Deno.test("clampWeightBias: zero is unchanged", () => {
  assertStrictEquals(clampWeightBias(0), 0);
});

Deno.test("clampWeightBias: small positive value is unchanged", () => {
  assertStrictEquals(clampWeightBias(1.25), 1.25);
});

Deno.test("clampWeightBias: small negative value is unchanged", () => {
  assertStrictEquals(clampWeightBias(-7.5), -7.5);
});

Deno.test("clampWeightBias: value equal to MAX_SAFE_WEIGHT_BIAS is unchanged", () => {
  assertStrictEquals(
    clampWeightBias(MAX_SAFE_WEIGHT_BIAS),
    MAX_SAFE_WEIGHT_BIAS,
  );
});

Deno.test("clampWeightBias: positive value above MAX is clamped to MAX", () => {
  assertStrictEquals(
    clampWeightBias(1.1559466326634707e+195),
    MAX_SAFE_WEIGHT_BIAS,
  );
});

Deno.test("clampWeightBias: negative value below -MAX is clamped to -MAX", () => {
  assertStrictEquals(
    clampWeightBias(-1.1559466326634707e+195),
    -MAX_SAFE_WEIGHT_BIAS,
  );
});

Deno.test("clampWeightBias: value just above MAX is clamped", () => {
  // MAX_SAFE_INTEGER + small epsilon is unrepresentable distinctly, so use
  // a clearly-larger double.
  const v = MAX_SAFE_WEIGHT_BIAS * 2;
  assertStrictEquals(clampWeightBias(v), MAX_SAFE_WEIGHT_BIAS);
});

Deno.test("clampWeightBias: NaN is passed through (upstream validators flag it)", () => {
  assertEquals(Number.isNaN(clampWeightBias(NaN)), true);
});

Deno.test("clampWeightBias: +Infinity is passed through", () => {
  assertStrictEquals(clampWeightBias(Infinity), Infinity);
});

Deno.test("clampWeightBias: -Infinity is passed through", () => {
  assertStrictEquals(clampWeightBias(-Infinity), -Infinity);
});

Deno.test("clampWeightBiasDetail: in-range value reports clamped=false", () => {
  const result = clampWeightBiasDetail(42);
  assertStrictEquals(result.value, 42);
  assertStrictEquals(result.clamped, false);
});

Deno.test("clampWeightBiasDetail: overflow value reports clamped=true", () => {
  const result = clampWeightBiasDetail(1.1559466326634707e+195);
  assertStrictEquals(result.value, MAX_SAFE_WEIGHT_BIAS);
  assertStrictEquals(result.clamped, true);
});

Deno.test("clampWeightBiasDetail: negative overflow value reports clamped=true", () => {
  const result = clampWeightBiasDetail(-2.6680832284972457e+28);
  assertStrictEquals(result.value, -MAX_SAFE_WEIGHT_BIAS);
  assertStrictEquals(result.clamped, true);
});

Deno.test("clampWeightBiasDetail: NaN is passed through with clamped=false", () => {
  const result = clampWeightBiasDetail(NaN);
  assertEquals(Number.isNaN(result.value), true);
  assertStrictEquals(result.clamped, false);
});
