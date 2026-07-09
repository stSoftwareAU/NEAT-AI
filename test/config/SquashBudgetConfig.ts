/**
 * Tests for the opt-in squash budget configuration (Issue #3263):
 * `parseSquashBudget` validation and the `createNeatConfig` wiring that applies
 * the allow-list to the global activation registry.
 *
 * `createNeatConfig` mutates the global squash budget, so tests reset it in a
 * `finally` block for isolation.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { parseSquashBudget } from "@config/parsers/MutationParsers.ts";
import { Activations } from "@methods/activations/Activations.ts";
import { ActivationError } from "@errors/ActivationError.ts";
import { ValidationError } from "@errors/ValidationError.ts";

Deno.test("parseSquashBudget: defaults to an empty allow-list (free mix)", () => {
  assertEquals(parseSquashBudget(undefined), { allowedSquashes: [] });
  assertEquals(parseSquashBudget({}), { allowedSquashes: [] });
});

Deno.test("parseSquashBudget: passes through and de-duplicates names", () => {
  const parsed = parseSquashBudget({
    allowedSquashes: ["TANH", "ReLU", "TANH", " TANH "],
  });
  assertEquals(parsed.allowedSquashes, ["TANH", "ReLU"]);
});

Deno.test("parseSquashBudget: rejects a non-array allowedSquashes", () => {
  assertThrows(
    () => parseSquashBudget({ allowedSquashes: "TANH" }),
    ValidationError,
  );
});

Deno.test("parseSquashBudget: rejects non-string / empty entries", () => {
  assertThrows(
    () => parseSquashBudget({ allowedSquashes: ["TANH", 3] }),
    ValidationError,
  );
  assertThrows(
    () => parseSquashBudget({ allowedSquashes: ["TANH", "  "] }),
    ValidationError,
  );
});

Deno.test("createNeatConfig: default config leaves the budget unrestricted", () => {
  try {
    const config = createNeatConfig({});
    assertEquals(config.squashBudget.allowedSquashes, []);
    assertEquals(Activations.getAllowedSquashes(), null);
  } finally {
    Activations.resetAllowedSquashesForTesting();
  }
});

Deno.test("createNeatConfig: allowedSquashes applies the global budget", () => {
  try {
    const config = createNeatConfig({
      squashBudget: { allowedSquashes: ["TANH", "RELU"] },
    });
    assertEquals(config.squashBudget.allowedSquashes, ["TANH", "RELU"]);

    const allowed = Activations.getAllowedSquashes();
    assert(allowed !== null);
    // Aliases canonicalise: RELU -> ReLU.
    assert(allowed.has("TANH"));
    assert(allowed.has("ReLU"));
    for (let i = 0; i < 100; i++) {
      assert(["TANH", "ReLU"].includes(Activations.pickRandomSquash()));
    }
  } finally {
    Activations.resetAllowedSquashesForTesting();
  }
});

Deno.test("createNeatConfig: unknown squash name fails loud", () => {
  try {
    assertThrows(
      () =>
        createNeatConfig({
          squashBudget: { allowedSquashes: ["NOPE_NOT_REAL"] },
        }),
      ActivationError,
    );
  } finally {
    Activations.resetAllowedSquashesForTesting();
  }
});
