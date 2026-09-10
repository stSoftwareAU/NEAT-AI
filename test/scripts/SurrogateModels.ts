/**
 * Issue #3930: the surrogate model families the Stage 1 study fits.
 *
 * Every test calls a real fitter with real training data and asserts on what
 * the fitted model returned — a prediction, an uncertainty, or a refusal.
 * A model that cannot recover a function it was handed in full is not a
 * measurement instrument, so the happy paths check learnt behaviour rather
 * than merely that a number came back.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  applyFeatureScaler,
  factoriseLu,
  fitFeatureScaler,
  fitGaussianProcess,
  fitGradientBoostedTrees,
  fitQuadraticPolynomial,
  fitRadialBasis,
  medianPairwiseDistance,
  solveFactorised,
  solveLinearSystem,
  SURROGATE_FAMILIES,
  type TrainingPoint,
} from "../../scripts/lib/surrogateModels.ts";
import { testRng } from "./_surrogateFixtures.ts";

/**
 * A smooth two-variable target with a real interaction, plus two decoy
 * features that carry no signal. A family that fits it is fitting the
 * function, not memorising the rows.
 */
function sampleTarget(x: number, y: number): number {
  return 0.6 * x - 0.4 * y + 0.5 * x * x;
}

function buildPoints(count: number, seed: number): TrainingPoint[] {
  const next = testRng(seed);
  const points: TrainingPoint[] = [];
  for (let i = 0; i < count; i++) {
    const x = next() * 2 - 1;
    const y = next() * 2 - 1;
    points.push({
      features: [x, y, next(), 3],
      score: sampleTarget(x, y),
    });
  }
  return points;
}

Deno.test("surrogate models - a constant feature column is dropped, not divided by zero", () => {
  const scaler = fitFeatureScaler([
    [1, 5, 2],
    [3, 5, 4],
    [5, 5, 9],
  ]);
  assertEquals(scaler.keep, [0, 2]);
  const scaled = applyFeatureScaler(scaler, [3, 5, 5]);
  assertEquals(scaled.length, 2);
  assertAlmostEquals(scaled[0], 0, 1e-12);
  for (const value of scaled) assert(Number.isFinite(value));
});

Deno.test("surrogate models - an all-constant training set is refused", () => {
  assertThrows(
    () => fitFeatureScaler([[1, 2], [1, 2], [1, 2]]),
    Error,
    "every feature is constant",
  );
});

Deno.test("surrogate models - a singular system throws instead of returning a fit", () => {
  assertThrows(
    () => solveLinearSystem([[1, 2], [2, 4]], [1, 2]),
    Error,
    "singular",
  );
});

Deno.test("surrogate models - one factorisation answers many right-hand sides", () => {
  const matrix = [[4, 1, 0], [1, 3, 1], [0, 1, 2]];
  const factorisation = factoriseLu(matrix);
  for (const rhs of [[1, 2, 3], [0, 1, 0], [-2, 5, 7]]) {
    const solved = solveFactorised(factorisation, rhs);
    for (let row = 0; row < matrix.length; row++) {
      let sum = 0;
      for (let col = 0; col < matrix.length; col++) {
        sum += matrix[row][col] * solved[col];
      }
      assertAlmostEquals(sum, rhs[row], 1e-9);
    }
  }
  assertThrows(
    () => solveFactorised(factorisation, [1, 2]),
    Error,
    "factorisation is 3x3",
  );
});

Deno.test("surrogate models - a coincident training set has no kernel width", () => {
  assertThrows(
    () => medianPairwiseDistance([[1, 1], [1, 1], [1, 1]]),
    Error,
    "coincident",
  );
});

Deno.test("surrogate models - the quadratic polynomial recovers a quadratic target", () => {
  const model = fitQuadraticPolynomial(buildPoints(120, 11));
  assertEquals(model.family, "quadratic-polynomial");
  for (const [x, y] of [[0.4, -0.3], [-0.7, 0.2], [0.1, 0.9]]) {
    const prediction = model.predict([x, y, 0.5, 3]);
    assertAlmostEquals(prediction.mean, sampleTarget(x, y), 0.05);
    assertEquals(prediction.sd, null);
  }
});

