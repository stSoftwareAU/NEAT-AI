/**
 * Tests verifying limitBias throws typed ValidationError
 * instead of generic Error for non-finite bias.
 *
 * Issue #1694
 */
import { assertIsError, assertThrows } from "@std/assert";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { limitBias } from "../../src/propagate/Bias.ts";
import { ValidationError } from "../../src/errors/ValidationError.ts";

Deno.test("limitBias - throws ValidationError for NaN targetBias", () => {
  const config = createBackPropagationConfig({ learningRate: 0.05 });
  const err = assertThrows(() => limitBias(NaN, 0.5, config));
  assertIsError(err, ValidationError);
});

Deno.test("limitBias - throws ValidationError for Infinity targetBias", () => {
  const config = createBackPropagationConfig({ learningRate: 0.05 });
  const err = assertThrows(() => limitBias(Infinity, 0.5, config));
  assertIsError(err, ValidationError);
});

Deno.test("limitBias - throws ValidationError for -Infinity targetBias", () => {
  const config = createBackPropagationConfig({ learningRate: 0.05 });
  const err = assertThrows(() => limitBias(-Infinity, 0.5, config));
  assertIsError(err, ValidationError);
});
