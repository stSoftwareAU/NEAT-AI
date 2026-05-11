/**
 * EpisodeWorkerPool.ts — Lightweight worker pool that schedules per-creature
 * episode rollouts across a fixed-size set of {@link EpisodeWorkerHandler}
 * instances (Issue #2612).
 *
 * Why a dedicated pool instead of reusing {@link WorkerHandler}? The dataset
 * fitness pool is tied to a `dataSetDir`, a `costName`, and a WASM-cache
 * configuration that have no analogue in the RL rollout path. Mixing the
 * two would force every fitness phase to ship adapter URLs through fields
 * the worker does not need. The episode pool is intentionally minimal: an
 * `init` message carrying the adapter description plus per-creature
 * `runEpisodes` requests.
 *
 * Scheduling: the pool keeps a queue of pending creatures and a free list
 * of idle workers. Each free worker pulls the next creature, runs every
 * episode in its seed set serially (per-creature isolation, see #2625),
 * and on completion either picks up another pending creature or rejoins
 * the free list. With `threads = N` and `population = P`, every generation
 * achieves up to `min(N, P)`-way parallelism.
 *
 * Determinism: the seed set is computed on the main thread and passed
 * intact to whichever worker happens to be free. Because the per-trial
 * reward is purely a function of `(adapter, creature, seed)`, the
 * outcomes do not depend on which worker serves them — the assignment
 * order only affects wall-clock time, never numerical results.
 *
 * Failure mode: if any worker's init fails, the pool warns and degrades
 * to inline execution for that slot via {@link MockEpisodeWorker}. This
 * mirrors the `evolveDir()` fallback at `CreatureTraining.ts:387`.
 */

import type { Creature } from "@creature";
import { getLogger } from "@utils/Logger.ts";
import { EpisodeWorkerHandler } from "@creature/EpisodeWorkerHandler.ts";
import type {
  AdapterDescription,
  EpisodeOutcome,
} from "@creature/EpisodeWorkerProtocol.ts";
import { loadWasmActivationInitPayloadAsync } from "@workers/WasmActivationPayload.ts";
import { isWasmActivationAvailable } from "@wasm/mod.ts";

/**
 * One scheduled creature waiting for a free worker.
 */
interface PendingTask {
  readonly creature: Creature;
  readonly seedSet: readonly number[];
  readonly resolve: (outcomes: readonly EpisodeOutcome[]) => void;
  readonly reject: (err: Error) => void;
  /** Timestamp (ms since epoch) when the task was queued. */
  readonly queuedAt: number;
}

/**
 * Constructor options for {@link EpisodeWorkerPool}.
 */
export interface EpisodeWorkerPoolOptions {
  /** Adapter description shared by every worker in the pool. */
  readonly adapter: AdapterDescription;
  /** Pool size. Clamped to `>= 1`. */
  readonly threads: number;
  /**
   * When `true`, every worker uses {@link MockEpisodeWorker} (in-process
   * execution). Default `false`. Used for tests and as the worker-init
   * failure fallback.
   */
  readonly direct?: boolean;
}

/**
 * Round-robin episode-rollout pool. Construct once per `evolveRL()` call
 * and {@link terminate} when the run ends.
 */
export class EpisodeWorkerPool {
  private readonly handlers: EpisodeWorkerHandler[] = [];
  private readonly idle: EpisodeWorkerHandler[] = [];
  private readonly pending: PendingTask[] = [];
  private terminated = false;
  /** Cumulative wall-clock spent waiting for a free worker (ms). */
  private waitMs = 0;

