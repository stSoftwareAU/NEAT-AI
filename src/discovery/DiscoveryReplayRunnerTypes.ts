/**
 * Discovery Replay Runner Types Module
 *
 * Interface and type definitions for the discovery replay runner,
 * including input/output shapes and dependency injection.
 *
 * Extracted from DiscoveryReplayRunner.ts as part of #1598.
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { Creature } from "@creature";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { SuccessCacheEntry } from "@discovery/SuccessCache.ts";

export interface DiscoveryReplayDirInput {
  creature: Creature;
  dataDir: string;
  options: NeatOptions;
  /**
   * Optional timeout in minutes for the replay operation.
   * If provided and > 0, replay will abort gracefully when the timeout is reached.
   * This prevents replay from hanging the evolution process when time runs out.
   */
  timeoutMinutes?: number;
  /**
   * Optional absolute wall-clock deadline (ms since epoch) — Issue #2901.
   *
   * When supplied, replay stops at its next candidate-boundary check once the
   * deadline passes. Unlike {@link timeoutMinutes} (converted to a deadline at
   * runner start), an absolute deadline cannot be shifted by worker-queue or
   * start delays. When both are provided the runner clamps to the earlier of
   * the two.
   */
  deadlineTS?: number;
  /**
   * Optional cooperative abort signal — Issue #2901.
   *
   * When aborted, replay stops at its next candidate-boundary check and
   * performs no further data-directory reads. Used by the queue to abandon an
   * in-flight replay once the evolution hard cap is reached.
   */
  signal?: AbortSignal;
}

export interface DiscoveryReplayEvaluationSummary {
  kind: "original" | "single" | "combo";
  key?: string;
  changeType?: string;
  description?: string;
  score: number;
  error: number;
  scoreDelta?: number;
  improved: boolean;
}

export interface DiscoveryReplayDirResult {
  original: {
    error: number;
    score: number;
  };
  baselineRescore?: {
    claimedScore?: number;
    actualScore: number;
    actualError: number;
    changed: boolean;
    reason: string;
  };
  improvement?: {
    key?: string;
    changeType: string;
    error: number;
    score: number;
    scoreDelta: number;
    message: string;
    creature: unknown;
  };
  verifiedImprovement?: {
    score: number;
    error: number;
    scoreDelta: number;
    improved: boolean;
    message: string;
    creature: CreatureExport;
  };
  evaluatedSingles: number;
  evaluatedCombos: number;
  pruned: number;
  skippedAlreadyApplied: number;
  skippedNotApplicable: number;
  evaluations?: DiscoveryReplayEvaluationSummary[];
  /**
   * True if the replay operation timed out before completing all evaluations.
   * When timed out, the result contains partial data from evaluations completed
   * before the timeout.
   */
  timedOut?: boolean;
}

export interface DiscoveryReplayRunnerLike {
  replayDir(input: DiscoveryReplayDirInput): Promise<DiscoveryReplayDirResult>;
}

export interface DiscoveryReplayRunnerDeps {
  listEntries?: (dir: string) => SuccessCacheEntry[];
  /**
   * Archive an obsolete success cache entry instead of deleting it.
   * This preserves history of candidates that once improved but no longer do.
   */
  archiveEntry?: (dir: string, entry: SuccessCacheEntry) => void;
  applyEntry?: (
    baseCreature: Creature,
    entry: SuccessCacheEntry,
  ) => Creature | undefined;
  evaluateError?: (
    creature: Creature,
    feedbackLoop: boolean,
    costOfGrowth: number,
  ) => Promise<{ error: number; score: number }>;
}
