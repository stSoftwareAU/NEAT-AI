import type { DataRecordInterface } from "@architecture/DataSet.ts";

/**
 * Training data for the hypotenuse regression suite (`test/NEAT/Ratios.ts`).
 *
 * The suite evolves a 2-2-1 creature to approximate `sqrt(i² + j²)` and then
 * asserts on an input the creature was never trained on, so the grid is built
 * around one invariant: the probe row is **held out**. Everything else about
 * the grid — how densely it is sampled — is a cost knob, and Issue #4026 turned
 * it down: the dense 9,900-record grid cost ~318s of CI test time, 31% of the
 * whole suite and the hard floor on every coverage shard plan, because each of
 * the suite's retry attempts back-propagated over all 9,900 records.
 */

/** Input-axis value deliberately absent from training; the suite probes it. */
export const HYPOTENUSE_HOLD_OUT = 50;

/** Exclusive upper bound of both input axes. */
export const HYPOTENUSE_GRID_SIZE = 100;

/**
 * Default stride between sampled grid points. Measured against the previous
 * dense grid (`step: 1`, 9,900 records) on an otherwise idle machine with CI's
 * backprop configuration: ~81s per evolve attempt fell to ~4.4s at this stride
 * — an ~18x cut — with the per-attempt success rate unchanged inside
 * measurement noise (see `docs/archive/pr-summaries/pr-summary-4026.md`).
 */
export const HYPOTENUSE_STEP = 5;

/** Knobs for {@link buildHypotenuseDataSet}; every one has a tested default. */
export interface HypotenuseDataSetOptions {
  /** Stride between sampled grid points. Defaults to {@link HYPOTENUSE_STEP}. */
  step?: number;
  /** Exclusive upper bound of both axes. Defaults to {@link HYPOTENUSE_GRID_SIZE}. */
  size?: number;
  /**
   * Input-axis value excluded from every record, so the suite's probe is out
   * of sample. Defaults to {@link HYPOTENUSE_HOLD_OUT}; a value off the grid
   * holds nothing out.
   */
  holdOut?: number;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(
      `${name} must be a positive integer, got ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Build the `(i, j) -> sqrt(i² + j²)` grid, sampled every `step` on both axes
 * over `[0, size)`, omitting every record whose first input is `holdOut`.
 *
 * Fails loudly on an unusable stride or grid size rather than quietly
 * returning an empty or truncated data set — a silently empty training set
 * would leave the suite asserting on an untrained creature.
 */
export function buildHypotenuseDataSet(
  options: HypotenuseDataSetOptions = {},
): DataRecordInterface[] {
  const {
    step = HYPOTENUSE_STEP,
    size = HYPOTENUSE_GRID_SIZE,
    holdOut = HYPOTENUSE_HOLD_OUT,
  } = options;

  assertPositiveInteger("size", size);
  assertPositiveInteger("step", step);
  if (step > size) {
    throw new RangeError(
      `step ${step} must not exceed the grid size ${size}, or the grid is a single point`,
    );
  }

  const ts: DataRecordInterface[] = [];
  for (let i = 0; i < size; i += step) {
    if (i === holdOut) continue;
    for (let j = 0; j < size; j += step) {
      ts.push({
        input: new Float32Array([i, j]),
        output: new Float32Array([Math.sqrt(i * i + j * j)]),
      });
    }
  }
  return ts;
}
