/**
 * The interface that cannot hand back a bare number (Issue #3933).
 *
 * The load-bearing case is the one the issue makes structural: there is no
 * path through a verdict that carries a value without an uncertainty beside
 * it, and a model that tries is refused at the boundary rather than ranked on.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  assertVerdict,
  isPrediction,
  type SurrogateVerdict,
  type UncertainSurrogate,
} from "@surrogate/UncertainSurrogate.ts";
import { SurrogateUncertaintyError } from "@errors/SurrogateUncertaintyError.ts";

Deno.test("uncertain surrogate — a prediction carries a value and an uncertainty", () => {
  const model: UncertainSurrogate = {
    name: "constant",
    predict: (features) => ({
      kind: "prediction",
      value: features[0],
      uncertainty: 0.25,
    }),
  };
  const verdict = model.predict([1.5]);
  assert(isPrediction(verdict));
  assertEquals(verdict.value, 1.5);
  assertEquals(verdict.uncertainty, 0.25);
});

Deno.test("uncertain surrogate — a refusal is not a prediction", () => {
  const refusal: SurrogateVerdict = {
    kind: "out-of-distribution",
    reason: "nothing archived within reach",
    distance: 4,
    limit: 1,
  };
  assertEquals(isPrediction(refusal), false);
  // A refusal passes the boundary check untouched: there is no number in it
  // to be wrong.
  assertEquals(assertVerdict("knn", refusal), refusal);
});

Deno.test("uncertain surrogate — a non-finite prediction is refused", () => {
  const error = assertThrows(
    () =>
      assertVerdict("knn", {
        kind: "prediction",
        value: Number.NaN,
        uncertainty: 1,
      }),
    SurrogateUncertaintyError,
  );
  assertEquals(error.reason, "INVALID_PREDICTION");
});

Deno.test("uncertain surrogate — a negative or non-finite uncertainty is refused", () => {
  for (const uncertainty of [-1e-9, Number.NaN, Infinity]) {
    const error = assertThrows(
      () =>
        assertVerdict("knn", {
          kind: "prediction",
          value: 0.5,
          uncertainty,
        }),
      SurrogateUncertaintyError,
      undefined,
      `uncertainty ${uncertainty} should have been refused`,
    );
    assertEquals(error.reason, "INVALID_PREDICTION");
  }
});

Deno.test("uncertain surrogate — zero uncertainty is a real answer, not a missing one", () => {
  const verdict = assertVerdict("knn", {
    kind: "prediction",
    value: -0.25,
    uncertainty: 0,
  });
  assert(isPrediction(verdict));
  assertEquals(verdict.uncertainty, 0);
});
