/**
 * Discovery worker-memory envelope → `workerThreadCap` wiring
 * (stSoftwareAU/GRQ#3295, part of GRQ#3267 — Discovery OOM-killed on a 16 GB host).
 *
 * ## Why this exists
 *
 * The default thread count is `hardwareConcurrency + DEFAULT_HEAVY_TASK_WORKER_COUNT`
 * (e.g. `10 + 2 = 12` on GRQ-22). Every spawned Deno worker isolate inherits the
 * **process-level** `--max-old-space-size` (see {@link ./../workers/WorkerHeapBudget.ts}),
 * so on a 16 GB host all 12 isolates carry the same 4096 MB budget — an aggregate
 * ~48 GB potential worker heap with no accounting that
 * `threads × per_worker ≤ host RAM`. The #1569 memory cap
 * ({@link ./WorkerThreadCapConfig.ts}) that would bound this is opt-in and disabled
 * by default (`maxMemoryMB = 0`), and Discovery never set it — so no cap was applied
 * and the process was OOM-killed.
 *
 * ## The fix
 *
 * The external Discovery runner (`worker/Discovery/run.sh`, in the GRQ repo)
 * carves a host-derived worker-memory envelope and exports it via env. This module
 * reads that envelope and turns it into `workerThreadCap` overrides **automatically**
 * — no per-caller opt-in — so `createNeatConfig` caps the effective thread count to
 * `floor(envelope / per_worker_budget)`, guaranteeing `threads × per_worker ≤ envelope`.
 *
 * The contract is intentionally split across the process boundary, mirroring
 * {@link ./../workers/WorkerHeapBudget.ts}:
 *   - `DISCOVERY_WORKER_ENVELOPE_MB` — aggregate worker-isolate memory envelope (MB).
 *     Maps to `workerThreadCap.maxMemoryMB`. Presence of a positive value here is
 *     what activates the cap.
 *   - `DISCOVERY_HEAP_SIZE_MB` — the **actual** per-worker V8 old-space budget: the
 *     process `--max-old-space-size` every worker isolate inherits. Maps to
 *     `workerThreadCap.estimatedMemoryPerWorkerMB` so the cap reflects the real
 *     per-isolate footprint (4096 on GRQ-22), not the static 2048 MB guess.
 *   - `DISCOVERY_PER_WORKER_HEAP_CAP_MB` — fallback per-worker cap, used only when
 *     `DISCOVERY_HEAP_SIZE_MB` is unset.
 *
 * When `DISCOVERY_WORKER_ENVELOPE_MB` is unset (every non-Discovery caller),
 * {@link resolveDiscoveryWorkerThreadCap} returns `undefined` and behaviour is
 * unchanged: the cap stays disabled.
 *
 * @module
 */

import {
  DISCOVERY_HEAP_SIZE_ENV,
  type EnvReader,
} from "@workers/WorkerHeapBudget.ts";

export type { EnvReader };

/**
 * Environment variable the Discovery runner sets to the aggregate worker-isolate
 * memory envelope (MB). A positive value here activates the automatic cap.
 */
export const DISCOVERY_WORKER_ENVELOPE_ENV = "DISCOVERY_WORKER_ENVELOPE_MB";

/**
 * Environment variable the Discovery runner sets to the derived per-worker V8
 * heap cap (MB). Used as the per-worker estimate only when
 * {@link DISCOVERY_HEAP_SIZE_ENV} is unset.
 */
export const DISCOVERY_PER_WORKER_HEAP_CAP_ENV =
  "DISCOVERY_PER_WORKER_HEAP_CAP_MB";

/**
 * `workerThreadCap` overrides derived from the Discovery memory envelope.
 *
 * `estimatedMemoryPerWorkerMB` is optional: when neither the actual per-worker V8
 * budget nor the exported per-worker cap is available, it is left unset so the
 * parser applies its static default.
 */
