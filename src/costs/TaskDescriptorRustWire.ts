/**
 * Wire/FFI mapper that converts the internal snake_case {@link TaskDescriptor}
 * (Issue #2786) into the PascalCase shape NEAT-AI-Discovery expects on the
 * `recordDiscovery` / `analyzeParallel` FFI boundary (Issue #3012).
 *
 * NEAT-AI-Discovery deserialises a Rust `TaskDescriptor` with camelCase field
 * names (`targetTopology`, `targetRange`, `outputSquashFamily`, `numOutputs`)
 * and PascalCase enum variants (`Unbounded`, `BoundedUnipolar`, …). Forwarding
 * the internal descriptor unchanged makes Rust fail with
 * `unknown variant 'unbounded'`, so every payload crossing the FFI boundary
 * must be mapped through {@link taskDescriptorToRustWire} first.
 *
 * The internal {@link TaskDescriptor} types (Issue #2786) stay unchanged; this
 * module is the single source of truth for the wire shape.
 */

import type {
  CostRange,
  CostTopology,
  OutputSquashFamily,
  TaskDescriptor,
} from "@costs/CostTaskDescriptor.ts";

/** PascalCase target topology accepted by NEAT-AI-Discovery. */
export type RustWireTopology =
  | "Independent"
  | "Simplex"
  | "Margin"
  | "OneHot"
  | "Unknown";

/** PascalCase target range accepted by NEAT-AI-Discovery. */
export type RustWireRange =
  | "Unbounded"
  | "Positive"
  | "Unit"
  | "SignedUnit";

/** PascalCase output squash family accepted by NEAT-AI-Discovery. */
export type RustWireSquashFamily =
  | "Unbounded"
  | "Positive"
  | "BoundedUnipolar"
  | "BoundedBipolar"
  | "Any";

/**
 * The exact `taskDescriptor` shape sent across the FFI boundary. Field names
 * and enum casing match the Rust `TaskDescriptor` struct in
 * NEAT-AI-Discovery (`src/analysis/task_descriptor.rs`).
 *
 * Note: the internal `costName` is deliberately **not** present on the wire —
 * Rust has no such field and a custom cost's real name must never leak.
 */
export interface RustWireTaskDescriptor {
  readonly targetTopology: RustWireTopology;
  readonly targetRange: RustWireRange;
  readonly outputSquashFamily: RustWireSquashFamily;
  readonly numOutputs: number;
}

const TOPOLOGY_TO_WIRE: Readonly<Record<CostTopology, RustWireTopology>> =
  Object.freeze({
    independent: "Independent",
    simplex: "Simplex",
    margin: "Margin",
    one_hot: "OneHot",
    unknown: "Unknown",
  });

const RANGE_TO_WIRE: Readonly<Record<CostRange, RustWireRange>> = Object.freeze(
  {
    unbounded: "Unbounded",
    positive: "Positive",
    unit: "Unit",
    signed_unit: "SignedUnit",
  },
);

const SQUASH_FAMILY_TO_WIRE: Readonly<
  Record<OutputSquashFamily, RustWireSquashFamily>
> = Object.freeze({
  unbounded: "Unbounded",
  positive: "Positive",
  bounded_unipolar: "BoundedUnipolar",
  bounded_bipolar: "BoundedBipolar",
  any: "Any",
});

/**
 * Maps an internal {@link TaskDescriptor} to the PascalCase wire shape Discovery
 * deserialises, attaching `numOutputs` from the creature export.
 *
 * Unrecognised enum values (which the type system already forbids) defensively
 * collapse to the neutral `Unknown` / `Unbounded` / `Any` variants rather than
 * forwarding a value Rust would reject.
 *
 * @param descriptor - The internal structural descriptor (Issue #2786).
 * @param numOutputs - Number of output neurons from the creature export.
 * @returns The wire descriptor with PascalCase field names and enum variants.
 */
export function taskDescriptorToRustWire(
  descriptor: TaskDescriptor,
  numOutputs: number,
): RustWireTaskDescriptor {
  const safeNumOutputs = Number.isFinite(numOutputs) && numOutputs > 0
    ? Math.floor(numOutputs)
    : 0;

  return {
    targetTopology: TOPOLOGY_TO_WIRE[descriptor.topology] ?? "Unknown",
    targetRange: RANGE_TO_WIRE[descriptor.range] ?? "Unbounded",
    outputSquashFamily: SQUASH_FAMILY_TO_WIRE[descriptor.outputSquashFamily] ??
      "Any",
    numOutputs: safeNumOutputs,
  };
}
