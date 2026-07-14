/**
 * Pure mapping from a configured cost name to the {@link TaskDescriptor} that
 * NEAT-AI sends to Discovery (Issue #2786).
 *
 * The descriptor captures only the *structural shape* a cost imposes on the
 * output layer — never the cost's implementation. Built-in costs map to their
 * canonical descriptor; any custom JS cost or unrecognised name collapses to
 * the {@link OTHER_COST_NAME} sentinel with a neutral descriptor.
 *
 * > [!IMPORTANT]
 * > The real name of a custom cost is **never** emitted. Returning the custom
 * > name would imply structure Discovery cannot rely on, so unrecognised names
 * > are always reported as `OTHER`.
 *
 * This helper is intentionally free of wire/FFI concerns — sending the
 * descriptor is handled separately (Issue #2785).
 */

import type { BuiltInCostName } from "@costs";

/** Sentinel cost name emitted for any custom JS / unrecognised cost. */
export const OTHER_COST_NAME = "OTHER";

/**
 * Topology the cost imposes across the output neurons.
 *
 * - `independent` — outputs scored element-wise, no cross-output coupling.
 * - `simplex` — outputs form a probability distribution that sums to one.
 * - `margin` — a signed decision margin (e.g. hinge loss).
 * - `one_hot` — exactly one output is the correct class.
 * - `unknown` — structure cannot be inferred (custom costs).
 */
export type CostTopology =
  | "independent"
  | "simplex"
  | "margin"
  | "one_hot"
  | "unknown";

/**
 * Numeric range the cost expects target/output values to occupy.
 *
 * - `unbounded` — any real value.
 * - `positive` — non-negative values.
 * - `unit` — the closed interval [0, 1].
 * - `signed_unit` — the closed interval [-1, 1].
 */
export type CostRange =
  | "unbounded"
  | "positive"
  | "unit"
  | "signed_unit";

/**
 * Family of output squash the cost is compatible with.
 *
 * - `unbounded` — linear / identity-style outputs.
 * - `positive` — non-negative outputs (e.g. softplus, relu).
 * - `bounded_unipolar` — outputs in [0, 1] (e.g. sigmoid, softmax).
 * - `bounded_bipolar` — outputs in [-1, 1] (e.g. tanh).
 * - `any` — no compatibility constraint (custom costs).
 */
export type OutputSquashFamily =
  | "unbounded"
  | "positive"
  | "bounded_unipolar"
  | "bounded_bipolar"
  | "any";

/**
 * Canonical cost name carried in a descriptor. This is always a built-in name,
 * the additional `BINARY_CROSS_ENTROPY` built-in, or the `OTHER` sentinel —
 * never the real name of a custom cost.
 */
export type DescriptorCostName =
  | BuiltInCostName
  | "BINARY_CROSS_ENTROPY"
  | typeof OTHER_COST_NAME;

/** Structural descriptor of a cost, sent to Discovery. */
export interface TaskDescriptor {
  /** Canonical/sanitised cost name; `OTHER` for custom or unknown costs. */
  readonly costName: DescriptorCostName;
  /** Topology the cost imposes across outputs. */
  readonly topology: CostTopology;
  /** Numeric range the cost expects. */
  readonly range: CostRange;
  /** Output squash family the cost is compatible with. */
  readonly outputSquashFamily: OutputSquashFamily;
}

/**
 * Neutral descriptor returned for any custom JS cost or unrecognised name. It
 * deliberately carries no information that would imply structure Discovery
 * cannot rely on, and never embeds the real custom name.
 */
export const OTHER_TASK_DESCRIPTOR: TaskDescriptor = Object.freeze({
  costName: OTHER_COST_NAME,
  topology: "unknown",
  range: "unbounded",
  outputSquashFamily: "any",
});

/**
 * Canonical descriptors for every named built-in cost (the table in Issue
 * #2786). A `Map` is used rather than a plain object so arbitrary lookups (e.g.
 * `"toString"`) cannot resolve to inherited prototype members.
 */
const BUILT_IN_DESCRIPTORS: ReadonlyMap<string, TaskDescriptor> = new Map(
  ([
    {
      costName: "MSE",
      topology: "independent",
      range: "unbounded",
      outputSquashFamily: "unbounded",
    },
    {
      // RMSE is the square root of MSE — monotonic in it and reported in the
      // same units — so it shares MSE's task characteristics.
      costName: "RMSE",
      topology: "independent",
      range: "unbounded",
      outputSquashFamily: "unbounded",
    },
    {
      costName: "MAE",
      topology: "independent",
      range: "unbounded",
      outputSquashFamily: "unbounded",
    },
    {
      costName: "MAPE",
      topology: "independent",
      range: "positive",
      outputSquashFamily: "positive",
    },
    {
      costName: "MSLE",
      topology: "independent",
      range: "positive",
      outputSquashFamily: "positive",
    },
    {
      costName: "BINARY_CROSS_ENTROPY",
      topology: "independent",
      range: "unit",
      outputSquashFamily: "bounded_unipolar",
    },
    {
      costName: "CROSS_ENTROPY",
      topology: "simplex",
      range: "unit",
      outputSquashFamily: "bounded_unipolar",
    },
    {
      costName: "HINGE",
      topology: "margin",
      range: "signed_unit",
      outputSquashFamily: "bounded_bipolar",
    },
  ] satisfies TaskDescriptor[]).map((
    descriptor,
  ) => [descriptor.costName, Object.freeze(descriptor)] as const),
);

/**
 * Maps a configured cost name to its {@link TaskDescriptor}.
 *
 * Built-in costs map to their canonical descriptor. Any custom JS cost or
 * unrecognised name returns {@link OTHER_TASK_DESCRIPTOR} — the input string is
 * never reflected back, so a custom cost's real name cannot leak to Discovery.
 *
 * The returned descriptor is frozen and safe to share without defensive copies.
 *
 * @param costName - The configured cost name (built-in or custom).
 * @returns The canonical descriptor, or the neutral `OTHER` descriptor.
 */
export function costNameToTaskDescriptor(costName: string): TaskDescriptor {
  if (typeof costName !== "string") {
    return OTHER_TASK_DESCRIPTOR;
  }

  return BUILT_IN_DESCRIPTORS.get(costName) ?? OTHER_TASK_DESCRIPTOR;
}
