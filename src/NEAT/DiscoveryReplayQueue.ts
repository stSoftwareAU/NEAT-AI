import type { Creature } from "@creature";
import type { NeatOptions } from "@config/NeatOptions.ts";
import {
  type DiscoveryReplayDirResult,
  DiscoveryReplayRunner,
} from "@discovery/DiscoveryReplayRunner.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { isSeedWarmupStructuralLockActive } from "@architecture/CreatureFactory.ts";
import { getLogger } from "@utils/Logger.ts";

// Re-export for use by Neat.ts (Issue #1150)
export type { DiscoveryReplayDirResult };

/**
 * Neat-level seed warm-up context supplied by the caller (Issue #2910).
 *
 * The {@link DiscoveryReplayQueue} holds no `Neat` reference, so the owning
 * evolution loop passes the warm-up counters explicitly. Reading the lock
 * state from this context — rather than from per-creature tags — keeps the
 * gate correct once mid-run creatures stop carrying warm-up tags (#2911):
 * an untagged creature inside an active warm-up window stays locked.
 */
export interface DiscoveryReplayWarmupContext {
  /** Configured warm-up generation count (0 = warm-up disabled). */
  warmupGenerations: number;
  /** Current evolution generation (<= 0 = unknown). */
  currentGeneration: number;
}

/**
 * Dependencies for the DiscoveryReplayQueue.
 * These can be injected for testing purposes.
 */
export interface DiscoveryReplayQueueDeps {
  /**
   * Function to replay discoveries against a creature.
   * Defaults to using the DiscoveryReplayRunner.
   *
   * @param creature The creature to replay discoveries against
   * @param dataDir The data directory containing training data
   * @param options NEAT options
   * @param timeoutMinutes Optional timeout in minutes (0 or undefined = no timeout)
   */
  replayDir?: (
    creature: Creature,
    dataDir: string,
    options: NeatOptions,
    timeoutMinutes?: number,
  ) => Promise<DiscoveryReplayDirResult>;
}

/**
 * Queue for non-blocking background replay of cached discoveries (Issue #997).
 *
 * When a new "fittest" creature is found during evolution, this queue manages
 * the background replay of discoveries against it. Key characteristics:
 *
 * 1. Only one replay runs at a time (replay can take longer than evolution)
 * 2. When a new fittest is found during replay, it's queued for processing next
 * 3. Only the most recent queued creature is kept (older ones are discarded)
 * 4. Completed results are collected for integration back into the population
 */
