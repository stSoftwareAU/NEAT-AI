/**
 * Issue #3930 — the candidate fitness-approximation model families.
 *
 * Jin (2011) §2 surveys the surrogates an evolutionary algorithm can be given
 * and orders them by what they cost to fit: a polynomial response surface, a
 * radial-basis interpolant, a Gaussian process (kriging), and an ensemble of
 * regression trees. This module implements one fitter per family, with no I/O
 * and no dependency on the archive, so the study that consumes them can be
 * tested against data it constructs rather than data it has to evolve.
 *
 * **Score convention.** Every fitter here takes *scores*, where **higher is
 * better** — the convention `Creature.score` uses (`src/architecture/
 * Fitness.ts` sets `-Infinity` for a creature that could not be scored). The
 * study negates before it hands a vector to the rank arithmetic in
 * `rankFidelity.ts`, which is written for errors.
 *
 * **Nothing here is production code.** A fitted model is a measurement
 * instrument for the Stage 1 feasibility question; the `SurrogateModel`
 * interface the issue reserves for `src/NEAT/` is Stage 2 and only exists if
 * the kill gate passes.
 *
 * Silent-failure guard: a singular system, a degenerate kernel width, an empty
 * training set or a non-finite feature throws rather than returning a
 * plausible number. A surrogate quietly fitted to `NaN` would report a
 * spectacular correlation over garbage, which is the exact false positive this
 * study exists to avoid.
 *
 * @module surrogateModels
 */

/** One archived evaluation, reduced to what a fitter needs. */
export interface TrainingPoint {
  /** The descriptor, already expanded by the study. */
  readonly features: readonly number[];
  /** The exact score. Higher is better. */
  readonly score: number;
}

/** What a fitted model says about one unseen creature. */
export interface SurrogatePrediction {
  /** Point prediction, in score units. */
  readonly mean: number;
  /**
   * One standard deviation of the model's own uncertainty, in score units, or
   * `null` for a family that has no such estimate.
   *
   * Only the Gaussian process supplies one. Reporting `0` for the families
   * that cannot would read as "certain", which is a different claim from "this
   * family does not answer that question".
   */
  readonly sd: number | null;
}

/** A model fitted to a training set, ready to be asked about new creatures. */
export interface SurrogateModel {
  /** The family that produced it. */
  readonly family: string;
  /** Predict the score of a creature with these features. */
  readonly predict: (features: readonly number[]) => SurrogatePrediction;
}

/** A named way of fitting {@link SurrogateModel} to a training set. */
export interface SurrogateFamily {
  readonly name: string;
  /** Fit the family to `points`. Throws rather than fitting to bad data. */
  readonly fit: (points: readonly TrainingPoint[]) => SurrogateModel;
}

/** Smallest training set any family here can be fitted to. */
const MIN_TRAINING_POINTS = 3;

/** Refuses a training set no model can honestly be fitted to. */
function assertTrainable(points: readonly TrainingPoint[]): void {
  if (points.length < MIN_TRAINING_POINTS) {
    throw new Error(
      `at least ${MIN_TRAINING_POINTS} training points are needed to fit a ` +
        `surrogate, got ${points.length}`,
    );
  }
  const width = points[0].features.length;
  if (width === 0) {
    throw new Error("training points carry no features");
  }
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point.features.length !== width) {
      throw new Error(
        `training point ${i} has ${point.features.length} features, ` +
          `expected ${width}`,
      );
    }
    if (!Number.isFinite(point.score)) {
      throw new Error(`training point ${i} has a non-finite score`);
    }
    for (let j = 0; j < width; j++) {
      if (!Number.isFinite(point.features[j])) {
        throw new Error(`training point ${i} feature ${j} is not finite`);
      }
    }
  }
}

/**
 * Column-wise standardisation, dropping the columns that carry no information.
 *
 * A descriptor slot that is constant across the training set — every creature
 * in a fold has the same input count — has no variance to divide by. Keeping
 * it would put a zero column into the design matrix; dividing by its zero
 * standard deviation would put an infinity there. It is dropped, and which
 * columns survived is part of the fitted model.
 */
