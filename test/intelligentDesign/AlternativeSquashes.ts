/**
 * Tests for alternative squashes list.
 */

import { assert, assertEquals } from "@std/assert";
import { alternativeSquashes } from "../../src/intelligentDesign/AlternativeSquashes.ts";

Deno.test("alternativeSquashes contains expected tier 1 functions", () => {
  const tier1 = ["GELU", "Swish", "LeakyReLU", "Mish", "SELU", "ELU", "TANH"];

  for (const squash of tier1) {
    assert(
      alternativeSquashes.includes(squash),
      `Missing tier 1 squash: ${squash}`,
    );
  }
});

Deno.test("alternativeSquashes contains expected tier 2 functions", () => {
  const tier2 = [
    "LOGISTIC",
    "Softplus",
    "ArcTan",
    "SOFTSIGN",
    "HARD_TANH",
    "BENT_IDENTITY",
  ];

  for (const squash of tier2) {
    assert(
      alternativeSquashes.includes(squash),
      `Missing tier 2 squash: ${squash}`,
    );
  }
});

Deno.test("alternativeSquashes does not contain unstable functions", () => {
  const unstable = [
    "ReLU",
    "BIPOLAR",
    "BIPOLAR_SIGMOID",
    "MINIMUM",
    "ReLU6",
    "Exponential",
    "STEP",
    "TAN",
    "COMPLEMENT",
    "StdInverse",
    "IDENTITY",
    "IF",
    "HYPOT",
    "HYPOTv2",
    "MAXIMUM",
  ];

  for (const squash of unstable) {
    assert(
      !alternativeSquashes.includes(squash),
      `Should not include unstable squash: ${squash}`,
    );
  }
});

Deno.test("alternativeSquashes has no duplicates", () => {
  const unique = new Set(alternativeSquashes);
  assertEquals(unique.size, alternativeSquashes.length);
});

Deno.test("alternativeSquashes is non-empty", () => {
  assert(alternativeSquashes.length > 0, "Should have at least one squash");
});
