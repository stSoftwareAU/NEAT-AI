/**
 * Tests for the Discovery worker-memory envelope → workerThreadCap resolver
 * that guards against the Discovery-worker OOM on a 16 GB production host.
 *
 * These exercise the pure env → overrides mapping with an injected reader, so
 * they are hermetic and never touch the real process environment.
 */
import { assertEquals } from "@std/assert";
import {
  DISCOVERY_PER_WORKER_HEAP_CAP_ENV,
  DISCOVERY_WORKER_ENVELOPE_ENV,
  mergeDiscoveryWorkerThreadCapDefaults,
  resolveDiscoveryWorkerThreadCap,
} from "@config/DiscoveryWorkerEnvelope.ts";
import { DISCOVERY_HEAP_SIZE_ENV } from "@workers/WorkerHeapBudget.ts";

/** Build an env getter from a plain record for hermetic tests. */
function envFrom(
  map: Record<string, string>,
): { get(key: string): string | undefined } {
  return { get: (k) => (k in map ? map[k] : undefined) };
}

Deno.test("resolveDiscoveryWorkerThreadCap: undefined when envelope env unset", () => {
  assertEquals(resolveDiscoveryWorkerThreadCap(envFrom({})), undefined);
  // Per-worker present but no envelope → still inactive.
  assertEquals(
    resolveDiscoveryWorkerThreadCap(
      envFrom({ [DISCOVERY_HEAP_SIZE_ENV]: "4096" }),
    ),
    undefined,
  );
});

Deno.test("resolveDiscoveryWorkerThreadCap: maps envelope + heap when planner cap unset", () => {
  const overrides = resolveDiscoveryWorkerThreadCap(
    envFrom({
      [DISCOVERY_WORKER_ENVELOPE_ENV]: "7840",
      [DISCOVERY_HEAP_SIZE_ENV]: "4096",
    }),
  );
  assertEquals(overrides, {
    maxMemoryMB: 7840,
    estimatedMemoryPerWorkerMB: 4096,
  });
});

Deno.test("resolveDiscoveryWorkerThreadCap: planner per-worker cap wins over process heap (GRQ #4069)", () => {
  const overrides = resolveDiscoveryWorkerThreadCap(
    envFrom({
      [DISCOVERY_WORKER_ENVELOPE_ENV]: "2669",
      [DISCOVERY_HEAP_SIZE_ENV]: "4096",
      [DISCOVERY_PER_WORKER_HEAP_CAP_ENV]: "266",
    }),
  );
  // Packing density, not the V8 spike ceiling — otherwise the pool collapses to 1.
  assertEquals(overrides?.estimatedMemoryPerWorkerMB, 266);
  assertEquals(overrides?.maxMemoryMB, 2669);
});

Deno.test("resolveDiscoveryWorkerThreadCap: falls back to heap when planner cap unset", () => {
  const overrides = resolveDiscoveryWorkerThreadCap(
    envFrom({
      [DISCOVERY_WORKER_ENVELOPE_ENV]: "6000",
      [DISCOVERY_HEAP_SIZE_ENV]: "4096",
    }),
  );
  assertEquals(overrides, {
    maxMemoryMB: 6000,
    estimatedMemoryPerWorkerMB: 4096,
  });
});

Deno.test("resolveDiscoveryWorkerThreadCap: uses exported per-worker cap when heap unset", () => {
  const overrides = resolveDiscoveryWorkerThreadCap(
    envFrom({
      [DISCOVERY_WORKER_ENVELOPE_ENV]: "6000",
      [DISCOVERY_PER_WORKER_HEAP_CAP_ENV]: "2048",
    }),
  );
  assertEquals(overrides, {
    maxMemoryMB: 6000,
    estimatedMemoryPerWorkerMB: 2048,
  });
});

Deno.test("resolveDiscoveryWorkerThreadCap: no per-worker source leaves estimate unset", () => {
  const overrides = resolveDiscoveryWorkerThreadCap(
    envFrom({ [DISCOVERY_WORKER_ENVELOPE_ENV]: "6000" }),
  );
  assertEquals(overrides, { maxMemoryMB: 6000 });
});

Deno.test("resolveDiscoveryWorkerThreadCap: rejects zero / non-integer / non-numeric envelope", () => {
  for (const bad of ["0", "-1", "1.5", "abc", "", "  "]) {
    assertEquals(
      resolveDiscoveryWorkerThreadCap(
        envFrom({ [DISCOVERY_WORKER_ENVELOPE_ENV]: bad }),
      ),
      undefined,
      `envelope '${bad}' must not activate the cap`,
    );
  }
});

Deno.test("resolveDiscoveryWorkerThreadCap: unconfigured when env reader throws (no --allow-env)", () => {
  const throwing = {
    get() {
      throw new Error("NotCapable: env access denied");
    },
  };
  assertEquals(resolveDiscoveryWorkerThreadCap(throwing), undefined);
});

Deno.test("mergeDiscoveryWorkerThreadCapDefaults: returns user overrides unchanged when no envelope", () => {
  const user = { maxMemoryMB: 1234 };
  assertEquals(
    mergeDiscoveryWorkerThreadCapDefaults(user, undefined),
    user,
  );
  assertEquals(
    mergeDiscoveryWorkerThreadCapDefaults(undefined, undefined),
    undefined,
  );
});

Deno.test("mergeDiscoveryWorkerThreadCapDefaults: envelope fills gaps, user wins on conflict", () => {
  const merged = mergeDiscoveryWorkerThreadCapDefaults(
    { maxMemoryMB: 999 },
    { maxMemoryMB: 7840, estimatedMemoryPerWorkerMB: 266 },
  );
  // Explicit user maxMemoryMB wins; envelope supplies the per-worker estimate.
  assertEquals(merged, { maxMemoryMB: 999, estimatedMemoryPerWorkerMB: 266 });
});
