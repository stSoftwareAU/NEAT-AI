import type { Creature } from "../Creature.ts";
import type { NeatOptions } from "../config/NeatOptions.ts";
import {
  type DiscoveryReplayDirResult,
  DiscoveryReplayRunner,
} from "../discovery/DiscoveryReplayRunner.ts";
import { createNeatConfig } from "../config/NeatConfig.ts";
import { getLogger } from "../utils/Logger.ts";

// Re-export for use by Neat.ts (Issue #1150)
export type { DiscoveryReplayDirResult };

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
   */
  scheduleReplay(
    creature: Creature,
    dataDir: string,
    options: NeatOptions,
    remainingTimeMinutes?: number,
  ): void {
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
