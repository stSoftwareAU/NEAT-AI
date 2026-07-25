import { assertEquals } from "@std/assert";
import {
  createNeatConfig,
  DEFAULT_HEAVY_TASK_WORKER_COUNT,
} from "@config/NeatConfig.ts";

/**
 * GRQ-22 16 GB heavily-loaded OOM regression guard. Asserts the memory-based
 * worker-thread cap (Issue #1569) reduces the 12 default threads to fit the
 * host-derived worker envelope on the exact GRQ-22 numbers the external
 * production runner exports, so a 16 GB host under load can never spawn one
 * heavy worker per default thread and OOM (exit 137).
 *
 * GRQ-22 host snapshot (16 GB total / 7840 MB available / 10 CPUs), and the
 * Discovery memory plan the external production runner computes from it:
 *   heap            3528 MB
 *   worker_envelope 1049 MB   → NEAT-AI workerThreadCap.maxMemoryMB
 *   per_worker_cap   256 MB   → NEAT-AI workerThreadCap.estimatedMemoryPerWorkerMB
 *
 * Default threads on GRQ-22 = 10 CPUs + DEFAULT_HEAVY_TASK_WORKER_COUNT(2) = 12.
 */

// Exact GRQ-22 plan values exported by the external production runner.
const GRQ22_CPUS = 10;
const GRQ22_DEFAULT_THREADS = GRQ22_CPUS + DEFAULT_HEAVY_TASK_WORKER_COUNT; // 12
const GRQ22_WORKER_ENVELOPE_MB = 1049;
const GRQ22_PER_WORKER_CAP_MB = 256;

Deno.test("GRQ-22 OOM cap: default heavy-task thread count is 12 on a 10-CPU host", () => {
  // Locks the 10 + 2 arithmetic the GRQ-22 fixture depends on.
  assertEquals(DEFAULT_HEAVY_TASK_WORKER_COUNT, 2);
  assertEquals(GRQ22_DEFAULT_THREADS, 12);
});

Deno.test("GRQ-22 OOM cap: worker cap reduces 12 threads to fit the envelope", () => {
  // Feed the runner-exported envelope + per-worker cap into the NEAT-AI
  // memory-based thread cap, starting from the 12 default threads.
  const config = createNeatConfig({
    threads: GRQ22_DEFAULT_THREADS,
    workerThreadCap: {
      maxMemoryMB: GRQ22_WORKER_ENVELOPE_MB,
      estimatedMemoryPerWorkerMB: GRQ22_PER_WORKER_CAP_MB,
    },
  });

  // floor(1049 / 256) = 4 — a genuine reduction from the 12 default threads.
  assertEquals(config.threads, 4);
  if (config.threads >= GRQ22_DEFAULT_THREADS) {
    throw new Error(
      `Expected the cap to reduce below ${GRQ22_DEFAULT_THREADS} threads, ` +
        `got ${config.threads}`,
    );
  }

  // The capped fleet must fit the envelope: threads × per-worker ≤ envelope.
  const fleetMb = config.threads * GRQ22_PER_WORKER_CAP_MB;
  if (fleetMb > GRQ22_WORKER_ENVELOPE_MB) {
    throw new Error(
      `Capped fleet ${fleetMb} MB exceeds envelope ${GRQ22_WORKER_ENVELOPE_MB} MB`,
    );
  }
});

Deno.test("GRQ-22 OOM cap: uncapped 12 threads would blow the envelope (the OOM this locks out)", () => {
  // The pre-fix failure mode: 12 workers, each sized at the ≥16 GB heap floor
  // (4096 MB), demanded 49152 MB on a host with only 7840 MB available.
  const HEAP_FLOOR_MB = 4096;
  const GRQ22_AVAILABLE_MB = 7840;
  const naiveFleetMb = GRQ22_DEFAULT_THREADS * HEAP_FLOOR_MB;
  if (naiveFleetMb <= GRQ22_AVAILABLE_MB) {
    throw new Error(
      `Expected the uncapped fleet (${naiveFleetMb} MB) to exceed available ` +
        `${GRQ22_AVAILABLE_MB} MB — fixture no longer reproduces the OOM`,
    );
  }
  // With the cap the effective fleet is well within available.
  const config = createNeatConfig({
    threads: GRQ22_DEFAULT_THREADS,
    workerThreadCap: {
      maxMemoryMB: GRQ22_WORKER_ENVELOPE_MB,
      estimatedMemoryPerWorkerMB: GRQ22_PER_WORKER_CAP_MB,
    },
  });
  const cappedFleetMb = config.threads * GRQ22_PER_WORKER_CAP_MB;
  if (cappedFleetMb > GRQ22_AVAILABLE_MB) {
    throw new Error(
      `Capped fleet ${cappedFleetMb} MB must fit available ${GRQ22_AVAILABLE_MB} MB`,
    );
  }
});
