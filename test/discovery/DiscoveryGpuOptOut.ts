/**
 * `NEAT_AI_DISCOVERY_GPU` — the operator opt-out for the discovery GPU probe.
 *
 * GRQ Issue #4405: hosts that are deliberately CPU-only were still probing
 * Vulkan. On one host the driver lost the device mid-run and killed a 1075 s
 * evolve stage. Discovery had no off-switch at all, so this covers the new one:
 * `off` must refuse the GPU without probing, `auto` must keep the old
 * behaviour, and a typo must fail loudly rather than quietly probing anyway.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  DISCOVERY_GPU_ENV,
  getGpuBackendInfo,
  isRustGpuAvailable,
  resolveDiscoveryGpuMode,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { DiscoveryError } from "@errors/DiscoveryError.ts";

/** Run `fn` with `NEAT_AI_DISCOVERY_GPU` pinned, restoring it afterwards. */
function withGpuEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = Deno.env.get(DISCOVERY_GPU_ENV);
  if (value === undefined) {
    Deno.env.delete(DISCOVERY_GPU_ENV);
  } else {
    Deno.env.set(DISCOVERY_GPU_ENV, value);
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      Deno.env.delete(DISCOVERY_GPU_ENV);
    } else {
      Deno.env.set(DISCOVERY_GPU_ENV, previous);
    }
  }
}

Deno.test("resolveDiscoveryGpuMode — unset, empty and blank all mean auto", () => {
  assertEquals(resolveDiscoveryGpuMode(undefined), "auto");
  assertEquals(resolveDiscoveryGpuMode(""), "auto");
  assertEquals(resolveDiscoveryGpuMode("   "), "auto");
});

Deno.test("resolveDiscoveryGpuMode — off and auto are accepted in any case", () => {
  assertEquals(resolveDiscoveryGpuMode("off"), "off");
  assertEquals(resolveDiscoveryGpuMode("OFF"), "off");
  assertEquals(resolveDiscoveryGpuMode(" Off "), "off");
  assertEquals(resolveDiscoveryGpuMode("auto"), "auto");
  assertEquals(resolveDiscoveryGpuMode("AUTO"), "auto");
});

Deno.test("resolveDiscoveryGpuMode — an unrecognised value fails loud", () => {
  for (const bad of ["of", "on", "0", "false", "disabled"]) {
    const error = assertThrows(
      () => resolveDiscoveryGpuMode(bad),
      DiscoveryError,
    ) as DiscoveryError;
    assertEquals(error.reason, "GPU_UNAVAILABLE");
    assert(
      error.message.includes(DISCOVERY_GPU_ENV),
      `message should name ${DISCOVERY_GPU_ENV}: ${error.message}`,
    );
  }
});

Deno.test("isRustGpuAvailable — NEAT_AI_DISCOVERY_GPU=off refuses the GPU", () => {
  const available = withGpuEnv("off", () => isRustGpuAvailable());
  assertEquals(
    available,
    false,
    "an explicit opt-out must report no GPU on every host",
  );
});

Deno.test("getGpuBackendInfo — the opt-out reason is reported, not a load failure", () => {
  const info = withGpuEnv("off", () => getGpuBackendInfo());
  assertEquals(info.available, false);
  assertEquals(info.reason, `${DISCOVERY_GPU_ENV}=off`);
});

Deno.test("isRustGpuAvailable — a bad NEAT_AI_DISCOVERY_GPU value is not silently ignored", () => {
  withGpuEnv("yes-please", () => {
    assertThrows(() => isRustGpuAvailable(), DiscoveryError);
  });
});
