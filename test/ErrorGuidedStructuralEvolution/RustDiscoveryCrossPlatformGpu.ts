/**
 * Tests for cross-platform GPU support via wgpu abstraction (Issue #1864).
 *
 * Validates:
 * - GPU backend detection returns a known backend name
 * - Discovery is enabled when library is available (regardless of GPU)
 * - CPU fallback behaviour when GPU is unavailable
 * - RustCheckGpuResult type includes backend field
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  closeRustLibrary,
  getRustGpuBackend,
  isRustDiscoveryEnabled,
  isRustGpuAvailable,
  isRustLibraryAvailable,
  shouldSkipRustDiscoveryTests,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

const KNOWN_BACKENDS = ["metal", "vulkan", "dx12", "gl"];

Deno.test({
  name: "discovery enabled with library available (CPU fallback supported)",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  fn: () => {
    try {
      // When the Rust library is available, discovery should be enabled
      // regardless of whether GPU is available (CPU fallback is supported)
      const libraryAvailable = isRustLibraryAvailable();
      assert(libraryAvailable, "Rust library should be available");

      const discoveryEnabled = isRustDiscoveryEnabled();
      assert(
        discoveryEnabled,
        "Discovery should be enabled when library is available " +
          "(GPU is optional — CPU fallback supported)",
      );
    } finally {
      closeRustLibrary();
    }
  },
});

Deno.test({
  name: "GPU backend is a known wgpu backend when GPU is available",
  ignore: shouldSkipRustDiscoveryTests(),
  fn: () => {
    try {
      const gpuAvailable = isRustGpuAvailable();
      const backend = getRustGpuBackend();

      if (gpuAvailable) {
        // When GPU is available, backend must be a known wgpu backend
        assertNotEquals(
          backend,
          undefined,
          "Backend should be reported when GPU is available",
        );
        assert(
          KNOWN_BACKENDS.includes(backend!),
          `Backend "${backend}" should be one of: ${KNOWN_BACKENDS.join(", ")}`,
        );
      } else {
        // When GPU is not available, backend should be undefined
        assertEquals(
          backend,
          undefined,
          "Backend should be undefined when no GPU is available",
        );
      }
    } finally {
      closeRustLibrary();
    }
  },
});

Deno.test({
  name: "GPU backend matches platform expectations",
  ignore: shouldSkipRustDiscoveryTests(),
  fn: () => {
    try {
      const backend = getRustGpuBackend();

      if (backend !== undefined) {
        // Platform-specific backend expectations
        if (Deno.build.os === "darwin") {
          assertEquals(
            backend,
            "metal",
            "macOS should use Metal backend",
          );
        } else if (Deno.build.os === "linux") {
          assertEquals(
            backend,
            "vulkan",
            "Linux should use Vulkan backend",
          );
        } else if (Deno.build.os === "windows") {
          assertEquals(
            backend,
            "dx12",
            "Windows should use DX12 backend",
          );
        }
      }
    } finally {
      closeRustLibrary();
    }
  },
});

Deno.test({
  name: "discovery does not require GPU — library alone is sufficient",
  ignore: shouldSkipRustDiscoveryTests(),
  fn: () => {
    try {
      // The key behaviour change from Issue #1864:
      // isRustDiscoveryEnabled() should return true when the library is
      // available, even if GPU is not available (CPU fallback is supported).
      const libraryAvailable = isRustLibraryAvailable();
      if (libraryAvailable) {
        const discoveryEnabled = isRustDiscoveryEnabled();
        assert(
          discoveryEnabled,
          "Discovery must be enabled when library is available. " +
            "GPU is optional — the Rust library supports CPU fallback.",
        );
      }
    } finally {
      closeRustLibrary();
    }
  },
});
