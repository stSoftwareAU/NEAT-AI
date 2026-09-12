/**
 * The acquisition rules (Issue #3933).
 *
 * The property that matters is not a number from a table: it is that both
 * rules prefer a candidate the model is **unsure** about over an equally
 * predicted one it is confident about. A rule that does not is an argmax with
 * extra arithmetic.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  acquisitionValue,
  confidenceBound,
  expectedImprovement,
  normalCdf,
  normalPdf,
} from "@surrogate/Acquisition.ts";
import type { UncertainPrediction } from "@surrogate/UncertainSurrogate.ts";
import { SurrogateUncertaintyError } from "@errors/SurrogateUncertaintyError.ts";

/** A prediction, spelt out. */
function prediction(value: number, uncertainty: number): UncertainPrediction {
  return { kind: "prediction", value, uncertainty };
}

Deno.test("acquisition — the normal helpers agree with known values", () => {
  assertAlmostEquals(normalCdf(0), 0.5, 1e-9);
  assertAlmostEquals(normalCdf(1.96), 0.975, 1e-4);
  assertAlmostEquals(normalCdf(-1.96), 0.025, 1e-4);
  assertAlmostEquals(normalPdf(0), 0.3989422804, 1e-9);
});

Deno.test("expected improvement — uncertainty is worth exact evaluations", () => {
  const best = 0.4;
  const confident = expectedImprovement(prediction(0.35, 0.001), best);
  const unsure = expectedImprovement(prediction(0.35, 0.05), best);
  // Both are predicted *below* the incumbent; only the uncertain one is worth
  // paying for, which is the whole difference from an argmax.
  assert(
    unsure > confident,
    `the uncertain candidate should win: ${unsure} vs ${confident}`,
  );
});

Deno.test("expected improvement — certainty collapses to the improvement itself", () => {
  assertEquals(expectedImprovement(prediction(0.5, 0), 0.4), 0.5 - 0.4);
  assertEquals(expectedImprovement(prediction(0.3, 0), 0.4), 0);
});

Deno.test("expected improvement — never negative", () => {
  for (const value of [-5, -0.1, 0, 0.39, 10]) {
    assert(expectedImprovement(prediction(value, 0.2), 0.4) >= 0);
  }
});

Deno.test("expected improvement — refuses a run with no incumbent", () => {
  const error = assertThrows(
    () => expectedImprovement(prediction(0.5, 0.1), -Infinity),
    SurrogateUncertaintyError,
  );
  assertEquals(error.reason, "INVALID_ALLOCATION_REQUEST");
});

Deno.test("confidence bound — kappa buys exploration, zero kappa is the argmax", () => {
  assertEquals(confidenceBound(prediction(0.3, 0.2), 1.5), 0.3 + 1.5 * 0.2);
  assertEquals(confidenceBound(prediction(0.3, 0.2), 0), 0.3);
  const unsure = confidenceBound(prediction(0.3, 0.2), 1.5);
  const confident = confidenceBound(prediction(0.32, 0.001), 1.5);
  assert(
    unsure > confident,
    "a slightly worse but far less certain candidate should outrank",
  );
});

Deno.test("acquisition — the configured rule is the one applied", () => {
  const p = prediction(0.3, 0.2);
  assertEquals(acquisitionValue("lcb", p, 0.4, 1.5), confidenceBound(p, 1.5));
  assertEquals(
    acquisitionValue("ei", p, 0.4, 1.5),
    expectedImprovement(p, 0.4),
  );
});
