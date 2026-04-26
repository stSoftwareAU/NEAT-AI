/**
 * TopologicalBackpropagation.ts - Iterative backpropagation using topological ordering.
 *
 * Issue #1641 - Replaces the recursive backpropagation traversal with an
 * iterative approach that processes neurons in reverse topological order.
 * Each neuron is visited exactly once, eliminating the combinatorial
 * explosion of revisits in densely connected networks.
 *
 * Issue #2416 - The TypeScript implementation has been removed; the canonical
 * loop now lives in NEAT-AI-core (`neat-core/src/topological_backprop.rs`)
 * and is invoked via the byte-packed ABI shim in
 * {@link wasmTopologicalBackprop}. This module is now a thin entry point that
 * dispatches to WASM and fails fast when WASM is unavailable.
 */

import type { Creature } from "@creature";
import type { BackPropagationConfig } from "@propagate/BackPropagation.ts";
import type { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { wasmTopologicalBackprop } from "@propagate/WasmTopologicalBackprop.ts";
import { WasmError } from "@errors/WasmError.ts";

/**
 * Propagate expected values backward through the network using
 * iterative topological ordering. Delegates entirely to the WASM-backed
 * implementation in NEAT-AI-core (Issue #1954, #2416).
 *
 * Each neuron is visited exactly once. Error signals from all downstream
 * paths are accumulated before processing, then distributed to upstream
 * connections in a single pass.
 *
 * Throws `WasmError` when the WASM module is not loaded — there is no
 * TypeScript fallback.
 */
export function propagateTopological(
  creature: Creature,
  expected: Float32Array,
  config: BackPropagationConfig,
  sparseConfig: SparseConfig,
): void {
  if (wasmTopologicalBackprop(creature, expected, config, sparseConfig)) {
    return;
  }

  throw new WasmError(
    "propagateTopological requires the WASM module to be loaded. " +
      "Ensure the NEAT-AI package is installed correctly.",
    "MODULE_NOT_LOADED",
  );
}
