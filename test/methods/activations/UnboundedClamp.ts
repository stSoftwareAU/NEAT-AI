/**
 * Tests that unbounded activation functions clamp their output to prevent
 * numerical overflow. Fixes #2151.
 *
 * Each test exercises real squash() calls with extreme inputs and asserts
 * the result is finite and within the declared range.
 */

import { assert } from "@std/assert";
import { TAN } from "@methods/activations/types/TAN.ts";
import { SQUARE } from "@methods/activations/types/SQUARE.ts";
import { Cube } from "@methods/activations/types/Cube.ts";

// --- TAN clamping ---

Deno.test("TAN: output clamped for input near π/2 asymptote", () => {
  const tan = new TAN();
  const x = Math.PI / 2 - 1e-15;
  const result = tan.squash(x);
  assert(
    Number.isFinite(result),
    `TAN squash(${x}) = ${result}, expected finite`,
  );
  assert(
    Math.abs(result) <= 1000,
    `TAN squash(${x}) = ${result}, expected |result| <= 1000`,
  );
});

Deno.test("TAN: output clamped for input near -π/2 asymptote", () => {
  const tan = new TAN();
  const x = -Math.PI / 2 + 1e-15;
  const result = tan.squash(x);
  assert(
    Number.isFinite(result),
    `TAN squash(${x}) = ${result}, expected finite`,
  );
  assert(
    Math.abs(result) <= 1000,
    `TAN squash(${x}) = ${result}, expected |result| <= 1000`,
  );
});

Deno.test("TAN: output clamped for large positive input", () => {
  const tan = new TAN();
  const result = tan.squash(1e10);
  assert(
    Number.isFinite(result),
    `TAN squash(1e10) = ${result}, expected finite`,
  );
  assert(
    Math.abs(result) <= 1000,
    `TAN squash(1e10) = ${result}, expected |result| <= 1000`,
  );
});

Deno.test("TAN: range reflects clamped bounds", () => {
  const tan = new TAN();
  assert(
    tan.range.low >= -1000,
    `TAN range.low = ${tan.range.low}, expected >= -1000`,
  );
  assert(
    tan.range.high <= 1000,
    `TAN range.high = ${tan.range.high}, expected <= 1000`,
  );
});

// --- SQUARE clamping ---

Deno.test("SQUARE: output clamped for very large input", () => {
  const square = new SQUARE();
  const result = square.squash(1e30);
  assert(
    Number.isFinite(result),
    `SQUARE squash(1e30) = ${result}, expected finite`,
  );
  assert(
    result <= 1e6,
    `SQUARE squash(1e30) = ${result}, expected <= 1e6`,
  );
});

Deno.test("SQUARE: output clamped for large negative input", () => {
  const square = new SQUARE();
  const result = square.squash(-1e30);
  assert(
    Number.isFinite(result),
    `SQUARE squash(-1e30) = ${result}, expected finite`,
  );
  assert(
    result <= 1e6,
    `SQUARE squash(-1e30) = ${result}, expected <= 1e6`,
  );
});

Deno.test("SQUARE: range reflects clamped bounds", () => {
  const square = new SQUARE();
  assert(
    square.range.high <= 1e6,
    `SQUARE range.high = ${square.range.high}, expected <= 1e6`,
  );
});

// --- CUBE clamping ---

Deno.test("CUBE: output clamped for very large positive input", () => {
  const cube = new Cube();
  const result = cube.squash(1e30);
  assert(
    Number.isFinite(result),
    `CUBE squash(1e30) = ${result}, expected finite`,
  );
  assert(
    result <= 1e6,
    `CUBE squash(1e30) = ${result}, expected <= 1e6`,
  );
});

Deno.test("CUBE: output clamped for very large negative input", () => {
  const cube = new Cube();
  const result = cube.squash(-1e30);
  assert(
    Number.isFinite(result),
    `CUBE squash(-1e30) = ${result}, expected finite`,
  );
  assert(
    result >= -1e6,
    `CUBE squash(-1e30) = ${result}, expected >= -1e6`,
  );
});

Deno.test("CUBE: range reflects clamped bounds", () => {
  const cube = new Cube();
  assert(
    cube.range.high <= 1e6,
    `CUBE range.high = ${cube.range.high}, expected <= 1e6`,
  );
  assert(
    cube.range.low >= -1e6,
    `CUBE range.low = ${cube.range.low}, expected >= -1e6`,
  );
});

// --- Cross-cutting: no output can reach extreme magnitudes ---

Deno.test("No activation produces magnitudes like 1e63", () => {
  const activations = [
    { name: "TAN", fn: new TAN() },
    { name: "SQUARE", fn: new SQUARE() },
    { name: "CUBE", fn: new Cube() },
  ];

  const extremeInputs = [1e30, -1e30, 1e15, -1e15, 1e6, -1e6];

  for (const { name, fn } of activations) {
    for (const x of extremeInputs) {
      const result = fn.squash(x);
      assert(
        Number.isFinite(result),
        `${name} squash(${x}) = ${result}, expected finite`,
      );
      assert(
        Math.abs(result) < 1e7,
        `${name} squash(${x}) = ${result}, magnitude too large (>= 1e7)`,
      );
    }
  }
});
