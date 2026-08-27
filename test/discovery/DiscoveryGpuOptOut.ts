/**
 * Tests for the `NEAT_AI_DISCOVERY_GPU` opt-out (GRQ#4405).
 *
 * Some hosts must never create a GPU device: an old Linux worker probed Vulkan,
 * lost the device mid-run (`Parent device is lost`) and killed a 1075 s evolve
 * stage. The native scorer already reads `NEAT_SCORER_GPU=off`; discovery had no
 * equivalent, so the probe ran regardless and logged `GPU acceleration enabled
 * via Vulkan`. These tests drive the real `isRustGpuAvailable()` with the
 * environment set, on a host with or without a GPU.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  closeRustLibrary,
  getGpuBackendInfo,
  isRustGpuAvailable,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryLibrary.ts";

const ENV_KEY = "NEAT_AI_DISCOVERY_GPU";

/**
 * Run `fn` with `ENV_KEY` set to `value` (or unset when undefined), restoring
 * the previous value and the module's cached probe state afterwards so the
 * remaining discovery tests see the environment they started with.
 */
function withDiscoveryGpuEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = Deno.env.get(ENV_KEY);
  closeRustLibrary();
  try {
    if (value === undefined) {
      Deno.env.delete(ENV_KEY);
    } else {
      Deno.env.set(ENV_KEY, value);
    }
    return fn();
  } finally {
    if (previous === undefined) {
      Deno.env.delete(ENV_KEY);
    } else {
      Deno.env.set(ENV_KEY, previous);
    }
    closeRustLibrary();
  }
}

Deno.test({
  name: "NEAT_AI_DISCOVERY_GPU=off refuses the GPU without probing",
  sanitizeResources: false,
  sanitizeOps: false,
  fn() {
    withDiscoveryGpuEnv("off", () => {
      assertEquals(isRustGpuAvailable(), false);

      const info = getGpuBackendInfo();
      assertEquals(info.available, false);
      assertEquals(info.backendName, undefined, "no backend may be selected");
      assertStringIncludes(info.reason ?? "", ENV_KEY);
    });
  },
});

Deno.test({
  name: "NEAT_AI_DISCOVERY_GPU is matched case-insensitively and trimmed",
  sanitizeResources: false,
  sanitizeOps: false,
  fn() {
    withDiscoveryGpuEnv("  OFF  ", () => {
      assertEquals(isRustGpuAvailable(), false);
      assertStringIncludes(getGpuBackendInfo().reason ?? "", ENV_KEY);
    });
  },
});

Deno.test({
  name: "NEAT_AI_DISCOVERY_GPU=auto leaves the probe exactly as it was",
  sanitizeResources: false,
  sanitizeOps: false,
  fn() {
    const baseline = withDiscoveryGpuEnv(undefined, () => isRustGpuAvailable());

    for (const value of ["auto", "on", "", "nonsense"]) {
      const observed = withDiscoveryGpuEnv(value, () => isRustGpuAvailable());
      assertEquals(
        observed,
        baseline,
        `${ENV_KEY}="${value}" must not change GPU availability`,
      );
    }
  },
});

Deno.test({
  name: "the opt-out verdict does not leak into a later probe",
  sanitizeResources: false,
  sanitizeOps: false,
  fn() {
    const baseline = withDiscoveryGpuEnv(undefined, () => isRustGpuAvailable());

    withDiscoveryGpuEnv("off", () => {
      assertEquals(isRustGpuAvailable(), false);
    });

    const afterwards = withDiscoveryGpuEnv(undefined, () => {
      const available = isRustGpuAvailable();
      const info = getGpuBackendInfo();
      assert(
        !(info.reason ?? "").includes(ENV_KEY),
        `stale opt-out reason re-served: ${info.reason}`,
      );
      return available;
    });

    assertEquals(afterwards, baseline);
  },
});
