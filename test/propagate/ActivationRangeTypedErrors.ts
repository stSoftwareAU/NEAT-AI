/**
 * Tests verifying ActivationRange throws typed ActivationError
 * instead of generic Error.
 *
 * Issue #1694
 */
import { assertEquals, assertIsError, assertThrows } from "@std/assert";
import { ActivationRange } from "@propagate/ActivationRange.ts";
import { ActivationError } from "@errors/ActivationError.ts";

Deno.test("ActivationRange validate - throws ActivationError for out-of-range value", () => {
  const range = new ActivationRange("TANH", -1, 1);
  const err = assertThrows(() => range.validate(2.0));
  assertIsError(err, ActivationError);
  const ae = err as ActivationError;
  assertEquals(
    ae.reason,
    "NON_FINITE_RESULT",
    "Expected NON_FINITE_RESULT reason",
  );
});

Deno.test("ActivationRange validate - throws ActivationError for NaN", () => {
  const range = new ActivationRange("LOGISTIC", 0, 1);
  const err = assertThrows(() => range.validate(NaN));
  assertIsError(err, ActivationError);
  const ae = err as ActivationError;
  assertEquals(
    ae.reason,
    "NON_FINITE_RESULT",
    "Expected NON_FINITE_RESULT reason",
  );
});

Deno.test("ActivationRange limit - throws ActivationError for NaN", () => {
  const range = new ActivationRange("TANH", -1, 1);
  const err = assertThrows(() => range.limit(NaN));
  assertIsError(err, ActivationError);
  const ae = err as ActivationError;
  assertEquals(
    ae.reason,
    "NON_FINITE_RESULT",
    "Expected NON_FINITE_RESULT reason",
  );
});

Deno.test("ActivationRange limit - throws ActivationError for NaN with rawInput", () => {
  const range = new ActivationRange("ReLU", 0, 1e15);
  const err = assertThrows(() => range.limit(NaN, 42));
  assertIsError(err, ActivationError);
  const ae = err as ActivationError;
  assertEquals(ae.activation, "ReLU", "Expected ReLU activation");
});