Deno.test("surrogate models - the RBF interpolant reproduces its training points", () => {
  const points = buildPoints(60, 23);
  const model = fitRadialBasis(points);
  assertEquals(model.family, "rbf-interpolation");
  for (const point of points.slice(0, 5)) {
    assertAlmostEquals(model.predict(point.features).mean, point.score, 0.02);
  }
});

Deno.test("surrogate models - the Gaussian process reports an uncertainty that grows away from the data", () => {
  const model = fitGaussianProcess(buildPoints(80, 31));
  assertEquals(model.family, "gaussian-process");
  const near = model.predict([0.2, -0.1, 0.5, 3]);
  const far = model.predict([40, -40, 0.5, 3]);
  assert(near.sd !== null && far.sd !== null, "a GP must supply an sd");
  assertAlmostEquals(near.mean, sampleTarget(0.2, -0.1), 0.1);
  assert(
    far.sd > near.sd,
    `uncertainty must grow away from the data: ${far.sd} vs ${near.sd}`,
  );
  assert(near.sd > 0, "an interpolating GP still carries its noise term");
});

Deno.test("surrogate models - boosted trees order held-out creatures and are deterministic", () => {
  const train = buildPoints(140, 47);
  const first = fitGradientBoostedTrees(train);
  const second = fitGradientBoostedTrees(train);
  assertEquals(first.family, "gradient-boosted-trees");
  const test = buildPoints(30, 4711);
  const predictions = test.map((point) => first.predict(point.features).mean);
  for (let i = 0; i < test.length; i++) {
    assertEquals(second.predict(test[i].features).mean, predictions[i]);
  }
  // Ranking, not accuracy: count the held-out pairs it ordered correctly.
  let correct = 0;
  let pairs = 0;
  for (let i = 0; i < test.length; i++) {
    for (let j = i + 1; j < test.length; j++) {
      pairs++;
      const trueOrder = Math.sign(test[i].score - test[j].score);
      const predictedOrder = Math.sign(predictions[i] - predictions[j]);
      if (trueOrder === predictedOrder) correct++;
    }
  }
  assert(
    correct / pairs > 0.8,
    `boosted trees ordered only ${correct}/${pairs} held-out pairs`,
  );
});

Deno.test("surrogate models - every family refuses a training set it cannot honestly fit", () => {
  const tiny: TrainingPoint[] = [{ features: [1, 2], score: 1 }];
  const ragged: TrainingPoint[] = [
    { features: [1, 2], score: 1 },
    { features: [1], score: 2 },
    { features: [3, 4], score: 3 },
  ];
  const infinite: TrainingPoint[] = [
    { features: [1, 2], score: 1 },
    { features: [Number.NaN, 4], score: 2 },
    { features: [5, 6], score: 3 },
  ];
  const flat: TrainingPoint[] = [
    { features: [1, 2], score: 7 },
    { features: [3, 4], score: 7 },
    { features: [5, 6], score: 7 },
  ];
  for (const family of SURROGATE_FAMILIES) {
    assertThrows(() => family.fit(tiny), Error, "training points");
    assertThrows(() => family.fit(ragged), Error, "features");
    assertThrows(() => family.fit(infinite), Error, "finite");
    assertThrows(() => family.fit(flat), Error, "identical");
  }
});

Deno.test("surrogate models - the registry holds the four families the issue requires", () => {
  assertEquals(SURROGATE_FAMILIES.map((family) => family.name), [
    "quadratic-polynomial",
    "rbf-interpolation",
    "gaussian-process",
    "gradient-boosted-trees",
  ]);
  const points = buildPoints(50, 97);
  for (const family of SURROGATE_FAMILIES) {
    const model = family.fit(points);
    assertEquals(model.family, family.name);
    assert(Number.isFinite(model.predict(points[0].features).mean));
  }
});
