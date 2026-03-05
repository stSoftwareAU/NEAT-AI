/**
 * Tests verifying DataSet makeDataDir throws typed ValidationError
 * instead of generic Error.
 *
 * Issue #1694
 */
import { assertIsError, assertThrows } from "@std/assert";
import { makeDataDir } from "../../src/architecture/DataSet.ts";
import { ValidationError } from "../../src/errors/ValidationError.ts";

Deno.test("makeDataDir - throws ValidationError for zero partitionBreak", () => {
  const err = assertThrows(() => makeDataDir([], 0));
  assertIsError(err, ValidationError);
});

Deno.test("makeDataDir - throws ValidationError for negative partitionBreak", () => {
  const err = assertThrows(() => makeDataDir([], -5));
  assertIsError(err, ValidationError);
});

Deno.test({
  name: "makeDataDir - throws ValidationError for input length mismatch",
  sanitizeResources: false,
  fn() {
    const dataSet = [
      { input: new Float32Array([1, 2]), output: new Float32Array([1]) },
    ];
    const err = assertThrows(() =>
      makeDataDir(dataSet, 10, { input: 3, output: 1 })
    );
    assertIsError(err, ValidationError);
  },
});

Deno.test({
  name: "makeDataDir - throws ValidationError for output length mismatch",
  sanitizeResources: false,
  fn() {
    const dataSet = [
      { input: new Float32Array([1, 2]), output: new Float32Array([1, 2]) },
    ];
    const err = assertThrows(() =>
      makeDataDir(dataSet, 10, { input: 2, output: 1 })
    );
    assertIsError(err, ValidationError);
  },
});