export interface FeatureScaler {
  /** Indices of the columns that survived, in ascending order. */
  readonly keep: readonly number[];
  /** Mean of each kept column. */
  readonly mean: readonly number[];
  /** Standard deviation of each kept column, always positive. */
  readonly sd: readonly number[];
}

/** Fit a {@link FeatureScaler} to the rows of a training set. */
export function fitFeatureScaler(
  rows: readonly (readonly number[])[],
): FeatureScaler {
  if (rows.length === 0) throw new Error("cannot scale an empty training set");
  const width = rows[0].length;
  const keep: number[] = [];
  const mean: number[] = [];
  const sd: number[] = [];
  for (let column = 0; column < width; column++) {
    let sum = 0;
    for (const row of rows) sum += row[column];
    const columnMean = sum / rows.length;
    let variance = 0;
    for (const row of rows) {
      const delta = row[column] - columnMean;
      variance += delta * delta;
    }
    const columnSd = Math.sqrt(variance / rows.length);
    if (columnSd > 0) {
      keep.push(column);
      mean.push(columnMean);
      sd.push(columnSd);
    }
  }
  if (keep.length === 0) {
    throw new Error(
      "every feature is constant across the training set — there is nothing " +
        "to fit a surrogate to",
    );
  }
  return { keep, mean, sd };
}

/** Standardise one row with a fitted scaler. */
export function applyFeatureScaler(
  scaler: FeatureScaler,
  row: readonly number[],
): number[] {
  const out = new Array<number>(scaler.keep.length);
  for (let i = 0; i < scaler.keep.length; i++) {
    out[i] = (row[scaler.keep[i]] - scaler.mean[i]) / scaler.sd[i];
  }
  return out;
}

/** Centre and scale of the training scores, so the solve is conditioned. */
interface ScoreScaler {
  readonly mean: number;
  readonly sd: number;
}

/**
 * Fit a score scaler.
 *
 * A constant score column is refused: a training set whose creatures all
 * scored identically carries no ordering, so no model fitted to it can have
 * learnt one, and reporting a correlation over it would be meaningless.
 */
function fitScoreScaler(scores: readonly number[]): ScoreScaler {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  let variance = 0;
  for (const score of scores) {
    const delta = score - mean;
    variance += delta * delta;
  }
  const sd = Math.sqrt(variance / scores.length);
  if (sd === 0) {
    throw new Error(
      "every training score is identical — the training set carries no " +
        "ordering to learn",
    );
  }
  return { mean, sd };
}

/**
 * An LU factorisation with partial pivoting, kept so a Gram matrix is
 * decomposed **once per fitted model** rather than once per prediction.
 *
 * A kriging posterior needs a solve for every creature it is asked about;
 * re-factorising an n×n matrix each time turns an O(n³) fit into an O(n⁴)
 * study and was measured doing exactly that on a 1,100-record archive.
 */
export interface LuFactorisation {
  readonly lu: readonly (readonly number[])[];
  readonly pivots: readonly number[];
  readonly size: number;
}

/**
 * Factorise `A` by Gaussian elimination with partial pivoting.
 *
 * A singular system throws: a least-squares fit that silently returned the
 * last non-degenerate solution would be a model nobody could tell was wrong.
 */
export function factoriseLu(
  matrix: readonly (readonly number[])[],
): LuFactorisation {
  const n = matrix.length;
  if (n === 0) throw new Error("cannot factorise an empty matrix");
  const a = matrix.map((row, i) => {
    if (row.length !== n) {
      throw new Error(
        `matrix row ${i} has ${row.length} columns, expected ${n}`,
      );
    }
    return [...row];
  });
  const pivots = a.map((_, i) => i);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (!(Math.abs(a[pivot][col]) > 1e-12)) {
      throw new Error(
        `the ${n}x${n} system is singular at column ${col} — refusing to ` +
          "return a fitted model that is not determined by the data",
      );
    }
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [pivots[col], pivots[pivot]] = [pivots[pivot], pivots[col]];
    }
    const diagonal = a[col][col];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / diagonal;
      a[row][col] = factor;
      if (factor === 0) continue;
      for (let k = col + 1; k < n; k++) a[row][k] -= factor * a[col][k];
    }
  }
  return { lu: a, pivots, size: n };
}