export interface DiscoveryWorkerThreadCapOverrides {
  /** Aggregate worker-memory envelope (MB) → `workerThreadCap.maxMemoryMB`. */
  maxMemoryMB: number;
  /** Actual per-worker V8 budget (MB) → `workerThreadCap.estimatedMemoryPerWorkerMB`. */
  estimatedMemoryPerWorkerMB?: number;
}

/**
 * Read a positive-integer megabyte value from the environment.
 *
 * Returns `undefined` when the variable is unset, empty, non-numeric,
 * non-integer, or not strictly positive — so a malformed or zero value can never
 * activate or distort the cap. Wrapped in `try/catch` so a missing `--allow-env`
 * permission is treated as unconfigured rather than throwing.
 */
function readPositiveIntMb(env: EnvReader, key: string): number | undefined {
  let raw: string | undefined;
  try {
    raw = env.get(key) ?? undefined;
  } catch {
    // No --allow-env (or reader threw): treat as unconfigured.
    return undefined;
  }
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return undefined;
  }
  return n;
}

/**
 * Resolve automatic `workerThreadCap` overrides from the Discovery memory
 * envelope exported by `worker/Discovery/run.sh`.
 *
 * Returns `undefined` unless {@link DISCOVERY_WORKER_ENVELOPE_ENV} holds a
 * positive integer — so non-Discovery callers (env unset) keep the cap disabled
 * and their behaviour unchanged. When active, `maxMemoryMB` is the envelope and
 * `estimatedMemoryPerWorkerMB` is the actual per-worker V8 budget
 * ({@link DISCOVERY_HEAP_SIZE_ENV}, the process `--max-old-space-size` every
 * isolate inherits), falling back to the exported per-worker cap
 * ({@link DISCOVERY_PER_WORKER_HEAP_CAP_ENV}).
 *
 * @param env - Environment reader (defaults to `Deno.env`).
 */
export function resolveDiscoveryWorkerThreadCap(
  env: EnvReader = Deno.env,
): DiscoveryWorkerThreadCapOverrides | undefined {
  const envelope = readPositiveIntMb(env, DISCOVERY_WORKER_ENVELOPE_ENV);
  if (envelope === undefined) return undefined;

  // The real per-isolate footprint is the process V8 budget every worker
  // inherits (DISCOVERY_HEAP_SIZE_MB); the derived per-worker cap is only a
  // fallback when the process budget is not exported.
  const perWorker = readPositiveIntMb(env, DISCOVERY_HEAP_SIZE_ENV) ??
    readPositiveIntMb(env, DISCOVERY_PER_WORKER_HEAP_CAP_ENV);

  return perWorker === undefined
    ? { maxMemoryMB: envelope }
    : { maxMemoryMB: envelope, estimatedMemoryPerWorkerMB: perWorker };
}

/**
 * Merge Discovery-envelope-derived `workerThreadCap` defaults under any explicit
 * user overrides. Explicit user values always win; the envelope only fills fields
 * the user did not supply. Returns the user overrides unchanged when no envelope
 * is active (so the parser's static defaults apply).
 *
 * @param userOverrides - Raw `workerThreadCap` overrides from user options.
 * @param envelope - Envelope-derived overrides, or `undefined` when inactive.
 */
export function mergeDiscoveryWorkerThreadCapDefaults(
  userOverrides: Record<string, unknown> | undefined,
  envelope: DiscoveryWorkerThreadCapOverrides | undefined,
): Record<string, unknown> | undefined {
  if (envelope === undefined) return userOverrides;

  const merged: Record<string, unknown> = { maxMemoryMB: envelope.maxMemoryMB };
  if (envelope.estimatedMemoryPerWorkerMB !== undefined) {
    merged.estimatedMemoryPerWorkerMB = envelope.estimatedMemoryPerWorkerMB;
  }
  if (userOverrides) {
    for (const [key, value] of Object.entries(userOverrides)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged;
}
