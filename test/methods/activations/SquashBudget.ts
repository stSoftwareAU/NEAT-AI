/**
 * Unit tests for the opt-in squash budget / activation allow-list on the
 * Activations registry (Issue #3263).
 *
 * The budget guarantees mutation and neuron creation can never introduce a
 * disallowed squash, so these tests assert the allow-list is honoured, aliases
 * canonicalise, unknown names fail loud, and the restriction can be cleared.
 *
 * Every test resets the global budget in a `finally` block because the budget
 * is a per-worker global (mirrors the RNG global).
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Activations } from "@methods/activations/Activations.ts";
import { ActivationError } from "@errors/ActivationError.ts";

Deno.test("setAllowedSquashes: pickRandomSquash only returns allowed names", () => {
  try {
    const allowed = ["TANH", "LOGISTIC", "IDENTITY"];
    Activations.setAllowedSquashes(allowed);
    const set = new Set(allowed);
    for (let i = 0; i < 500; i++) {
      assert(
        set.has(Activations.pickRandomSquash()),
        "pickRandomSquash returned a disallowed squash",
      );
    }
  } finally {
    Activations.resetAllowedSquashesForTesting();
  }
});

Deno.test("setAllowedSquashes: aliases are canonicalised (RELU -> ReLU)", () => {
  try {
    Activations.setAllowedSquashes(["RELU"]);
    const allowed = Activations.getAllowedSquashes();
    assert(allowed !== null);
    assert(allowed.has("ReLU"), "alias RELU should canonicalise to ReLU");
    assertEquals(Activations.pickRandomSquash(), "ReLU");
    assert(Activations.isSquashAllowed("RELU"));
    assert(Activations.isSquashAllowed("ReLU"));
    assert(!Activations.isSquashAllowed("TANH"));
  } finally {
    Activations.resetAllowedSquashesForTesting();
  }
});

Deno.test("setAllowedSquashes: unknown name throws ActivationError (fail loud)", () => {
  try {
    assertThrows(
      () => Activations.setAllowedSquashes(["NOT_A_REAL_SQUASH"]),
      ActivationError,
    );
    // The failed call must not partially apply a restriction.
    assertEquals(Activations.getAllowedSquashes(), null);
  } finally {
    Activations.resetAllowedSquashesForTesting();
  }
});

Deno.test("setAllowedSquashes: null or empty clears the restriction", () => {
  try {
    Activations.setAllowedSquashes(["TANH"]);
    assert(Activations.getAllowedSquashes() !== null);

    Activations.setAllowedSquashes([]);
    assertEquals(Activations.getAllowedSquashes(), null);

    Activations.setAllowedSquashes(["TANH"]);
    Activations.setAllowedSquashes(null);
    assertEquals(Activations.getAllowedSquashes(), null);
  } finally {
    Activations.resetAllowedSquashesForTesting();
  }
});

Deno.test("setAllowedSquashes: no restriction means every name is allowed", () => {
  // Default state — reset for isolation, then verify unrestricted behaviour.
  Activations.resetAllowedSquashesForTesting();
  assertEquals(Activations.getAllowedSquashes(), null);
  assert(Activations.isSquashAllowed("TANH"));
  assert(Activations.isSquashAllowed("ReLU"));
  const name = Activations.pickRandomSquash();
  assertEquals(Activations.find(name).getName(), name);
});

Deno.test("setAllowedSquashes: single allowed squash with exclude still returns it", () => {
  try {
    // Excluding the only allowed squash must not empty the pool; the guard
    // falls back to the unfiltered restricted pool.
    Activations.setAllowedSquashes(["TANH"]);
    for (let i = 0; i < 50; i++) {
      assertEquals(Activations.pickRandomSquash("TANH"), "TANH");
    }
  } finally {
    Activations.resetAllowedSquashesForTesting();
  }
});

Deno.test("setAllowedSquashes: zero-weight activation (SOFTMAX) is still selectable when allow-listed", () => {
  try {
    // SOFTMAX has mutationProbability 0, so it is absent from the weighted
    // pool. The restricted pool must fall back to the allowed names so the
    // draw is never empty.
    Activations.setAllowedSquashes(["SOFTMAX"]);
    for (let i = 0; i < 50; i++) {
      assertEquals(Activations.pickRandomSquash(), "SOFTMAX");
    }
  } finally {
    Activations.resetAllowedSquashesForTesting();
  }
});

Deno.test("setAllowedSquashes: pickRandomSquash(exclude) still honours the budget", () => {
  try {
    const allowed = ["TANH", "LOGISTIC", "IDENTITY"];
    Activations.setAllowedSquashes(allowed);
    const set = new Set(allowed);
    for (let i = 0; i < 300; i++) {
      const name = Activations.pickRandomSquash("TANH");
      assert(set.has(name), "excluded draw returned a disallowed squash");
      assert(name !== "TANH", "exclude was not honoured");
    }
  } finally {
    Activations.resetAllowedSquashesForTesting();
  }
});
