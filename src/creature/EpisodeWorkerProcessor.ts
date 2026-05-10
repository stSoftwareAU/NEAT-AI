/**
 * EpisodeWorkerProcessor.ts — Worker-side processor for the episode-rollout
 * pool used by `Creature.evolveRL()` (Issue #2612).
 *
 * Lifecycle:
 *
 * 1. `initialize` — the worker dynamically imports the adapter URL,
 *    resolves a class-shaped export, and instantiates it with the provided
 *    config. The adapter is then frozen on the processor for the rest of
 *    the worker's lifetime.
 * 2. `runEpisodes` — the main thread sends a creature export plus the seed
 *    set for that creature; the worker rebuilds the creature, runs every
 *    episode through the library-owned {@link runEpisode} runner, and
 *    returns the per-trial outcomes.
 *
 * The processor is import-cycle-free with the rest of the RL stack: it
 * pulls `Creature.fromJSON` and `runEpisode` lazily on first request so
 * the worker module loads quickly even when the user adapter URL has not
 * yet been fetched.
 */

import type {
  AdapterDescription,
  EpisodeInitResponse,
  EpisodeOutcome,
  EpisodeRequest,
  EpisodeResponse,
  EpisodeRunResponse,
} from "@creature/EpisodeWorkerProtocol.ts";
import type { EpisodeAdapter } from "@creature/EpisodeAdapter.ts";
import { Creature } from "@creature";
import { runEpisode } from "@creature/EpisodeRunner.ts";
import { initialiseWasmActivationFromPayload } from "@workers/WasmWorkerInit.ts";
import type { WasmActivationInitPayload } from "@workers/WasmActivationPayload.ts";

/**
 * Resolve a class-shaped export from a dynamically-imported module.
 *
 * Mirrors the `default → Adapter → first export` convention used by
 * {@link WorkerProcessor.loadCustomCostFromFile} so adapter authors can pick
 * whichever export shape is most convenient. Throws when no constructable
 * value can be found, so misconfigured URLs fail loudly at worker init time.
 */
// deno-lint-ignore no-explicit-any
type AdapterCtor = new (config?: unknown) => EpisodeAdapter<any, any>;

function resolveAdapterClass(
  // deno-lint-ignore no-explicit-any
  module: Record<string, any>,
  exportName?: string,
): AdapterCtor {
  if (exportName) {
    const candidate = module[exportName];
    if (typeof candidate !== "function") {
      throw new Error(
        `Adapter export "${exportName}" is not a constructor (got ${typeof candidate})`,
      );
    }
    return candidate as AdapterCtor;
  }
  if (typeof module.default === "function") {
    return module.default as AdapterCtor;
  }
  if (typeof module.Adapter === "function") {
    return module.Adapter as AdapterCtor;
  }
  for (const value of Object.values(module)) {
    if (typeof value === "function") {
      return value as AdapterCtor;
    }
  }
  throw new Error(
    "No constructor-shaped export found on adapter module; expected `default`, `Adapter`, or any class export",
  );
}

/**
 * Worker-side processor. One instance per worker; persists across all
 * `runEpisodes` calls so the adapter is loaded exactly once.
 */
export class EpisodeWorkerProcessor {
  // deno-lint-ignore no-explicit-any
  private adapter: EpisodeAdapter<any, any> | null = null;
  /** Whether the worker has attempted WASM init at least once. */
  private wasmInitAttempted = false;

  /** Top-level dispatch — called once per `postMessage`. */
  async process(data: EpisodeRequest): Promise<EpisodeResponse> {
    const start = Date.now();
    if ("initialize" in data) {
      return await this.handleInit(
        data.taskID,
        data.initialize.adapter,
        data.initialize.wasmActivation,
        start,
      );
    }
    if ("runEpisodes" in data) {
      return await this.handleRunEpisodes(
        data.taskID,
        data.runEpisodes.creature,
        data.runEpisodes.seedSet,
        start,
      );
    }
    throw new Error("EpisodeWorkerProcessor: unknown request shape");
  }

  private async handleInit(
    taskID: number,
    description: AdapterDescription,
    wasmPayload: WasmActivationInitPayload | undefined,
    start: number,
  ): Promise<EpisodeInitResponse> {
    try {
      // Initialise WASM activation in the worker so `creature.activate()`
      // calls inside `runEpisode()` find a loaded module. Mirrors the
      // dataset worker bootstrap.
      if (!this.wasmInitAttempted) {
        this.wasmInitAttempted = true;
        await initialiseWasmActivationFromPayload(wasmPayload, true);
      }
      // Dynamic import of user-provided adapter file. Same pattern as
      // `WorkerProcessor.loadCustomCostFromFile`. JSR Warning: this dynamic
      // import is intentional and loads external user files at runtime; the
      // import path cannot be analysed at publish time.
      const module = await import(description.url);
      const Ctor = resolveAdapterClass(module, description.exportName);
      this.adapter = new Ctor(description.config);
      // Validate eagerly so a misbehaving adapter fails at init, not on the
      // first creature.
      this.adapter.assertContract(0);
      return {
        taskID,
        duration: Date.now() - start,
        initialize: { status: "OK" },
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        taskID,
        duration: Date.now() - start,
        initialize: { status: "ERROR", error: err.message },
      };
    }
  }

  private async handleRunEpisodes(
    taskID: number,
    creatureExport: unknown,
    seedSet: readonly number[],
    start: number,
  ): Promise<EpisodeRunResponse> {
    if (!this.adapter) {
      throw new Error(
        "EpisodeWorkerProcessor.runEpisodes called before successful initialize",
      );
    }

    // deno-lint-ignore no-explicit-any
    const creature = Creature.fromJSON(creatureExport as any);
    const outcomes: EpisodeOutcome[] = new Array(seedSet.length);
    try {
      for (let i = 0; i < seedSet.length; i++) {
        // Episodes within a creature run serially: the next observation
        // depends on the creature's prior action so they cannot be
        // parallelised inside a single creature.
        // deno-lint-ignore no-await-in-loop
        const result = await runEpisode(this.adapter, creature, seedSet[i]);
        outcomes[i] = {
          reward: result.returnValue,
          terminated: result.terminated,
          truncated: result.truncated,
          steps: result.steps,
          seed: result.seed,
        };
      }
    } finally {
      // Drop the worker-side creature so V8 can GC it before the next request.
      try {
        creature.dispose?.();
      } catch {
        // Disposal failures must not corrupt rollout results.
      }
    }

    return {
      taskID,
      duration: Date.now() - start,
      runEpisodes: { outcomes },
    };
  }
}
