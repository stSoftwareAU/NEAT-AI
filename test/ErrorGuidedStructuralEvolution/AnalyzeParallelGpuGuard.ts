/**
 * Tests for analyzeParallel GPU availability guard (Issue #2115).
 *
 * Validates that analyzeParallel() returns a graceful failure when GPU is
 * unavailable and requireGpu is not explicitly set to false, preventing
 * Rust thread panics from hard assert! statements.
 */
import { assertEquals } from "@std/assert";
import { analyzeParallel } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryOperations.ts";
import {
  isRustGpuAvailable,
  isRustLibraryAvailable,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryLibrary.ts";
import type { RustParallelAnalysisInput } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryTypes.ts";

/**
 * Build a minimal (but structurally valid) parallel-analysis input.
 * The values do not need to correspond to real files or creatures — the GPU
 * guard must reject the call *before* any Rust FFI interaction.
 */
function buildStubInput(
  overrides: Partial<RustParallelAnalysisInput> = {},
): RustParallelAnalysisInput {
  return {
    parquetFile: "/tmp/nonexistent.parquet",
    creature: {
      uuid: "test-creature-uuid",
      neurons: [],
      synapses: [],
      score: 0,
    },
    focusNeurons: ["test-neuron-uuid"],
    ...overrides,
  } as RustParallelAnalysisInput;
}

Deno.test({
  name:
    "analyzeParallel returns graceful failure when library available but GPU unavailable",
  ignore: !isRustLibraryAvailable() || isRustGpuAvailable(),
  sanitizeResources: false,
  fn: () => {
    // When the library is loaded but no GPU is detected, calling
    // analyzeParallel with requireGpu unset (defaults to requiring GPU)
    // should return a failure result without calling into Rust FFI.
    const input = buildStubInput();
    const result = analyzeParallel(input);

    assertEquals(result?.success, false);
    assertEquals(
      typeof result?.error,
      "string",
      "Error message should be a string",
    );
    // The error should mention GPU unavailability
    assertEquals(
      result?.error?.includes("GPU adapter not available"),
      true,
      `Error should mention GPU adapter, got: ${result?.error}`,
    );
  },
});

Deno.test({
  name: "analyzeParallel proceeds when requireGpu is false even without GPU",
  ignore: !isRustLibraryAvailable(),
  sanitizeResources: false,
  fn: () => {
    // When requireGpu is explicitly false, the guard should not block the call.
    // The call may still fail for other reasons (e.g. invalid parquet file),
    // but it should NOT fail with "GPU adapter not available".
    const input = buildStubInput({ requireGpu: false });
    const result = analyzeParallel(input);

    if (result !== null && !result.success) {
      // If it failed, it should NOT be because of the GPU guard
      assertEquals(
        result.error?.includes("GPU adapter not available"),
        false,
        `Should not get GPU guard error when requireGpu=false, got: ${result.error}`,
      );
    }
    // If result is null (library unavailable) or success, that's fine too
  },
});

Deno.test({
  name:
    "analyzeParallel with requireGpu=false returns structured Rust error when GPU unavailable (Issue #2116)",
  ignore: !isRustLibraryAvailable() || isRustGpuAvailable(),
  sanitizeResources: false,
  fn: () => {
    // Issue #2116: When requireGpu is false and GPU is unavailable, the Rust
    // FFI layer should return a structured error with errorKind "GpuPermanent"
    // instead of panicking via assert!.
    const input = buildStubInput({ requireGpu: false });
    const result = analyzeParallel(input);

    // The TypeScript guard allows this through (requireGpu === false),
    // so the call reaches the Rust layer which returns a structured error.
    if (result !== null) {
      assertEquals(
        result.success,
        false,
        "Should fail because GPU is unavailable",
      );
      assertEquals(
        typeof result.error,
        "string",
        "Error message should be present from Rust layer",
      );
      assertEquals(
        result.errorKind,
        "GpuPermanent",
        "Rust should classify GPU unavailability as GpuPermanent",
      );
    }
  },
});

Deno.test({
  name: "analyzeParallel returns null when library is unavailable",
  ignore: isRustLibraryAvailable(),
  fn: () => {
    const input = buildStubInput();
    const result = analyzeParallel(input);
    assertEquals(
      result,
      null,
      "Should return null when library is unavailable",
    );
  },
});
