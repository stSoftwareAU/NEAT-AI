/**
 * EpisodeWorkerHandler.ts — Main-thread handle for a single
 * episode-rollout worker (Issue #2612).
 *
 * Slim subclass of {@link WorkerHandlerBase} with two operations:
 *
 * - `init(description)` — sent once on construction to ship the adapter
 *   import URL plus its JSON config. The base class' init-timeout logic
 *   surfaces worker crashes during the `import()` call as a regular promise
 *   rejection so {@link EpisodeWorkerPool} can degrade gracefully.
 * - `runEpisodes(creature, seedSet)` — called per creature; returns the
 *   per-trial outcome vector with the same length as the input seed set.
 */

import type { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  getInitTimeoutMs,
  WorkerHandlerBase,
} from "@workers/WorkerHandlerBase.ts";
import type { WorkerInterface } from "@workers/WorkerInterface.ts";
import { MockEpisodeWorker } from "@creature/MockEpisodeWorker.ts";
import type {
  AdapterDescription,
  EpisodeOutcome,
  EpisodeRequest,
  EpisodeResponse,
} from "@creature/EpisodeWorkerProtocol.ts";
import type { WasmActivationInitPayload } from "@workers/WasmActivationPayload.ts";

/**
 * Main-thread handle for a single episode worker. Responsible for the init
 * round-trip, request/response routing, and graceful termination.
 */
export class EpisodeWorkerHandler
  extends WorkerHandlerBase<EpisodeRequest, EpisodeResponse> {
  private static nextId = 0;

  constructor(
    description: AdapterDescription,
    direct: boolean,
    wasmPayload?: WasmActivationInitPayload,
  ) {
    let resolveInitReady!: (value: EpisodeResponse) => void;
    let rejectInitReady!: (err: Error) => void;
    const initReady = new Promise<EpisodeResponse>((resolve, reject) => {
      resolveInitReady = resolve;
      rejectInitReady = reject;
    });

    let capturedInitError: Error | undefined;
    const onInitError = (err: Error) => {
      capturedInitError ??= err;
    };

    const workerUrl =
      new URL("../multithreading/episode/episodeWorker.ts", import.meta.url)
        .href;

    const worker = WorkerHandlerBase.createWorkerOrMock<EpisodeRequest>(
      direct,
      workerUrl,
      "episode-worker-" + (++EpisodeWorkerHandler.nextId),
      () =>
        new MockEpisodeWorker() as unknown as WorkerInterface<
          EpisodeRequest
        >,
      onInitError,
    );

    super(worker, initReady);
    this.initWorkerError = capturedInitError;

    const initRequest: EpisodeRequest = {
      taskID: this.taskID++,
      initialize: { adapter: description, wasmActivation: wasmPayload },
    };

    const timeoutMs = getInitTimeoutMs();
    const initErrorPromise: Promise<never> = new Promise((_, reject) => {
      // Surface any later-captured construction errors as init failures.
      // The promise stays open if no error is captured — the base class
      // race resolves on either the init response or the timeout.
      const interval = setInterval(() => {
        if (capturedInitError) {
          clearInterval(interval);
          reject(capturedInitError);
        }
      }, 25);
      // Stop polling once the init promise resolves so the timer doesn't
      // hold the event loop open in tests.
      initReady.then(
        () => clearInterval(interval),
        () => clearInterval(interval),
      );
    });

    this.createInitSequence(initRequest, initErrorPromise, timeoutMs)
      .then((result) => {
        if (
          result &&
          typeof result === "object" &&
          "initialize" in result &&
          result.initialize?.status === "OK"
        ) {
          resolveInitReady(result);
        } else {
          const message = (result && typeof result === "object" &&
            "initialize" in result && result.initialize?.error) ||
            "Episode worker init failed";
          rejectInitReady(new Error(message));
        }
      })
      .catch(rejectInitReady);
  }

  /**
   * Run every entry in `seedSet` for `creature` on this worker. Returns the
   * per-trial outcome vector (same length, same order).
   */
  runEpisodes(
    creature: Creature,
    seedSet: readonly number[],
  ): Promise<readonly EpisodeOutcome[]> {
    const exportJson = creature.exportJSON() as CreatureExport;
    const data: EpisodeRequest = {
      taskID: this.taskID++,
      runEpisodes: {
        creature: exportJson,
        seedSet: [...seedSet],
      },
    };
    return this.makePromiseDeferred(data).then((response) => {
      if (response.error) {
        const err = new Error(response.error.message);
        if (response.error.stack) err.stack = response.error.stack;
        if (response.error.name) err.name = response.error.name;
        throw err;
      }
      if (!("runEpisodes" in response)) {
        throw new Error(
          "EpisodeWorkerHandler.runEpisodes: malformed worker response (missing runEpisodes payload)",
        );
      }
      return response.runEpisodes.outcomes;
    });
  }
}
