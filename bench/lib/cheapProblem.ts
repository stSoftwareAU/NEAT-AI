/**
 * Cheap, fully-enumerable test problems for the surrogate benchmark — Issue
 * #3935.
 *
 * Jin (2011) §6 evaluates surrogate techniques on analytic test functions
 * rather than on the expensive objective they are meant to replace, for one
 * reason: the cheap objective can be called for **every** point in the design
 * space, so approximation error is measured against ground truth rather than
 * against another approximation. That is impossible at GRQ scale — the
 * neighbourhood of a 5,317-neuron forward-only creature cannot be enumerated —
 * and it is trivial here.
 *
 * A problem is a discrete lattice plus a record set:
 *
 * - the **lattice** is `levels ** dimensions` points spanning `[lower, upper]`
 *   in every dimension, small enough to evaluate exhaustively;
 * - the **records** give the objective the shape a real fitness corpus has. The
 *   exact score is the mean of a classical test surface taken over every
 *   record, each record displacing the surface by its own shift, so no single
 *   record's optimum is the optimum of the mean. Scoring a **stride** of the
 *   records is the cheap fidelity of Issue #3926, on a problem where the full
 *   ordering is known.
 *
 * Scores are **maximised**, matching `Creature.score`: the score of a point is
 * the negated mean loss, so higher is better and the global optimum is the
 * lattice point with the largest score.
 *
 * ```mermaid
 * flowchart LR
 *   P[cheap problem] --> L[enumerate lattice]
 *   L --> E["exact score:<br/>mean over all records"]
 *   L --> A["approximate score:<br/>mean over a record stride"]
 *   E --> G[ground truth ordering]
 *   A --> G
 * ```
 *
 * **Nothing measured on these problems transfers to GRQ creature scores.** See
 * `docs/CHEAP_PROBLEM_BENCHMARK.md`; the harness prints the same warning on
 * every report.
 *
 * @module cheapProblem
 */

import { createSeededRng } from "@utils/RandomNumberGenerator.ts";
import { stridePhaseIndices } from "../../scripts/lib/rankFidelity.ts";

/**
 * Largest lattice this module will enumerate.
 *
 * A benchmark whose "exhaustive" pass silently takes minutes is not a cheap
 * problem any more, so an oversized lattice is refused rather than run.
 */
export const MAX_ENUMERATED_POINTS = 65_536;

/** The classical surfaces the problems are built from. Lower is worse fitness. */
export type TestSurface = "sphere" | "rastrigin" | "rosenbrock";

/** Every surface, for callers enumerating them. */
export const TEST_SURFACES: readonly TestSurface[] = Object.freeze([
  "sphere",
  "rastrigin",
  "rosenbrock",
]);

/**
 * One record of a cheap problem's objective.
 *
 * The shift displaces the surface for this record alone, which is what makes a
 * record stride a genuinely different estimator rather than a rescaling.
 */
export interface ProblemRecord {
  /** Per-dimension displacement applied before the surface is evaluated. */
  readonly shift: readonly number[];
}

/** A cheap problem: a lattice, a surface, and the records it is averaged over. */
export interface CheapProblem {
  /** Human-readable name, used in every report. */
  readonly name: string;
  /** Which classical surface the loss is taken from. */
  readonly surface: TestSurface;
  /** Design-space dimensions. */
  readonly dimensions: number;
  /** Lattice levels per dimension. */
  readonly levels: number;
  /** Inclusive lower bound of every dimension. */
  readonly lower: number;
  /** Inclusive upper bound of every dimension. */
  readonly upper: number;
  /** The records the loss is averaged over, in corpus order. */
  readonly records: readonly ProblemRecord[];
}

/** How a {@link CheapProblem} is built. */
export interface CheapProblemOptions {
  /** Which surface to use. */
  readonly surface: TestSurface;
  /** Design-space dimensions. Must be `>= 1`. */
  readonly dimensions?: number;
  /** Lattice levels per dimension. Must be `>= 2`. */
  readonly levels?: number;
  /** Records the loss is averaged over. Must be `>= 1`. */
  readonly records?: number;
  /** Largest per-dimension record shift, in design-space units. */
  readonly shiftScale?: number;
  /** Inclusive lower bound of every dimension. Default `-5.12`. */
  readonly lower?: number;
  /** Inclusive upper bound of every dimension. Default `5.12`. */
  readonly upper?: number;
  /** Seed for the record shifts, so a problem is reproducible. */
  readonly seed?: number;
}