/** Solve `A x = b` from a factorisation of `A`. */
export function solveFactorised(
  factorisation: LuFactorisation,
  rhs: readonly number[],
): number[] {
  const { lu, pivots, size } = factorisation;
  if (rhs.length !== size) {
    throw new Error(
      `right-hand side has ${rhs.length} entries, the factorisation is ` +
        `${size}x${size}`,
    );
  }
  const x = pivots.map((source) => rhs[source]);
  for (let row = 1; row < size; row++) {
    let sum = x[row];
    for (let k = 0; k < row; k++) sum -= lu[row][k] * x[k];
    x[row] = sum;
  }
  for (let row = size - 1; row >= 0; row--) {
    let sum = x[row];
    for (let k = row + 1; k < size; k++) sum -= lu[row][k] * x[k];
    x[row] = sum / lu[row][row];
  }
  for (const value of x) {
    if (!Number.isFinite(value)) {
      throw new Error("the solve produced a non-finite coefficient");
    }
  }
  return x;
}

/** Solve `A x = b` once, for a system that is only ever solved once. */
export function solveLinearSystem(
  matrix: readonly (readonly number[])[],
  rhs: readonly number[],
): number[] {
  if (matrix.length !== rhs.length) {
    throw new Error(
      `matrix is ${matrix.length}x?, right-hand side is ${rhs.length}`,
    );
  }
  return solveFactorised(factoriseLu(matrix), rhs);
}

/**
 * Quadratic polynomial regression — Jin (2011) §2's cheapest surrogate.
 *
 * The design is `[1, z, z²]` over the standardised kept columns: linear and
 * squared terms, **no cross products**. The study's feature vector has 58
 * entries, so a full quadratic would carry 1,770 terms — more parameters than
 * a held-out fold of this archive has rows, and a fit with more parameters
 * than data is not a measurement of anything. The omission is a stated
 * limitation of the family as tested, not a silent simplification.
 *
 * Ridge regularisation is applied to every term but the intercept.
 */
export function fitQuadraticPolynomial(
  points: readonly TrainingPoint[],
  ridge = 1e-4,
): SurrogateModel {
  assertTrainable(points);
  if (!(ridge >= 0) || !Number.isFinite(ridge)) {
    throw new Error(`ridge must be a finite non-negative number, got ${ridge}`);
  }
  const scaler = fitFeatureScaler(points.map((p) => p.features));
  const scores = fitScoreScaler(points.map((p) => p.score));
  const design = points.map((point) => {
    const z = applyFeatureScaler(scaler, point.features);
    return [1, ...z, ...z.map((value) => value * value)];
  });
  const terms = design[0].length;
  const gram: number[][] = Array.from(
    { length: terms },
    () => new Array<number>(terms).fill(0),
  );
  const rhs = new Array<number>(terms).fill(0);
  for (let r = 0; r < design.length; r++) {
    const row = design[r];
    const y = (points[r].score - scores.mean) / scores.sd;
    for (let i = 0; i < terms; i++) {
      rhs[i] += row[i] * y;
      for (let j = i; j < terms; j++) gram[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < terms; i++) {
    for (let j = 0; j < i; j++) gram[i][j] = gram[j][i];
    if (i > 0) gram[i][i] += ridge * design.length;
  }
  const coefficients = solveLinearSystem(gram, rhs);
  return {
    family: "quadratic-polynomial",
    predict(features: readonly number[]): SurrogatePrediction {
      const z = applyFeatureScaler(scaler, features);
      const row = [1, ...z, ...z.map((value) => value * value)];
      let sum = 0;
      for (let i = 0; i < terms; i++) sum += row[i] * coefficients[i];
      return { mean: sum * scores.sd + scores.mean, sd: null };
    },
  };
}

/** Squared Euclidean distance between two standardised rows. */
function squaredDistance(a: readonly number[], b: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    const delta = a[i] - b[i];
    total += delta * delta;
  }
  return total;
}

/**
 * The kernel width both kernel families use: the median non-zero pairwise
 * distance across the training set.
 *
 * A width taken from the data rather than tuned keeps the two kernel families
 * comparable, and a training set whose points are all coincident throws — a
 * kernel of width zero is not a wide kernel, it is an undefined one.
 */
export function medianPairwiseDistance(
  rows: readonly (readonly number[])[],
): number {
  const distances: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const distance = Math.sqrt(squaredDistance(rows[i], rows[j]));
      if (distance > 0) distances.push(distance);
    }
  }
  if (distances.length === 0) {
    throw new Error(
      "every training point is coincident in feature space — a kernel width " +
        "cannot be taken from this training set",
    );
  }
  distances.sort((a, b) => a - b);
  const mid = distances.length >> 1;
  return distances.length % 2 === 1
    ? distances[mid]
    : (distances[mid - 1] + distances[mid]) / 2;
}

