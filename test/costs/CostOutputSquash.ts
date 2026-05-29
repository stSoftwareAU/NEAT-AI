/**
 * Tests for cost → output squash coupling (Issue #2793).
 *
 * Acceptance criteria covered:
 *  - Multi-output classification cost (CROSS_ENTROPY) ⇒ SOFTMAX outputs.
 *  - Single-output probability (BINARY_CROSS_ENTROPY) ⇒ LOGISTIC outputs.
 *  - Margin classifier (HINGE) ⇒ TANH outputs.
 *  - Regression (MSE / MAE / unknown) ⇒ undefined (preserves the legacy
 *    random-per-output behaviour the rest of the project relies on).
 */
import { assertEquals } from "@std/assert";
import { pickOutputSquashForCost } from "@costs/CostOutputSquash.ts";

Deno.test("pickOutputSquashForCost - CROSS_ENTROPY with >=2 outputs uses SOFTMAX", () => {
  assertEquals(pickOutputSquashForCost("CROSS_ENTROPY", 10), "SOFTMAX");
  assertEquals(pickOutputSquashForCost("CROSS_ENTROPY", 2), "SOFTMAX");
});

Deno.test("pickOutputSquashForCost - CROSS_ENTROPY with single output falls back to LOGISTIC", () => {
  assertEquals(pickOutputSquashForCost("CROSS_ENTROPY", 1), "LOGISTIC");
});

Deno.test("pickOutputSquashForCost - BINARY_CROSS_ENTROPY uses LOGISTIC", () => {
  assertEquals(pickOutputSquashForCost("BINARY_CROSS_ENTROPY", 1), "LOGISTIC");
  // Multi-output independent binary tasks also use LOGISTIC.
  assertEquals(pickOutputSquashForCost("BINARY_CROSS_ENTROPY", 5), "LOGISTIC");
});

Deno.test("pickOutputSquashForCost - HINGE uses TANH (bounded bipolar)", () => {
  assertEquals(pickOutputSquashForCost("HINGE", 1), "TANH");
});

Deno.test("pickOutputSquashForCost - MSE/MAE leave the output squash unset", () => {
  // MSE and MAE expect unbounded linear-ish outputs; the caller may pick
  // IDENTITY or fall back to the existing random-per-output behaviour. We
  // do not force an activation so the regression path is unchanged.
  assertEquals(pickOutputSquashForCost("MSE", 1), undefined);
  assertEquals(pickOutputSquashForCost("MAE", 1), undefined);
});

Deno.test("pickOutputSquashForCost - unknown / undefined cost leaves output squash unset", () => {
  assertEquals(pickOutputSquashForCost(undefined, 10), undefined);
  assertEquals(pickOutputSquashForCost("CUSTOM_COST", 10), undefined);
});

Deno.test("pickOutputSquashForCost - zero/invalid output count returns undefined", () => {
  assertEquals(pickOutputSquashForCost("CROSS_ENTROPY", 0), undefined);
  assertEquals(pickOutputSquashForCost("CROSS_ENTROPY", -1), undefined);
});