/** The exhaustively evaluated lattice — the ground truth nothing at GRQ scale has. */
export interface GroundTruth {
  /** Every lattice point, in enumeration order. */
  readonly points: readonly (readonly number[])[];
  /** The exact score of each point, in the same order. Higher is better. */
  readonly scores: readonly number[];
  /** Index of the best point — the **known** global optimum of the lattice. */
  readonly optimumIndex: number;
  /** The score at that point. */
  readonly optimumScore: number;
  /** The worst score on the lattice, so a regret can be normalised. */
  readonly worstScore: number;
}

/** The loss of one surface at one displaced point. Lower is better. */
function surfaceLoss(surface: TestSurface, x: readonly number[]): number {
  switch (surface) {
    case "sphere": {
      let total = 0;
      for (let i = 0; i < x.length; i++) total += x[i] * x[i];
      return total;
    }
    case "rastrigin": {
      let total = 10 * x.length;
      for (let i = 0; i < x.length; i++) {
        total += x[i] * x[i] - 10 * Math.cos(2 * Math.PI * x[i]);
      }
      return total;
    }
    case "rosenbrock": {
      let total = 0;
      for (let i = 0; i + 1 < x.length; i++) {
        const a = x[i + 1] - x[i] * x[i];
        const b = 1 - x[i];
        total += 100 * a * a + b * b;
      }
      // One-dimensional Rosenbrock has no pair to sum over; fall back to the
      // single-variable form rather than reporting a flat zero surface.
      return x.length === 1 ? (1 - x[0]) * (1 - x[0]) : total;
    }
  }
}

/**
 * Build a reproducible cheap problem.
 *
 * @param options - Surface, lattice shape and record count.
 * @returns The problem.
 * @throws {Error} When the lattice is degenerate or larger than
 *   {@link MAX_ENUMERATED_POINTS}, or when the record count is not positive.
 */
export function createCheapProblem(
  options: CheapProblemOptions,
): CheapProblem {
  const dimensions = options.dimensions ?? 2;
  const levels = options.levels ?? 41;
  const records = options.records ?? 64;
  const shiftScale = options.shiftScale ?? 0.5;
  const seed = options.seed ?? 3935;
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new Error(`dimensions must be an integer >= 1, got ${dimensions}`);
  }
  if (!Number.isInteger(levels) || levels < 2) {
    throw new Error(`levels must be an integer >= 2, got ${levels}`);
  }
  if (!Number.isInteger(records) || records < 1) {
    throw new Error(`records must be an integer >= 1, got ${records}`);
  }
  if (!Number.isFinite(shiftScale) || shiftScale < 0) {
    throw new Error(
      `shiftScale must be a finite number >= 0, got ${shiftScale}`,
    );
  }
  const lower = options.lower ?? -5.12;
  const upper = options.upper ?? 5.12;
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || !(lower < upper)) {
    throw new Error(
      `the design space must span a finite range, got [${lower}, ${upper}]`,
    );
  }
  const total = Math.pow(levels, dimensions);
  if (total > MAX_ENUMERATED_POINTS) {
    throw new Error(
      `a ${levels}^${dimensions} lattice is ${total} points, past the ` +
        `${MAX_ENUMERATED_POINTS} this benchmark will enumerate: the whole ` +
        `point of a cheap problem is that the exhaustive pass is cheap`,
    );
  }
  const rng = createSeededRng(seed);
  const built: ProblemRecord[] = [];
  for (let r = 0; r < records; r++) {
    const shift: number[] = [];
    for (let d = 0; d < dimensions; d++) {
      shift.push((rng.random() * 2 - 1) * shiftScale);
    }
    built.push({ shift });
  }
  return {
    name: `${options.surface}-${dimensions}d-${levels}L-${records}R`,
    surface: options.surface,
    dimensions,
    levels,
    lower,
    upper,
    records: Object.freeze(built),
  };
}