/** The Gram matrix of the squared-exponential kernel, plus a diagonal term. */
function kernelMatrix(
  rows: readonly (readonly number[])[],
  width: number,
  diagonal: number,
): number[][] {
  const n = rows.length;
  const denominator = 2 * width * width;
  const gram: number[][] = Array.from(
    { length: n },
    () => new Array<number>(n).fill(0),
  );
  for (let i = 0; i < n; i++) {
    gram[i][i] = 1 + diagonal;
    for (let j = i + 1; j < n; j++) {
      const value = Math.exp(-squaredDistance(rows[i], rows[j]) / denominator);
      gram[i][j] = value;
      gram[j][i] = value;
    }
  }
  return gram;
}

/**
 * Radial-basis interpolation with a Gaussian kernel — Jin (2011) §2's
 * interpolating surrogate.
 *
 * Regularised rather than strictly interpolating: an archive contains
 * near-duplicate creatures (two offspring of the same parent differing in one
 * synapse), and a strict interpolant over a near-singular Gram matrix is
 * numerically meaningless.
 */
export function fitRadialBasis(
  points: readonly TrainingPoint[],
  ridge = 1e-6,
): SurrogateModel {
  assertTrainable(points);
  const scaler = fitFeatureScaler(points.map((p) => p.features));
  const scores = fitScoreScaler(points.map((p) => p.score));
  const rows = points.map((p) => applyFeatureScaler(scaler, p.features));
  const width = medianPairwiseDistance(rows);
  const gram = kernelMatrix(rows, width, ridge);
  const targets = points.map((p) => (p.score - scores.mean) / scores.sd);
  const weights = solveLinearSystem(gram, targets);
  const denominator = 2 * width * width;
  return {
    family: "rbf-interpolation",
    predict(features: readonly number[]): SurrogatePrediction {
      const z = applyFeatureScaler(scaler, features);
      let sum = 0;
      for (let i = 0; i < rows.length; i++) {
        sum += weights[i] *
          Math.exp(-squaredDistance(z, rows[i]) / denominator);
      }
      return { mean: sum * scores.sd + scores.mean, sd: null };
    },
  };
}

/**
 * Gaussian process regression (kriging) — Jones, Schonlau & Welch (1998).
 *
 * The only family here that answers "how sure are you?", which is why the
 * issue makes an uncertainty estimate non-negotiable for the Stage 2
 * interface: expected improvement is a function of the posterior variance, not
 * of the mean.
 *
 * Zero-mean prior over standardised scores, squared-exponential kernel of the
 * same data-derived width as the RBF family, and an explicit noise term — the
 * archived score is exact, but two creatures at the same descriptor genuinely
 * differ in score (the collision incidence #3929 reports), so a noise-free
 * prior would be a lie about the data.
 */
