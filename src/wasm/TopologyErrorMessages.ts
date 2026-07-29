/**
 * TopologyErrorMessages.ts — human-readable labels for the topology and
 * structural error codes returned by NEAT-AI-core (`topology_ops.rs`).
 *
 * Issue #3512: the malformed-buffer codes added for #2659 had no caller, so
 * a Rust-side `MALFORMED_BUFFER` return reached users as a bare "unknown".
 * Keeping the lookup here — beside the constants it mirrors — gives every
 * code in the wire contract a loud, specific label and a single source of
 * truth for callers such as `creatureValidate`.
 */

import {
  STRUCTURAL_BIAS_NOT_FINITE,
  STRUCTURAL_CONSTANT_HAS_INWARD,
  STRUCTURAL_HIDDEN_NO_INWARD,
  STRUCTURAL_HIDDEN_NO_OUTWARD,
  STRUCTURAL_IF_MISSING_CONDITION,
  STRUCTURAL_IF_MISSING_NEGATIVE,
  STRUCTURAL_IF_MISSING_POSITIVE,
  STRUCTURAL_IF_TOO_FEW_INWARD,
  STRUCTURAL_MALFORMED_BUFFER,
  STRUCTURAL_SYNAPSE_TARGETS_INPUT,
  TOPOLOGY_BACKWARD_CONNECTION,
  TOPOLOGY_DUPLICATE_CONNECTION,
  TOPOLOGY_MALFORMED_BUFFER,
  TOPOLOGY_SELF_CONNECTION,
  TOPOLOGY_SORT_ERROR_FROM,
  TOPOLOGY_SORT_ERROR_TO,
} from "@wasm/WasmTopologyOps.ts";

const TOPOLOGY_MESSAGES: Record<number, string> = {
  [TOPOLOGY_SELF_CONNECTION]: "Self-connection",
  [TOPOLOGY_BACKWARD_CONNECTION]: "Backward connection",
  [TOPOLOGY_SORT_ERROR_FROM]: "From indices not sorted",
  [TOPOLOGY_SORT_ERROR_TO]: "To indices not sorted",
  [TOPOLOGY_DUPLICATE_CONNECTION]: "Duplicate connection",
  [TOPOLOGY_MALFORMED_BUFFER]: "Malformed input buffers",
};

const STRUCTURAL_MESSAGES: Record<number, string> = {
  [STRUCTURAL_SYNAPSE_TARGETS_INPUT]: "Synapse targets input neuron",
  [STRUCTURAL_CONSTANT_HAS_INWARD]: "Constant neuron has inward connections",
  [STRUCTURAL_HIDDEN_NO_INWARD]: "Hidden neuron has no inward connections",
  [STRUCTURAL_HIDDEN_NO_OUTWARD]: "Hidden neuron has no outward connections",
  [STRUCTURAL_BIAS_NOT_FINITE]: "Non-finite bias",
  [STRUCTURAL_IF_TOO_FEW_INWARD]: "IF neuron has too few inward connections",
  [STRUCTURAL_IF_MISSING_CONDITION]: "IF neuron missing condition synapse",
  [STRUCTURAL_IF_MISSING_POSITIVE]: "IF neuron missing positive synapse",
  [STRUCTURAL_IF_MISSING_NEGATIVE]: "IF neuron missing negative synapse",
  [STRUCTURAL_MALFORMED_BUFFER]: "Malformed structural input buffers",
};

/** Label for a `TOPOLOGY_*` error code; unrecognised codes name themselves. */
export function topologyErrorMessage(errorCode: number): string {
  return TOPOLOGY_MESSAGES[errorCode] ??
    `unrecognised topology error code ${errorCode}`;
}

/** Label for a `STRUCTURAL_*` error code; unrecognised codes name themselves. */
export function structuralErrorMessage(errorCode: number): string {
  return STRUCTURAL_MESSAGES[errorCode] ??
    `unrecognised structural error code ${errorCode}`;
}
