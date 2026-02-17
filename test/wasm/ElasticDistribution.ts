/**
 * Issue #1519 - Tests for WASM elastic error distribution.
 *
 * Verifies that the WASM implementation of distributeElasticError produces
 * results matching the TypeScript implementation across all code paths:
 * primary (activation²), weight-based fallback, and equal split.
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  initWasmActivation,
  isWasmActivationAvailable,
  wasmDistributeElasticError,
} from "../../src/wasm/mod.ts";

// Initialise WASM before tests
const wasmAvailable = await initWasmActivation();

Deno.test("WASM elastic: available", () => {
  assertEquals(wasmAvailable, true, "WASM should be available");
  assertEquals(isWasmActivationAvailable(), true);
});

Deno.test("WASM elastic: basic proportional distribution", () => {
  if (!wasmAvailable) return;

  // activation²: 1²=1, 2²=4 → shares: 2 and 8
  const result = wasmDistributeElasticError(
    10.0,
    new Float64Array([1.0, 2.0]),
    new Float64Array([1.0, 1.0]),
    new Float64Array([Number.NaN, Number.NaN]),
    1e-12,
  );

  assertEquals(result !== undefined, true);
  const shares = result!;
  assertEquals(shares.length, 2);
  assertAlmostEquals(shares[0], 2.0, 1e-9);
  assertAlmostEquals(shares[1], 8.0, 1e-9);
});

Deno.test("WASM elastic: safe zone blocks link", () => {
  if (!wasmAvailable) return;

  const shares = wasmDistributeElasticError(
    10.0,
    new Float64Array([1.0, 2.0]),
    new Float64Array([0.0, 1.0]),
    new Float64Array([Number.NaN, Number.NaN]),
    1e-12,
  )!;

  assertAlmostEquals(shares[0], 0, 1e-9);
  assertAlmostEquals(shares[1], 10.0, 1e-9);
});

Deno.test("WASM elastic: weight-based fallback", () => {
  if (!wasmAvailable) return;

  const shares = wasmDistributeElasticError(
    10.0,
    new Float64Array([0.0, 0.0]),
    new Float64Array([1.0, 1.0]),
    new Float64Array([1.0, 3.0]),
    1e-12,
  )!;

  // weight²: 1, 9 → shares: 1, 9
  assertAlmostEquals(shares[0], 1.0, 1e-9);
  assertAlmostEquals(shares[1], 9.0, 1e-9);
});

Deno.test("WASM elastic: equal split fallback", () => {
  if (!wasmAvailable) return;

  const shares = wasmDistributeElasticError(
    10.0,
    new Float64Array([0.0, 0.0]),
    new Float64Array([1.0, 1.0]),
    new Float64Array([Number.NaN, Number.NaN]),
    1e-12,
  )!;

  assertAlmostEquals(shares[0], 5.0, 1e-9);
  assertAlmostEquals(shares[1], 5.0, 1e-9);
});

Deno.test("WASM elastic: empty links", () => {
  if (!wasmAvailable) return;

  const shares = wasmDistributeElasticError(
    10.0,
    new Float64Array([]),
    new Float64Array([]),
    new Float64Array([]),
    1e-12,
  )!;

  assertEquals(shares.length, 0);
});

Deno.test("WASM elastic: conservation with many links", () => {
  if (!wasmAvailable) return;

  const error = 42.0;
  const shares = wasmDistributeElasticError(
    error,
    new Float64Array([0.1, 0.5, 1.0, 2.0, 3.0]),
    new Float64Array([1.0, 0.9, 0.7, 0.5, 1.0]),
    new Float64Array([
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
    ]),
    1e-12,
  )!;

  let sum = 0;
  for (let i = 0; i < shares.length; i++) sum += shares[i];
  assertAlmostEquals(sum, error, 1e-9);
});

Deno.test("WASM elastic: negative error is conserved", () => {
  if (!wasmAvailable) return;

  const error = -15.3;
  const shares = wasmDistributeElasticError(
    error,
    new Float64Array([1.0, 2.0, 0.5]),
    new Float64Array([1.0, 1.0, 1.0]),
    new Float64Array([Number.NaN, Number.NaN, Number.NaN]),
    1e-12,
  )!;

  let sum = 0;
  for (let i = 0; i < shares.length; i++) sum += shares[i];
  assertAlmostEquals(sum, error, 1e-9);
});

Deno.test("WASM elastic: single link gets all error", () => {
  if (!wasmAvailable) return;

  const shares = wasmDistributeElasticError(
    12.0,
    new Float64Array([5.0]),
    new Float64Array([1.0]),
    new Float64Array([Number.NaN]),
    1e-12,
  )!;

  assertEquals(shares.length, 1);
  assertAlmostEquals(shares[0], 12.0, 1e-9);
});

Deno.test("WASM elastic: NaN activation treated as zero score", () => {
  if (!wasmAvailable) return;

  const shares = wasmDistributeElasticError(
    10.0,
    new Float64Array([Number.NaN, 2.0]),
    new Float64Array([1.0, 1.0]),
    new Float64Array([Number.NaN, Number.NaN]),
    1e-12,
  )!;

  assertAlmostEquals(shares[0], 0, 1e-9);
  assertAlmostEquals(shares[1], 10.0, 1e-9);
});

Deno.test("WASM elastic: safe zone clamped above 1", () => {
  if (!wasmAvailable) return;

  const shares = wasmDistributeElasticError(
    10.0,
    new Float64Array([1.0, 1.0]),
    new Float64Array([5.0, 1.0]),
    new Float64Array([Number.NaN, Number.NaN]),
    1e-12,
  )!;

  // Both clamped to 1, so equal shares
  assertAlmostEquals(shares[0], 5.0, 1e-9);
  assertAlmostEquals(shares[1], 5.0, 1e-9);
});

Deno.test("WASM elastic: negative safe zone treated as zero", () => {
  if (!wasmAvailable) return;

  const shares = wasmDistributeElasticError(
    10.0,
    new Float64Array([1.0, 1.0]),
    new Float64Array([-0.5, 1.0]),
    new Float64Array([Number.NaN, Number.NaN]),
    1e-12,
  )!;

  assertAlmostEquals(shares[0], 0, 1e-9);
  assertAlmostEquals(shares[1], 10.0, 1e-9);
});

Deno.test("WASM elastic: weight fallback conservation", () => {
  if (!wasmAvailable) return;

  const error = 13.7;
  const shares = wasmDistributeElasticError(
    error,
    new Float64Array([0.0, 0.0, 0.0]),
    new Float64Array([0.0, 0.0, 0.0]),
    new Float64Array([2.0, 5.0, 3.0]),
    1e-12,
  )!;

  let sum = 0;
  for (let i = 0; i < shares.length; i++) sum += shares[i];
  assertAlmostEquals(sum, error, 1e-9);
});
