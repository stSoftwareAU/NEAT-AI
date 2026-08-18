import { assertEquals } from "@std/assert";
import {
  isTrainingErrorMaterialImprovement,
  isTrainingErrorRegression,
} from "../../src/NEAT/TrainingErrorComparison.ts";

Deno.test("1e-9 evaluate noise is not a training regression", () => {
  // From the quality.sh --wasm-scorer jetsam: training 6cc64137.
  assertEquals(
    isTrainingErrorRegression(0.07123414377785792, 0.07123414143689583),
    false,
  );
});

Deno.test("a material error increase is a training regression", () => {
  assertEquals(isTrainingErrorRegression(0.08, 0.07), true);
});

Deno.test("an improved or equal training error is not a regression", () => {
  assertEquals(isTrainingErrorRegression(0.06, 0.07), false);
  assertEquals(isTrainingErrorRegression(0.07, 0.07), false);
});

Deno.test("a non-finite training error is a regression", () => {
  assertEquals(isTrainingErrorRegression(Number.NaN, 0.07), true);
  assertEquals(isTrainingErrorRegression(Number.POSITIVE_INFINITY, 0.07), true);
});

Deno.test("a non-finite fitness error is not treated as a training regression", () => {
  assertEquals(isTrainingErrorRegression(0.07, Number.NaN), false);
});

// Issue #3779: a training cycle that lands inside the noise floor is neither a
// regression nor an improvement — it is "no progress" and must not reset the
// consecutive-no-progress streaks.

Deno.test("a material error decrease is a material improvement", () => {
  assertEquals(isTrainingErrorMaterialImprovement(0.06, 0.07), true);
});

Deno.test("an identical error is not a material improvement", () => {
  assertEquals(isTrainingErrorMaterialImprovement(0.07, 0.07), false);
});

Deno.test("1e-9 evaluate noise is not a material improvement", () => {
  assertEquals(
    isTrainingErrorMaterialImprovement(
      0.07123414143689583,
      0.07123414377785792,
    ),
    false,
  );
});

Deno.test("a worse error is not a material improvement", () => {
  assertEquals(isTrainingErrorMaterialImprovement(0.08, 0.07), false);
});

Deno.test("a non-finite trained error is never a material improvement", () => {
  assertEquals(isTrainingErrorMaterialImprovement(Number.NaN, 0.07), false);
  assertEquals(
    isTrainingErrorMaterialImprovement(Number.POSITIVE_INFINITY, 0.07),
    false,
  );
});

Deno.test("any finite error beats a non-finite fitness error", () => {
  assertEquals(isTrainingErrorMaterialImprovement(0.07, Number.NaN), true);
  assertEquals(
    isTrainingErrorMaterialImprovement(0.07, Number.POSITIVE_INFINITY),
    true,
  );
});
