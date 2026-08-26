/**
 * Pins the `errorKind` wire contract of NEAT-AI-Discovery (Issues #2116, #3892).
 *
 * Discovery serialises its `DiscoveryErrorKind` enum with
 * `#[serde(rename_all = "snake_case")]`, so a GPU-less host receives
 * `"gpu_permanent"` — never the Rust variant name `"GpuPermanent"`. The live
 * FFI guard test only runs on a worker that has the library and no GPU; these
 * assertions run everywhere, so a mirror that drifts back to the Rust
 * identifiers fails in ordinary CI.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  isRustDiscoveryErrorKind,
  RUST_DISCOVERY_ERROR_KINDS,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryErrorKind.ts";
import type { RustParallelAnalysisResult } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryTypes.ts";

Deno.test("errorKind mirror carries Discovery's snake_case wire spellings", () => {
  assertEquals(
    [...RUST_DISCOVERY_ERROR_KINDS].sort(),
    [
      "cancelled",
      "data_validation",
      "gpu_permanent",
      "gpu_transient",
      "gpu_wedged",
      "internal_panic",
      "io_error",
      "memory_exhausted",
      "timeout",
      "unknown",
    ],
    "mirror must match DiscoveryErrorKind, serialised snake_case",
  );

  for (const kind of RUST_DISCOVERY_ERROR_KINDS) {
    assertEquals(
      kind,
      kind.toLowerCase(),
      `${kind} must be the snake_case wire value, not a Rust variant name`,
    );
  }
});

Deno.test("isRustDiscoveryErrorKind accepts every wire value", () => {
  for (const kind of RUST_DISCOVERY_ERROR_KINDS) {
    assert(isRustDiscoveryErrorKind(kind), `${kind} should be recognised`);
  }
});

Deno.test("isRustDiscoveryErrorKind rejects Rust variant names and non-strings", () => {
  // The exact regression from Issue #3892: the Rust identifier is not the wire
  // value, so it must not be mistaken for one.
  assertFalse(isRustDiscoveryErrorKind("GpuPermanent"));
  assertFalse(isRustDiscoveryErrorKind("DataValidation"));
  assertFalse(isRustDiscoveryErrorKind("GPU_PERMANENT"));
  assertFalse(isRustDiscoveryErrorKind("gpuPermanent"));
  assertFalse(isRustDiscoveryErrorKind(""));
  assertFalse(isRustDiscoveryErrorKind(undefined));
  assertFalse(isRustDiscoveryErrorKind(null));
  assertFalse(isRustDiscoveryErrorKind(42));
  assertFalse(isRustDiscoveryErrorKind(["gpu_permanent"]));
});

Deno.test("a GPU-unavailable analysis response narrows to gpu_permanent", () => {
  // The bytes a GPU-less Discovery build returns from `analyze_parallel`.
  const wire =
    '{"success":false,"error":"No GPU adapter available","errorKind":"gpu_permanent"}';

  const result = JSON.parse(wire) as RustParallelAnalysisResult;

  assertEquals(result.success, false);
  assert(
    isRustDiscoveryErrorKind(result.errorKind),
    "the classification must be a known wire value",
  );
  assertEquals(result.errorKind, "gpu_permanent");
});