  /**
   * Build the pool and wait for every worker to finish init. Workers that
   * fail to initialise are replaced with in-process fallbacks so the pool
   * always returns at `threads` slots.
   */
  static async create(
    options: EpisodeWorkerPoolOptions,
  ): Promise<EpisodeWorkerPool> {
    const pool = new EpisodeWorkerPool();
    const threads = Math.max(1, Math.floor(options.threads));
    const direct = options.direct === true;

    // Load the WASM activation payload once and share it across every
    // worker. Failure is non-fatal in `direct` mode (the main thread's
    // module is reused) but mandatory for real workers since they have
    // their own JS realm.
    let wasmPayload:
      | import("@workers/WasmActivationPayload.ts").WasmActivationInitPayload
      | undefined;
    try {
      wasmPayload = await loadWasmActivationInitPayloadAsync();
    } catch (wasmErr) {
      if (direct && isWasmActivationAvailable()) {
        getLogger().warn(
          "[EpisodeWorkerPool] WASM payload load failed; reusing main-thread module for direct workers.",
        );
      } else {
        throw wasmErr;
      }
    }

    for (let i = 0; i < threads; i++) {
      // Build each worker, preferring real workers unless `direct` is set.
      // On init failure for a real worker, fall back to a Mock so the slot
      // still scores creatures rather than wedging the run.
      let handler = new EpisodeWorkerHandler(
        options.adapter,
        direct,
        wasmPayload,
      );
      try {
        // deno-lint-ignore no-await-in-loop
        await handler.waitUntilReady();
      } catch (err) {
        try {
          handler.terminate();
        } catch {
          // Termination of an already-broken worker is best-effort.
        }
        if (!direct) {
          getLogger().warn(
            "[EpisodeWorkerPool] Worker init failed; falling back to direct execution for this slot.",
            err,
          );
          handler = new EpisodeWorkerHandler(
            options.adapter,
            true,
            wasmPayload,
          );
          // deno-lint-ignore no-await-in-loop
          await handler.waitUntilReady();
        } else {
          throw err;
        }
      }
      pool.handlers.push(handler);
      pool.idle.push(handler);
    }
    return pool;
  }

  /**
   * Number of workers in the pool (always equal to the configured
   * `threads`, regardless of how many fell back to direct execution).
   */
  get size(): number {
    return this.handlers.length;
  }

  /**
   * Schedule a creature for rollout. Returns a promise that resolves with
   * the per-trial outcome vector when every seed in `seedSet` has run.
   */
  runEpisodes(
    creature: Creature,
    seedSet: readonly number[],
  ): Promise<readonly EpisodeOutcome[]> {
    if (this.terminated) {
      return Promise.reject(
        new Error("EpisodeWorkerPool.runEpisodes called after terminate()"),
      );
    }
    return new Promise<readonly EpisodeOutcome[]>((resolve, reject) => {
      this.pending.push({
        creature,
        seedSet,
        resolve,
        reject,
        queuedAt: Date.now(),
      });
      this.dispatch();
    });
  }

  /** Cumulative milliseconds spent waiting for a free worker. */
  getQueueWaitMs(): number {
    return this.waitMs;
  }

  /**
   * Sum of `getCumulativeBusyMs()` across every handler in the pool.
   * Mirrors {@link WorkerPool.getTotalBusyMs} so the throughput counters
   * emitted on `generation_complete` look identical to the dataset path.
   */
  getTotalBusyMs(): number {
    let total = 0;
    for (const h of this.handlers) total += h.getCumulativeBusyMs();
    return total;
  }

  /** Terminate every worker. Safe to call multiple times. */
  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    for (const handler of this.handlers) {
      try {
        handler.terminate();
      } catch {
        // Best-effort; do not let a misbehaving worker crash the run.
      }
    }
    this.handlers.length = 0;
    this.idle.length = 0;
    // Reject any tasks still queued — the pool is shutting down.
    for (const task of this.pending) {
      task.reject(new Error("EpisodeWorkerPool terminated before completion"));
    }
    this.pending.length = 0;
  }

  /** Drain the pending queue while idle workers exist. */
  private dispatch(): void {
    while (this.pending.length > 0 && this.idle.length > 0) {
      const handler = this.idle.shift()!;
      const task = this.pending.shift()!;
      // Account for queue wait: time the task spent sitting in the
      // pending queue before a worker picked it up.
      this.waitMs += Math.max(0, Date.now() - task.queuedAt);
      handler.runEpisodes(task.creature, task.seedSet).then((outcomes) => {
        task.resolve(outcomes);
      }, (err) => {
        task.reject(err instanceof Error ? err : new Error(String(err)));
      }).finally(() => {
        this.idle.push(handler);
        this.dispatch();
      });
    }
  }
}
