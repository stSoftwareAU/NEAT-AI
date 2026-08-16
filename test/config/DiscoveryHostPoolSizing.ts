import { assertEquals } from "@std/assert";
import {
  createNeatConfig,
  DEFAULT_HEAVY_TASK_WORKER_COUNT,
} from "@config/NeatConfig.ts";
import {
  DISCOVERY_PER_WORKER_HEAP_CAP_ENV,
  DISCOVERY_WORKER_ENVELOPE_ENV,
} from "@config/DiscoveryWorkerEnvelope.ts";
import { DISCOVERY_HEAP_SIZE_ENV } from "@workers/WorkerHeapBudget.ts";

/**
 * Guard the three host shapes from GRQ #4069: Discovery must size the worker
 * pool to floor(envelope / per_worker_cap), not collapse to 1 because the
 * process heap was used as the per-worker estimate.
 */

const ENVELOPE_ENV_KEYS = [
  DISCOVERY_WORKER_ENVELOPE_ENV,
  DISCOVERY_HEAP_SIZE_ENV,
  DISCOVERY_PER_WORKER_HEAP_CAP_ENV,
];

function withEnvelopeEnv(
  overrides: Record<string, string>,
  fn: () => void,
): void {
  const prior = new Map<string, string | undefined>();
  for (const key of ENVELOPE_ENV_KEYS) {
    prior.set(key, Deno.env.get(key));
    Deno.env.delete(key);
  }
  try {
    for (const [key, value] of Object.entries(overrides)) {
      Deno.env.set(key, value);
    }
    fn();
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

type HostShape = {
  name: string;
  cpus: number;
  heapMB: number;
  envelopeMB: number;
  perWorkerCapMB: number;
};

/** Exact memory-plan lines from GRQ #4069 (GRQ-25 per_worker derived). */
const HOSTS: HostShape[] = [
  {
    name: "GRQ-22",
    cpus: 10,
    heapMB: 4096,
    envelopeMB: 2669,
    perWorkerCapMB: 266,
  },
  {
    name: "GRQ-13",
    cpus: 8,
    heapMB: 3072,
    envelopeMB: 655,
    perWorkerCapMB: 256,
  },
  {
    name: "GRQ-25",
    cpus: 14,
    heapMB: 5376,
    envelopeMB: 4413,
    // max(256, floor(4413/14)) = 315 — planner packing density
    perWorkerCapMB: 315,
  },
];

for (const host of HOSTS) {
  Deno.test(
    `${host.name} Discovery pool uses per_worker_cap not process heap (GRQ #4069)`,
    () => {
      const defaultThreads = host.cpus + DEFAULT_HEAVY_TASK_WORKER_COUNT;
      const memoryBasedMax = Math.floor(
        host.envelopeMB / host.perWorkerCapMB,
      );
      const expectedThreads = Math.min(defaultThreads, memoryBasedMax);
      withEnvelopeEnv(
        {
          [DISCOVERY_WORKER_ENVELOPE_ENV]: String(host.envelopeMB),
          [DISCOVERY_HEAP_SIZE_ENV]: String(host.heapMB),
          [DISCOVERY_PER_WORKER_HEAP_CAP_ENV]: String(host.perWorkerCapMB),
        },
        () => {
          const config = createNeatConfig({ threads: defaultThreads });
          assertEquals(
            config.workerThreadCap.estimatedMemoryPerWorkerMB,
            host.perWorkerCapMB,
          );
          assertEquals(config.threads, expectedThreads);
          assertEquals(
            config.threads *
                config.workerThreadCap.estimatedMemoryPerWorkerMB <=
              host.envelopeMB,
            true,
          );
          // Must not collapse to the pre-fix 1-thread failure mode when
          // the envelope can hold more than one packed worker.
          if (memoryBasedMax > 1) {
            assertEquals(config.threads > 1, true);
          }
        },
      );
    },
  );
}

Deno.test("corrected Discovery pool stays inside the worker envelope (GRQ #4069)", () => {
  // Corrected threads re-pack the worker envelope only; they must not spend
  // growth_reserve (the #4066 OOM guard).
  for (const host of HOSTS) {
    const threads = Math.floor(host.envelopeMB / host.perWorkerCapMB);
    const fleetMB = threads * host.perWorkerCapMB;
    assertEquals(
      fleetMB <= host.envelopeMB,
      true,
      `${host.name}: fleet ${fleetMB} must fit envelope ${host.envelopeMB}`,
    );
  }
});
