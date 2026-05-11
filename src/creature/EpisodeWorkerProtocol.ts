/**
 * EpisodeWorkerProtocol.ts — Wire types for the parallel episode-rollout
 * worker pool used by `Creature.evolveRL()` (Issue #2612).
 *
 * The main thread ships an {@link AdapterDescription} (an importable URL plus
 * a JSON-serialisable config) to each worker on init. From that the worker
 * dynamically imports the adapter class, instantiates it with `config`, and
 * holds it for the lifetime of the worker. Subsequent `runEpisodes` requests
 * carry a creature genome and the seed set for that creature; the worker
 * runs every episode through the library-owned {@link runEpisode} runner and
 * returns the per-trial reward vector to the main thread.
 *
 * Determinism: the per-trial seeds are computed on the main thread (see
 * `EvolveRLSeedSet.ts`) and shipped intact, so changing the worker count
 * does not perturb the seed sequence. The mean and any reward → error
 * mapping happen on the main thread for a single source of truth.
 *
 * Wire safety: every field below is a primitive, plain object, or
 * `CreatureExport` (already structured-clone-safe), so the pool works with
 * either real `Worker` instances or `MockWorker`-style direct execution.
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type {
  BaseRequestData,
  BaseResponseData,
} from "@workers/WorkerInterface.ts";

/**
 * Pointer to the adapter class plus the JSON config it needs to be
 * constructed. The worker dynamically imports `url` and instantiates a
 * subclass of {@link EpisodeAdapter} from one of three export shapes — see
 * {@link EpisodeWorkerProcessor.loadAdapter}.
 *
 * `config` is sent to the worker via structured clone; keep it
 * JSON-serialisable so the workers stay portable across Deno/Worker variants.
 */
export interface AdapterDescription {
  /** Importable URL of the module that exports the adapter class. */
  readonly url: string;
  /** Optional JSON-serialisable config forwarded to the adapter constructor. */
  readonly config?: unknown;
  /**
   * Optional explicit export name on the imported module. When omitted the
   * processor tries `default`, then `Adapter`, then the first class-shaped
   * value on the module (in that order) — matching the existing custom-cost
   * loading convention in `WorkerProcessor.loadCustomCostFromFile`.
   */
  readonly exportName?: string;
  /**
   * When `true`, every worker in the pool runs in-process via
   * {@link MockEpisodeWorker} instead of a real `Worker`. Default `false`.
   *
   * Intended for tests, micro-benchmarks, and environments where the
   * worker boundary is unavailable (e.g. browsers without nested worker
   * support). Real evolution runs on multi-core machines should leave this
   * off so rollouts actually parallelise across CPU cores.
   */
  readonly direct?: boolean;
}

/** Init payload sent once per worker right after construction. */
export interface EpisodeInitRequest extends BaseRequestData {
  readonly initialize: {
    readonly adapter: AdapterDescription;
    /**
     * Optional WASM activation bootstrap payload. When provided the worker
     * synchronously initialises the WASM activation module during init,
     * matching the behaviour of the dataset worker pool — without this the
     * worker's `creature.activate()` calls would throw
     * `WasmError("WASM activation could not be loaded")`.
     */
    readonly wasmActivation?:
      import("../workers/WasmActivationPayload.ts").WasmActivationInitPayload;
  };
}

/**
 * Per-creature rollout request. The worker runs every entry in `seedSet`
 * serially on the same in-worker adapter instance, so the trajectory is
 * fully isolated per creature (no shared simulator state across workers).
 */
export interface EpisodeRunRequest extends BaseRequestData {
  readonly runEpisodes: {
    readonly creature: CreatureExport;
    readonly seedSet: readonly number[];
  };
}

/** Discriminated union of all requests the episode worker handles. */
export type EpisodeRequest = EpisodeInitRequest | EpisodeRunRequest;

/** Response to {@link EpisodeInitRequest}. */
export interface EpisodeInitResponse extends BaseResponseData {
  readonly initialize: {
    readonly status: "OK" | "ERROR";
    readonly error?: string;
  };
}

/**
 * Single-episode summary returned by the worker. Mirrors the on-thread
 * {@link import("./EpisodeRunner.ts").EpisodeResult} but drops the wall-clock
 * field (already wire-noisy) — callers care about the scalar return and the
 * termination signal.
 */
export interface EpisodeOutcome {
  /** Sum of step rewards for the rollout. */
  readonly reward: number;
  /** Adapter signalled a natural episode end. */
  readonly terminated: boolean;
  /** A guard fired (step cap or wall-clock cap). */
  readonly truncated: boolean;
  /** Number of `step()` calls before exit. */
  readonly steps: number;
  /** Seed used for this episode. */
  readonly seed: number;
}

/** Response to {@link EpisodeRunRequest}. */
export interface EpisodeRunResponse extends BaseResponseData {
  readonly runEpisodes: {
    /** Per-trial outcomes; same length as the request's `seedSet`. */
    readonly outcomes: readonly EpisodeOutcome[];
  };
}

/** Discriminated union of all responses the episode worker emits. */
export type EpisodeResponse =
  | (EpisodeInitResponse & {
    error?: { name?: string; message: string; stack?: string };
  })
  | (EpisodeRunResponse & {
    error?: { name?: string; message: string; stack?: string };
  })
  | (BaseResponseData & {
    error: { name?: string; message: string; stack?: string };
  });