export class DiscoveryReplayQueue {
  #deps: DiscoveryReplayQueueDeps;
  #replayInProgress = false;
  #queuedCreature: {
    creature: Creature;
    dataDir: string;
    options: NeatOptions;
    timeoutMinutes?: number;
  } | null = null;
  #completedResults: DiscoveryReplayDirResult[] = [];
  #currentPromise: Promise<void> | null = null;

  constructor(deps: DiscoveryReplayQueueDeps = {}) {
    this.#deps = {
      replayDir: deps.replayDir ?? this.defaultReplayDir.bind(this),
    };
  }

  /**
   * Default replay implementation using DiscoveryReplayRunner.
   *
   * @param creature The creature to replay discoveries against
   * @param dataDir The data directory containing training data
   * @param options NEAT options
   * @param timeoutMinutes Optional timeout in minutes (0 or undefined = no timeout)
   */
  private async defaultReplayDir(
    creature: Creature,
    dataDir: string,
    options: NeatOptions,
    timeoutMinutes?: number,
  ): Promise<DiscoveryReplayDirResult> {
    const runner = new DiscoveryReplayRunner();
    return await runner.replayDir({
      creature,
      dataDir,
      options,
      timeoutMinutes,
    });
  }

  /**
   * Schedule a replay of discoveries against the given creature.
   *
   * If a replay is already in progress, the creature is queued for processing
   * when the current replay completes. Only the most recent queued creature
   * is kept (older queued creatures are discarded).
   *
   * @param creature The fittest creature to replay discoveries against
   * @param dataDir The directory containing the dataset
   * @param options NEAT options (must include discoveryCacheDir)
   * @param remainingTimeMinutes Optional remaining evolution time in minutes.
   *        If provided and below the minimum threshold, replay is skipped.
   *        If provided, replay timeout is capped to this value.
   * @param warmupContext Optional Neat-level seed warm-up context. When
   *        supplied and the lock is active, replay is skipped (Issue #2910).
   */
  scheduleReplay(
    creature: Creature,
    dataDir: string,
    options: NeatOptions,
    remainingTimeMinutes?: number,
    warmupContext?: DiscoveryReplayWarmupContext,
  ): void {
    // Issue #2828/#2910: never replay cached structural discoveries while the
    // seed warm-up structural lock is active — replay can prune or rewire
    // topology, which must wait until warm-up has elapsed. The lock state is
    // read from Neat-level warm-up context supplied by the caller (this queue
    // holds no Neat reference). Reading per-creature tags would silently open
    // the lock once mid-run creatures stop carrying warm-up tags (#2911).
    if (
      warmupContext &&
      isSeedWarmupStructuralLockActive(
        warmupContext.warmupGenerations,
        warmupContext.currentGeneration,
      )
    ) {
      return;
    }

    const config = createNeatConfig(options);

    // Skip if no cache directory is configured
    if (!config.discoveryCacheDir) {
      return;
    }

    // Issue #1113: Skip replay if insufficient time remaining
    const minTimeMinutes = config.discoveryReplayMinTimeMinutes;
    if (
      remainingTimeMinutes !== undefined &&
      remainingTimeMinutes > 0 &&
      remainingTimeMinutes < minTimeMinutes
    ) {
      // Not enough time remaining to start replay
      return;
    }

    // Calculate effective timeout:
    // - If remainingTimeMinutes is provided and positive, use the minimum of
    //   remainingTimeMinutes and discoveryReplayTimeoutMinutes (if configured)
    // - Otherwise use discoveryReplayTimeoutMinutes as the default timeout
    let effectiveTimeout: number | undefined;
    const configuredTimeout = config.discoveryReplayTimeoutMinutes;

    if (remainingTimeMinutes !== undefined && remainingTimeMinutes > 0) {
      if (configuredTimeout > 0) {
        effectiveTimeout = Math.min(remainingTimeMinutes, configuredTimeout);
      } else {
        effectiveTimeout = remainingTimeMinutes;
      }
    } else if (configuredTimeout > 0) {
      effectiveTimeout = configuredTimeout;
    }

    if (this.#replayInProgress) {
      // Queue this creature to be processed when the current replay completes
      // Only keep the most recent queued creature
      this.#queuedCreature = {
        creature: creature.shallowClone(),
        dataDir,
        options,
        timeoutMinutes: effectiveTimeout,
      };
      return;
    }

    // Start the replay in the background
    this.#startReplay(
      creature.shallowClone(),
      dataDir,
      options,
      effectiveTimeout,
    );
  }

  /**
   * Start a replay in the background (non-blocking).
   *
   * @param creature The creature to replay discoveries against
   * @param dataDir The data directory containing training data
   * @param options NEAT options
   * @param timeoutMinutes Optional timeout in minutes
   */
  #startReplay(
    creature: Creature,
    dataDir: string,
    options: NeatOptions,
    timeoutMinutes?: number,
  ): void {
    this.#replayInProgress = true;

    this.#currentPromise = this.#deps.replayDir!(
      creature,
      dataDir,
      options,
      timeoutMinutes,
    )
      .then((result) => {
        this.#completedResults.push(result);
      })
      .catch((error) => {
        getLogger().error("[DiscoveryReplayQueue] Replay failed:", error);
      })
      .finally(() => {
        this.#replayInProgress = false;
        this.#currentPromise = null;

        // Process the next queued creature if any
        if (this.#queuedCreature) {
          const queued = this.#queuedCreature;
          this.#queuedCreature = null;
          this.#startReplay(
            queued.creature,
            queued.dataDir,
            queued.options,
            queued.timeoutMinutes,
          );
        }
      });
  }

  /**
   * Check if a replay is currently in progress.
   */
  isReplayInProgress(): boolean {
    return this.#replayInProgress;
  }

  /**
   * Get and remove completed replay results.
   * Returns an array of results that can be integrated into the population.
   */
  getCompletedResults(): DiscoveryReplayDirResult[] {
    return [...this.#completedResults];
  }

  /**
   * Clear all completed results after they have been processed.
   */
  clearCompletedResults(): void {
    this.#completedResults.length = 0;
  }

  /**
   * Wait for any in-progress replay to complete.
   * Useful for testing and graceful shutdown.
   */
  async waitForCompletion(): Promise<void> {
    // Collect all promises to wait for rather than awaiting in loop
    while (this.#currentPromise || this.#queuedCreature) {
      const promiseToWait = this.#currentPromise;
      if (promiseToWait) {
        // deno-lint-ignore no-await-in-loop
        await promiseToWait;
      }
      // Small delay to allow the finally block to process queued creatures
      // deno-lint-ignore no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
}
