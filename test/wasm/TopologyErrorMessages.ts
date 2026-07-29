/**
 * Tests for the WASM topology/structural error-code labels (Issue #3512).
 *
 * The malformed-buffer codes added by NEAT-AI #2659 previously had no
 * caller, so a Rust-side `MALFORMED_BUFFER` return surfaced to users as
 * "unknown" — a quiet failure. These tests assert every code in the wire
 * contract maps to a distinct, meaningful label, and that an unrecognised
 * code names itself rather than hiding behind a bare "unknown".
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  structuralErrorMessage,
  topologyErrorMessage,
} from "@wasm/TopologyErrorMessages.ts";
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

Deno.test("topologyErrorMessage: malformed buffer code is described, not 'unknown'", () => {
  const message = topologyErrorMessage(TOPOLOGY_MALFORMED_BUFFER);
  assertEquals(message, "Malformed input buffers");
});

Deno.test("structuralErrorMessage: malformed buffer code is described, not 'unknown'", () => {
  const message = structuralErrorMessage(STRUCTURAL_MALFORMED_BUFFER);
  assertEquals(message, "Malformed structural input buffers");
});

Deno.test("topologyErrorMessage: every topology error code has a distinct label", () => {
  const codes = [
    TOPOLOGY_SELF_CONNECTION,
    TOPOLOGY_BACKWARD_CONNECTION,
    TOPOLOGY_SORT_ERROR_FROM,
    TOPOLOGY_SORT_ERROR_TO,
    TOPOLOGY_DUPLICATE_CONNECTION,
    TOPOLOGY_MALFORMED_BUFFER,
  ];
  const labels = codes.map(topologyErrorMessage);
  for (const label of labels) {
    assert(label.length > 0, "label must not be empty");
    assert(
      !label.includes("unrecognised"),
      `known code produced a fallback label: ${label}`,
    );
  }
  assertEquals(new Set(labels).size, codes.length, "labels must be distinct");
});

Deno.test("structuralErrorMessage: every structural error code has a distinct label", () => {
  const codes = [
    STRUCTURAL_SYNAPSE_TARGETS_INPUT,
    STRUCTURAL_CONSTANT_HAS_INWARD,
    STRUCTURAL_HIDDEN_NO_INWARD,
    STRUCTURAL_HIDDEN_NO_OUTWARD,
    STRUCTURAL_BIAS_NOT_FINITE,
    STRUCTURAL_IF_TOO_FEW_INWARD,
    STRUCTURAL_IF_MISSING_CONDITION,
    STRUCTURAL_IF_MISSING_POSITIVE,
    STRUCTURAL_IF_MISSING_NEGATIVE,
    STRUCTURAL_MALFORMED_BUFFER,
  ];
  const labels = codes.map(structuralErrorMessage);
  for (const label of labels) {
    assert(label.length > 0, "label must not be empty");
    assert(
      !label.includes("unrecognised"),
      `known code produced a fallback label: ${label}`,
    );
  }
  assertEquals(new Set(labels).size, codes.length, "labels must be distinct");
});

Deno.test("topologyErrorMessage: the two families do not share labels", () => {
  // Code 6 means MALFORMED_BUFFER for topology but IF_TOO_FEW_INWARD for
  // structural — the lookups must not be interchangeable.
  assertNotEquals(topologyErrorMessage(6), structuralErrorMessage(6));
});

Deno.test("topologyErrorMessage: unrecognised code names itself", () => {
  const message = topologyErrorMessage(99);
  assert(
    message.includes("99"),
    `fallback must name the code, got: ${message}`,
  );
});

Deno.test("structuralErrorMessage: unrecognised code names itself", () => {
  const message = structuralErrorMessage(-1);
  assert(
    message.includes("-1"),
    `fallback must name the code, got: ${message}`,
  );
});

Deno.test("topologyErrorMessage: non-finite code falls back without throwing", () => {
  assert(topologyErrorMessage(NaN).includes("NaN"));
  assert(structuralErrorMessage(Number.POSITIVE_INFINITY).includes("Infinity"));
});