export function fitGaussianProcess(
  points: readonly TrainingPoint[],
  noise = 1e-2,
): SurrogateModel {
  assertTrainable(points);
  if (!(noise > 0) || !Number.isFinite(noise)) {
    throw new Error(`GP noise must be a positive number, got ${noise}`);
  }
  const scaler = fitFeatureScaler(points.map((p) => p.features));
  const scores = fitScoreScaler(points.map((p) => p.score));
  const rows = points.map((p) => applyFeatureScaler(scaler, p.features));
  const width = medianPairwiseDistance(rows);
  const gram = kernelMatrix(rows, width, noise);
  const targets = points.map((p) => (p.score - scores.mean) / scores.sd);
  // One factorisation for the whole fitted model: the posterior mean needs a
  // solve once, the posterior variance needs one per creature asked about.
  const factorisation = factoriseLu(gram);
  const alpha = solveFactorised(factorisation, targets);
  const denominator = 2 * width * width;
  return {
    family: "gaussian-process",
    predict(features: readonly number[]): SurrogatePrediction {
      const z = applyFeatureScaler(scaler, features);
      const k = rows.map((row) =>
        Math.exp(-squaredDistance(z, row) / denominator)
      );
      let mean = 0;
      for (let i = 0; i < k.length; i++) mean += k[i] * alpha[i];
      const solved = solveFactorised(factorisation, k);
      let quadratic = 0;
      for (let i = 0; i < k.length; i++) quadratic += k[i] * solved[i];
      // Rounding can push the posterior variance a hair below zero; clamping
      // at zero is the honest floor, and the prior variance is 1 by
      // construction because the scores were standardised.
      const variance = Math.max(0, 1 + noise - quadratic);
      return {
        mean: mean * scores.sd + scores.mean,
        sd: Math.sqrt(variance) * scores.sd,
      };
    },
  };
}

/** One split of a regression tree, or a leaf when `feature` is `-1`. */
interface TreeNode {
  readonly feature: number;
  readonly threshold: number;
  readonly value: number;
  readonly left?: TreeNode;
  readonly right?: TreeNode;
}

/** Candidate thresholds per feature, so a wide fold stays affordable. */
const MAX_SPLIT_CANDIDATES = 32;

/** Mean of a subset of `values`, over the given indices. */
function meanOf(values: readonly number[], indices: readonly number[]): number {
  let sum = 0;
  for (const index of indices) sum += values[index];
  return sum / indices.length;
}

/** Grow one squared-error regression tree over `indices`. */
function growTree(
  rows: readonly (readonly number[])[],
  residuals: readonly number[],
  indices: readonly number[],
  depth: number,
  minSamples: number,
): TreeNode {
  const value = meanOf(residuals, indices);
  if (depth === 0 || indices.length < 2 * minSamples) {
    return { feature: -1, threshold: 0, value };
  }
  let bestFeature = -1;
  let bestThreshold = 0;
  let bestGain = 0;
  const width = rows[0].length;
  for (let feature = 0; feature < width; feature++) {
    const values = [...new Set(indices.map((i) => rows[i][feature]))]
      .sort((a, b) => a - b);
    if (values.length < 2) continue;
    const step = Math.max(1, Math.floor(values.length / MAX_SPLIT_CANDIDATES));
    for (let v = step; v < values.length; v += step) {
      const threshold = (values[v - 1] + values[v]) / 2;
      let leftCount = 0;
      let leftSum = 0;
      let rightCount = 0;
      let rightSum = 0;
      for (const index of indices) {
        if (rows[index][feature] <= threshold) {
          leftCount++;
          leftSum += residuals[index];
        } else {
          rightCount++;
          rightSum += residuals[index];
        }
      }
      if (leftCount < minSamples || rightCount < minSamples) continue;
      // Squared-error reduction of the split, up to the constant total sum of
      // squares: maximising it minimises the within-child variance.
      const gain = (leftSum * leftSum) / leftCount +
        (rightSum * rightSum) / rightCount;
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = feature;
        bestThreshold = threshold;
      }
    }
  }
  if (bestFeature === -1) {
    return { feature: -1, threshold: 0, value };
  }
  const left: number[] = [];
  const right: number[] = [];
  for (const index of indices) {
    if (rows[index][bestFeature] <= bestThreshold) left.push(index);
    else right.push(index);
  }
  return {
    feature: bestFeature,
    threshold: bestThreshold,
    value,
    left: growTree(rows, residuals, left, depth - 1, minSamples),
    right: growTree(rows, residuals, right, depth - 1, minSamples),
  };
}

