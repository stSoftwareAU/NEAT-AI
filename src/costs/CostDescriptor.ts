/**
 * costName → TaskDescriptor mapping helper (Issue #2786).
 *
 * Pure helper: given a cost name, return the canonical descriptor used by
 * Discovery and by the caller-side cost-aware early-stop / champion
 * selection logic (Issue #2787). No wire/FFI changes happen here — the
 * descriptor is a value object.
 *
 * Built-ins map per the table in Issue #2786. Custom JS costs and any
 * unrecognised name map to the sentinel `OTHER` plus a neutral descriptor.
 * The original custom name is NEVER returned to the caller — that would
 * leak structure to Discovery and defeat the purpose of the sentinel.
 *
 * | costName               | topology     | range        | output squash family |
 * |------------------------|--------------|--------------|----------------------|
 * | MSE, MAE               | independent  | unbounded    | unbounded            |
 * | MAPE, MSLE             | independent  | positive     | positive             |
 * | BINARY_CROSS_ENTROPY   | independent  | unit         | bounded_unipolar     |
 * | CROSS_ENTROPY          | simplex      | unit         | bounded_unipolar     |
 * | HINGE                  | margin       | signed_unit  | bounded_bipolar      |
 * | CATEGORICAL_ERROR      | one_hot      | unit         | bounded_unipolar     |
 * | OTHER (custom JS)      | unknown      | unbounded    | any                  |
 */

/** Topology of the target distribution implied by the cost. */
export type CostTopology =
  | "independent"
  | "simplex"
  | "margin"
  | "one_hot"
  | "unknown";

/** Numerical range the cost is defined over. */
export type CostRange = "unbounded" | "positive" | "unit" | "signed_unit";

/** Output activation family that pairs naturally with the cost. */
export type CostSquashFamily =
  | "unbounded"
  | "positive"
  | "bounded_unipolar"
  | "bounded_bipolar"
  | "any";

/**
 * Canonical descriptor for a cost. The `costName` field is either one of
 * the built-in names or the literal sentinel `"OTHER"`. The original
 * caller-supplied name for a custom cost is never copied into this struct.
 */
export interface TaskDescriptor {
  readonly costName: string;
  readonly topology: CostTopology;
  readonly range: CostRange;
  readonly outputSquashFamily: CostSquashFamily;
}

const NEUTRAL_OTHER: TaskDescriptor = Object.freeze({
  costName: "OTHER",
  topology: "unknown",
  range: "unbounded",
  outputSquashFamily: "any",
});

const TABLE: Readonly<Record<string, TaskDescriptor>> = Object.freeze({
  MSE: {
    costName: "MSE",
    topology: "independent",
    range: "unbounded",
    outputSquashFamily: "unbounded",
  },
  MAE: {
    costName: "MAE",
    topology: "independent",
    range: "unbounded",
    outputSquashFamily: "unbounded",
  },
  MAPE: {
    costName: "MAPE",
    topology: "independent",
    range: "positive",
    outputSquashFamily: "positive",
  },
  MSLE: {
    costName: "MSLE",
    topology: "independent",
    range: "positive",
    outputSquashFamily: "positive",
  },
  BINARY_CROSS_ENTROPY: {
    costName: "BINARY_CROSS_ENTROPY",
    topology: "independent",
    range: "unit",
    outputSquashFamily: "bounded_unipolar",
  },
  CROSS_ENTROPY: {
    costName: "CROSS_ENTROPY",
    topology: "simplex",
    range: "unit",
    outputSquashFamily: "bounded_unipolar",
  },
  HINGE: {
    costName: "HINGE",
    topology: "margin",
    range: "signed_unit",
    outputSquashFamily: "bounded_bipolar",
  },
  CATEGORICAL_ERROR: {
    costName: "CATEGORICAL_ERROR",
    topology: "one_hot",
    range: "unit",
    outputSquashFamily: "bounded_unipolar",
  },
});

/**
 * Maps a (possibly undefined or custom) cost name to its canonical
 * `TaskDescriptor`. Unknown/custom names are collapsed to a neutral
 * `OTHER` descriptor — the original name is never copied through.
 */
export function costNameToTaskDescriptor(
  name: string | undefined,
): TaskDescriptor {
  if (!name) return NEUTRAL_OTHER;
  const descriptor = TABLE[name];
  return descriptor ?? NEUTRAL_OTHER;
}

/**
 * True iff `name` is a built-in cost the project knows how to calibrate
 * cost-aware behaviour for. Custom JS costs return false so callers can
 * route them through the legacy (cost-agnostic) path as a regression guard
 * (Issue #2787 acceptance criteria).
 */
export function isCostAware(name: string | undefined): boolean {
  if (!name) return false;
  return Object.hasOwn(TABLE, name);
}
