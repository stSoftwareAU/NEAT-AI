/**
 * Tests for GPU backend detection and the getGpuBackendInfo() function.
 *
 * Issue #1864: Verify cross-platform GPU backend detection works correctly,
 * including fallback behaviour when the Rust library is not available.
 */
import { assertEquals } from "@std/assert";
import {
  getGpuBackendInfo,
  isRustGpuAvailable,
  rustLibraryExists,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import type { GpuBackendInfo } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

Deno.test({
  name: "getGpuBackendInfo returns structured result",
  sanitizeResources: false,
  sanitizeOps: false,
  fn() {
    const info = getGpuBackendInfo();

    // Should always return a valid GpuBackendInfo object
    assertEquals(typeof info.available, "boolean");

    if (info.available) {
      // When GPU is available, backend name should be reported (if supported)
      if (info.backendName) {
        const validBackends = ["metal", "vulkan", "dx12", "gl"];
        assertEquals(
          validBackends.includes(info.backendName.toLowerCase()),
          true,
          `Backend name "${info.backendName}" should be a valid wgpu backend`,
        );
      }
    } else {
      // When GPU is unavailable, a reason should be provided
      assertEquals(
        typeof info.reason,
        "string",
        "Unavailable GPU should include a reason",
      );
    }
  },
});

Deno.test({
  name: "getGpuBackendInfo is consistent across calls",
  sanitizeResources: false,
  sanitizeOps: false,
  fn() {
    const info1 = getGpuBackendInfo();
    const info2 = getGpuBackendInfo();

    assertEquals(
      info1.available,
      info2.available,
      "GPU availability should be consistent across calls",
    );
    assertEquals(
      info1.backendName,
      info2.backendName,
      "Backend name should be consistent across calls",
    );
  },
});

Deno.test({
  name: "isRustGpuAvailable and getGpuBackendInfo agree",
  sanitizeResources: false,
  sanitizeOps: false,
  fn() {
    const gpuAvailable = isRustGpuAvailable();
    const backendInfo = getGpuBackendInfo();

    if (!rustLibraryExists()) {
      // When library doesn't exist, both should report unavailable
      assertEquals(gpuAvailable, false);
      assertEquals(backendInfo.available, false);
    } else {
      // When library exists, both should agree on GPU availability
      assertEquals(
        gpuAvailable,
        backendInfo.available,
        "isRustGpuAvailable and getGpuBackendInfo should agree",
      );
    }
  },
});

Deno.test("GpuBackendInfo type covers all expected platform backends", () => {
  // Verify the type system accepts all expected backend configurations
  const metalInfo: GpuBackendInfo = {
    available: true,
    backendName: "Metal",
    adapterName: "Apple M1",
  };
  assertEquals(metalInfo.available, true);

  const vulkanInfo: GpuBackendInfo = {
    available: true,
    backendName: "Vulkan",
    adapterName: "NVIDIA GeForce",
  };
  assertEquals(vulkanInfo.available, true);

  const dx12Info: GpuBackendInfo = {
    available: true,
    backendName: "Dx12",
    adapterName: "AMD Radeon",
  };
  assertEquals(dx12Info.available, true);

  const glInfo: GpuBackendInfo = {
    available: true,
    backendName: "Gl",
    adapterName: "Mesa Intel",
  };
  assertEquals(glInfo.available, true);

  const cpuFallback: GpuBackendInfo = {
    available: false,
    reason: "no compatible GPU adapter found",
  };
  assertEquals(cpuFallback.available, false);
});