/** Walk a fitted tree to the leaf that owns `row`. */
function predictTree(node: TreeNode, row: readonly number[]): number {
  let current = node;
  while (current.feature >= 0) {
    const next = row[current.feature] <= current.threshold
      ? current.left
      : current.right;
    if (next === undefined) break;
    current = next;
  }
  return current.value;
}

/** How a boosted ensemble is grown. */
export interface BoostingOptions {
  readonly rounds?: number;
  readonly depth?: number;
  readonly learningRate?: number;
  readonly minSamples?: number;
}

/**
 * Gradient-boosted regression trees — the non-parametric family in Jin's
 * survey, and the only one here that can represent a discontinuous response.
 *
 * Deterministic by construction: full-batch boosting with no row or column
 * sub-sampling, so re-running the study reproduces the table exactly. That
 * matters more here than the small accuracy a stochastic variant might buy —
 * an irreproducible feasibility verdict is not a verdict.
 */
export function fitGradientBoostedTrees(
  points: readonly TrainingPoint[],
  options: BoostingOptions = {},
): SurrogateModel {
  assertTrainable(points);
  const rounds = options.rounds ?? 120;
  const depth = options.depth ?? 3;
  const learningRate = options.learningRate ?? 0.08;
  const minSamples = options.minSamples ?? 2;
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error(
      `boosting rounds must be a positive integer, got ${rounds}`,
    );
  }
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error(`tree depth must be a positive integer, got ${depth}`);
  }
  if (!(learningRate > 0) || learningRate > 1) {
    throw new Error(`learning rate must be in (0, 1], got ${learningRate}`);
  }
  const scores = fitScoreScaler(points.map((p) => p.score));
  const rows = points.map((p) => p.features);
  const targets = points.map((p) => (p.score - scores.mean) / scores.sd);
  const indices = points.map((_, i) => i);
  const working = [...targets];
  const trees: TreeNode[] = [];
  for (let round = 0; round < rounds; round++) {
    const tree = growTree(rows, working, indices, depth, minSamples);
    trees.push(tree);
    for (const index of indices) {
      working[index] -= learningRate * predictTree(tree, rows[index]);
    }
  }
  return {
    family: "gradient-boosted-trees",
    predict(features: readonly number[]): SurrogatePrediction {
      let sum = 0;
      for (const tree of trees) {
        sum += learningRate * predictTree(tree, features);
      }
      return { mean: sum * scores.sd + scores.mean, sd: null };
    },
  };
}

/**
 * The four families the issue requires, in Jin's rough order of fitting cost.
 *
 * Held as data rather than as a `switch` so the study reports every family it
 * was given and a family cannot be added without appearing in the table.
 */
export const SURROGATE_FAMILIES: readonly SurrogateFamily[] = Object.freeze([
  { name: "quadratic-polynomial", fit: (p) => fitQuadraticPolynomial(p) },
  { name: "rbf-interpolation", fit: (p) => fitRadialBasis(p) },
  { name: "gaussian-process", fit: (p) => fitGaussianProcess(p) },
  { name: "gradient-boosted-trees", fit: (p) => fitGradientBoostedTrees(p) },
]);