/**
 * The score of one point over a chosen subset of the records.
 *
 * @param problem - The problem.
 * @param point - A design-space point, one coordinate per dimension.
 * @param recordIndices - Which records to average over; every record by
 *   default. Higher is better, so the mean loss is negated.
 * @returns The score.
 * @throws {Error} When the point has the wrong width or the subset is empty.
 */
export function scoreAt(
  problem: CheapProblem,
  point: readonly number[],
  recordIndices?: readonly number[],
): number {
  if (point.length !== problem.dimensions) {
    throw new Error(
      `point has ${point.length} coordinates, expected ${problem.dimensions}`,
    );
  }
  const indices = recordIndices;
  const count = indices === undefined ? problem.records.length : indices.length;
  if (count === 0) {
    throw new Error("a score cannot be taken over an empty record subset");
  }
  const displaced = new Array<number>(problem.dimensions);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const record = problem.records[indices === undefined ? i : indices[i]];
    if (record === undefined) {
      throw new Error(`record index ${indices?.[i]} is outside the corpus`);
    }
    for (let d = 0; d < problem.dimensions; d++) {
      displaced[d] = point[d] - record.shift[d];
    }
    total += surfaceLoss(problem.surface, displaced);
  }
  return -(total / count);
}

/**
 * Every lattice point, in a stable enumeration order.
 *
 * @param problem - The problem.
 * @returns The points; the last dimension varies fastest.
 */
export function enumerateLattice(
  problem: CheapProblem,
): readonly (readonly number[])[] {
  const total = Math.pow(problem.levels, problem.dimensions);
  const step = (problem.upper - problem.lower) / (problem.levels - 1);
  const points: number[][] = [];
  for (let index = 0; index < total; index++) {
    const point = new Array<number>(problem.dimensions);
    let rest = index;
    for (let d = problem.dimensions - 1; d >= 0; d--) {
      point[d] = problem.lower + (rest % problem.levels) * step;
      rest = Math.floor(rest / problem.levels);
    }
    points.push(point);
  }
  return points;
}

/**
 * Evaluate the whole lattice exactly — the ground truth the study measures
 * against.
 *
 * @param problem - The problem.
 * @returns Every point, its exact score, and the known global optimum.
 * @throws {Error} When any score comes back non-finite, which would make every
 *   ordering downstream meaningless.
 */
export function groundTruth(problem: CheapProblem): GroundTruth {
  const points = enumerateLattice(problem);
  const scores = new Array<number>(points.length);
  let optimumIndex = 0;
  let worstScore = Infinity;
  for (let i = 0; i < points.length; i++) {
    const score = scoreAt(problem, points[i]);
    if (!Number.isFinite(score)) {
      throw new Error(
        `lattice point ${i} of ${problem.name} scored ${score}: a non-finite ` +
          `ground truth cannot be ranked`,
      );
    }
    scores[i] = score;
    if (score > scores[optimumIndex]) optimumIndex = i;
    if (score < worstScore) worstScore = score;
  }
  return {
    points,
    scores,
    optimumIndex,
    optimumScore: scores[optimumIndex],
    worstScore,
  };
}

/**
 * Score every lattice point over a **stride** of the records — the cheap
 * fidelity of Issue #3926, on a problem whose exact ordering is known.
 *
 * @param problem - The problem.
 * @param points - The lattice, from {@link enumerateLattice}.
 * @param rate - Fraction of the records kept, in `(0, 1]`.
 * @param phase - Which stratum of the stride to take. Default `0`.
 * @returns One approximate score per point, in point order.
 * @throws {Error} As {@link stridePhaseIndices} for an invalid rate or phase.
 */
export function approximateScores(
  problem: CheapProblem,
  points: readonly (readonly number[])[],
  rate: number,
  phase = 0,
): number[] {
  const indices = stridePhaseIndices(problem.records.length, rate, phase);
  return points.map((point) => scoreAt(problem, point, indices));
}
