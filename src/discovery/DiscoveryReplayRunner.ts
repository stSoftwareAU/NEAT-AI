/**
 * Discovery Replay Runner Module
 *
 * Replays cached successful discovery changes against the current creature
 * to find improvements without re-running the full discovery process.
 *
 * Helper functions extracted to:
 * - ReplayEntryApplication.ts (applying cache entries to creatures)
 * - ReplayHelpers.ts (evaluation, combo building, scoring utilities)
 * - DiscoveryReplayRunnerTypes.ts (interface definitions)
 */

import type { CostName } from "../Costs.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "../config/NeatConfig.ts";
import type { Creature } from "../Creature.ts";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import type { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import {
  calculatePriority,
  dequeueAll,
  enqueue,
  makeEmptyQueue,
  type PriorityDiscoveryQueue,
  updateSuccessRate,
} from "./PriorityDiscoveryQueue.ts";
import {
  archiveSuccessByKeySync,
  listSuccessEntriesSync,
  type SuccessCacheEntry,
} from "./SuccessCache.ts";
import { applyEntryUsingRustRequest } from "./ReplayEntryApplication.ts";
import { isAlreadyApplied } from "./ReplayEntryApplication.ts";
import {
  buildComboIndices,
  describeCombo,
  evaluateAll,
  type EvaluationTask,
  mapConcurrent,
  parseClaimedTagNumber,
  scoreMeaningfullyDifferent,
  setupWorkerPool,
} from "./ReplayHelpers.ts";
import type {
  DiscoveryReplayDiagnostics,
  DiscoveryReplayDirInput,
  DiscoveryReplayDirResult,
  DiscoveryReplayEvaluationSummary,
  DiscoveryReplayRunnerDeps,
  DiscoveryReplayRunnerLike,
} from "./DiscoveryReplayRunnerTypes.ts";

// Re-export for backward compatibility.
export type {
  DiscoveryReplayDiagnostics,
  DiscoveryReplayDirInput,
  DiscoveryReplayDirResult,
  DiscoveryReplayEvaluationSummary,
  DiscoveryReplayRunnerDeps,
  DiscoveryReplayRunnerLike,
} from "./DiscoveryReplayRunnerTypes.ts";
export { evaluateAll } from "./ReplayHelpers.ts";

export class DiscoveryReplayRunner implements DiscoveryReplayRunnerLike {
  #deps: {
    listEntries: (dir: string) => SuccessCacheEntry[];
    archiveEntry: (dir: string, entry: SuccessCacheEntry) => void;
    applyEntry: (
      baseCreature: Creature,
      entry: SuccessCacheEntry,
    ) => Creature | undefined;
    evaluateError?: (
      creature: Creature,
      feedbackLoop: boolean,
      costOfGrowth: number,
    ) => Promise<{ error: number; score: number }>;
  };

  constructor(deps: DiscoveryReplayRunnerDeps = {}) {
    this.#deps = {
      listEntries: deps.listEntries ?? listSuccessEntriesSync,
      archiveEntry: deps.archiveEntry ??
        ((dir, entry) =>
          archiveSuccessByKeySync(dir, entry.changeType, entry.key)),
      applyEntry: deps.applyEntry ?? applyEntryUsingRustRequest,
      evaluateError: deps.evaluateError,
    };
  }

  async replayDir(
    input: DiscoveryReplayDirInput,
  ): Promise<DiscoveryReplayDirResult> {
    const { creature, dataDir, options, timeoutMinutes } = input;
    const config = createNeatConfig(options);
    const verifyScores = config.discoveryReplayVerifyScores;
    const replayConcurrency = verifyScores
      ? config.discoveryReplayConcurrency
      : config.threads;
    const diagnosticsEnabled = config.discoveryReplayDiagnostics ?? false;
    const totalStart = diagnosticsEnabled ? performance.now() : 0;
    const timingsMS: DiscoveryReplayDiagnostics["timingsMS"] | undefined =
      diagnosticsEnabled ? {} : undefined;
    let resultToReturn: DiscoveryReplayDirResult | undefined;

    // Issue #1113: Calculate timeout deadline if timeout is provided
    const deadlineTS = timeoutMinutes !== undefined && timeoutMinutes > 0
      ? Date.now() + timeoutMinutes * 60 * 1000
      : undefined;
    let timedOut = false;

    // Helper to check if we've exceeded the timeout
    const isTimedOut = (): boolean => {
      if (!deadlineTS) return false;
      return Date.now() >= deadlineTS;
    };

    const successCacheDir = config.discoverySuccessCacheDir;
    if (!successCacheDir) {
      throw new ConfigurationError(
        "discoverySuccessCacheDir must be set to use discoveryReplayDir().",
        "INVALID_TYPE",
      );
    }

    CreatureUtil.makeUUID(creature);

    // Default evaluation uses workers for speed, but tests can inject an
    // evaluator to keep replay deterministic and fast.
    const workers: WorkerHandler[] = [];

    try {
      if (!this.#deps.evaluateError) {
        const setupStart = diagnosticsEnabled ? performance.now() : 0;
        const pool = await setupWorkerPool({
          workerCount: replayConcurrency,
          dataDir,
          costName: config.costName as CostName,
          customCost: config.customCost,
          wasmCache: config.wasmCache,
        });
        workers.push(...pool);
        if (timingsMS) timingsMS.setupWorkers = performance.now() - setupStart;
      }

      const deps = {
        ...this.#deps,
      };

      const evaluateTasks = async (
        tasks: EvaluationTask[],
      ): Promise<Array<EvaluationTask & { error: number; score: number }>> => {
        if (this.#deps.evaluateError) {
          return await mapConcurrent(
            tasks,
            replayConcurrency,
            async (task) => {
              const evalResult = await this.#deps.evaluateError!(
                task.creature,
                config.feedbackLoop,
                config.costOfGrowth,
              );
              return { ...task, ...evalResult };
            },
          );
        }
        return await evaluateAll(
          workers,
          tasks,
          config.feedbackLoop,
          config.costOfGrowth,
        );
      };

      // Load cache entries and prioritise using the priority queue (Issue #1299).
      // The priority queue orders candidates by expected improvement based on:
      // - Score delta from original discovery (primary factor)
      // - Historical success rate for the candidate's change type
      const listStart = diagnosticsEnabled ? performance.now() : 0;
      const allEntries = deps.listEntries(successCacheDir)
        .filter((e) =>
          typeof e.key === "string" && typeof e.changeType === "string"
        )
        // Do not persist combo entries; replay builds combos on demand from singles.
        .filter((e) => !e.changeType.startsWith("combo-"));
      if (timingsMS) timingsMS.listEntries = performance.now() - listStart;

      const sortStart = diagnosticsEnabled ? performance.now() : 0;
      // Build a priority queue with all entries
      let priorityQueue: PriorityDiscoveryQueue = makeEmptyQueue();
      for (const entry of allEntries) {
        const priority = calculatePriority(entry, {
          successRates: priorityQueue.successRates,
        });
        priorityQueue = enqueue(priorityQueue, entry, priority);
      }

      // Dequeue all entries in priority order
      const [prioritisedCandidates] = dequeueAll(priorityQueue);
      const sortedEntries = prioritisedCandidates.map((pc) => pc.entry);
      if (timingsMS) timingsMS.sortEntries = performance.now() - sortStart;

      const selectedEntries = sortedEntries.slice(
        0,
        config.discoveryReplayMaxSingles,
      );

      let skippedAlreadyApplied = 0;
      let skippedNotApplicable = 0;

      // Apply all singles we can.
      const applySinglesStart = diagnosticsEnabled ? performance.now() : 0;
      const singleCandidates: Array<{
        entry: SuccessCacheEntry;
        creature: Creature;
      }> = [];
      for (const entry of selectedEntries) {
        if (isAlreadyApplied(creature, entry)) {
          skippedAlreadyApplied++;
          continue;
        }
        const applied = deps.applyEntry(creature, entry);
        if (!applied) {
          skippedNotApplicable++;
          continue;
        }
        CreatureUtil.makeUUID(applied);
        singleCandidates.push({ entry, creature: applied });
      }
      if (timingsMS) {
        timingsMS.applySingles = performance.now() - applySinglesStart;
      }

      // Issue #1113: Check timeout before starting evaluations
      if (isTimedOut()) {
        timedOut = true;
        // Return early with empty results if timed out before evaluation
        return {
          original: { error: 0, score: 0 },
          evaluatedSingles: 0,
          evaluatedCombos: 0,
          pruned: 0,
          skippedAlreadyApplied,
          skippedNotApplicable,
          timedOut: true,
        };
      }

      const tasksBaselineAndSingles: EvaluationTask[] = [
        { kind: "original", creature },
        ...singleCandidates.map((c) => ({
          kind: "single" as const,
          creature: c.creature,
          entry: c.entry,
          description: c.entry.description,
        })),
      ];

      const evalBaselineAndSinglesStart = diagnosticsEnabled
        ? performance.now()
        : 0;
      const evaluatedBaselineAndSingles = await evaluateTasks(
        tasksBaselineAndSingles,
      );
      if (timingsMS) {
        timingsMS.evaluateBaselineAndSingles = performance.now() -
          evalBaselineAndSinglesStart;
      }

      const originalEval = {
        error: evaluatedBaselineAndSingles[0].error,
        score: evaluatedBaselineAndSingles[0].score,
      };

      const singleResults = evaluatedBaselineAndSingles.slice(1).map((r) => ({
        entry: r.entry!,
        creature: r.creature,
        error: r.error,
        score: r.score,
        scoreDelta: r.score - originalEval.score,
      }));

      let pruned = 0;
      const successfulSingles = singleResults.filter((r) =>
        r.score > originalEval.score
      );
      const failedSingles = singleResults.filter((r) =>
        r.score <= originalEval.score
      );

      // Update success rates for future priority calculations (Issue #1299).
      // This helps refine priority scoring by tracking which change types
      // are more likely to succeed.
      for (const result of singleResults) {
        const succeeded = result.score > originalEval.score;
        priorityQueue = updateSuccessRate(
          priorityQueue,
          result.entry.changeType,
          succeeded,
        );
      }

      for (const failed of failedSingles) {
        // Archive obsolete entries instead of deleting them to preserve history
        deps.archiveEntry(successCacheDir, failed.entry);
        pruned++;
      }

      // Build combos from still-successful singles.
      const buildCombosStart = diagnosticsEnabled ? performance.now() : 0;
      const combosToTry = buildComboIndices(
        successfulSingles,
        config.discoveryReplayMaxPairwise,
        config.discoveryReplayMaxTriples,
      );

      const comboCandidates: Array<{
        indices: number[];
        creature: Creature;
        entries: SuccessCacheEntry[];
      }> = [];

      for (const indices of combosToTry) {
        let current = creature;
        let ok = true;
        const entries = indices.map((i) => successfulSingles[i].entry);
        for (const entry of entries) {
          const next = deps.applyEntry(current, entry);
          if (!next) {
            ok = false;
            break;
          }
          current = next;
        }
        if (!ok) continue;
        CreatureUtil.makeUUID(current);
        comboCandidates.push({ indices, creature: current, entries });
      }
      if (timingsMS) {
        timingsMS.buildCombos = performance.now() - buildCombosStart;
      }

      const comboTasks: EvaluationTask[] = comboCandidates.map((c) => ({
        kind: "combo" as const,
        creature: c.creature,
        description: describeCombo(c.entries),
      }));

      // Issue #1113: Check timeout before evaluating combos - skip combos if timed out
      // but still return partial results from singles evaluation
      let evaluatedCombos: Array<
        EvaluationTask & { error: number; score: number }
      > = [];
      const evaluateCombosStart = diagnosticsEnabled ? performance.now() : 0;
      if (!isTimedOut() && comboTasks.length > 0) {
        evaluatedCombos = await evaluateTasks(comboTasks);
      } else if (isTimedOut()) {
        timedOut = true;
      }
      if (timingsMS) {
        timingsMS.evaluateCombos = performance.now() - evaluateCombosStart;
      }

      const comboResults = evaluatedCombos.map((r, i) => ({
        creature: r.creature,
        entries: comboCandidates[i].entries,
        error: r.error,
        score: r.score,
        scoreDelta: r.score - originalEval.score,
      }));

      // Pick best single/combo.
      const allEvaluated = [
        ...successfulSingles.map((r) => ({
          kind: "single" as const,
          key: r.entry.key,
          changeType: r.entry.changeType,
          description: r.entry.description,
          creature: r.creature,
          error: r.error,
          score: r.score,
          scoreDelta: r.scoreDelta,
        })),
        ...comboResults.map((r) => ({
          kind: "combo" as const,
          key: undefined,
          changeType: "combo-successful",
          description: describeCombo(r.entries),
          creature: r.creature,
          error: r.error,
          score: r.score,
          scoreDelta: r.scoreDelta,
        })),
      ];

      const selectBestStart = diagnosticsEnabled ? performance.now() : 0;
      allEvaluated.sort((a, b) => {
        const delta = (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0);
        if (delta !== 0) return delta;
        const score = b.score - a.score;
        if (score !== 0) return score;
        const err = a.error - b.error;
        if (err !== 0) return err;
        const aKey = `${a.kind}:${a.changeType}:${a.key ?? ""}:${
          a.description ?? ""
        }`;
        const bKey = `${b.kind}:${b.changeType}:${b.key ?? ""}:${
          b.description ?? ""
        }`;
        return aKey.localeCompare(bKey);
      });
      const best = allEvaluated[0];
      if (timingsMS) timingsMS.selectBest = performance.now() - selectBestStart;

      const evaluations: DiscoveryReplayEvaluationSummary[] = [
        {
          kind: "original",
          score: originalEval.score,
          error: originalEval.error,
          improved: false,
        },
        ...singleResults.map((r) => ({
          kind: "single" as const,
          key: r.entry.key,
          changeType: r.entry.changeType,
          description: r.entry.description,
          score: r.score,
          error: r.error,
          scoreDelta: r.scoreDelta,
          improved: r.score > originalEval.score,
        })),
        ...comboResults.map((r) => ({
          kind: "combo" as const,
          changeType: "combo-successful",
          description: describeCombo(r.entries),
          score: r.score,
          error: r.error,
          scoreDelta: r.scoreDelta,
          improved: r.score > originalEval.score,
        })),
      ];

      const result: DiscoveryReplayDirResult = {
        original: originalEval,
        evaluatedSingles: singleResults.length,
        evaluatedCombos: comboResults.length,
        pruned,
        skippedAlreadyApplied,
        skippedNotApplicable,
        evaluations,
        timedOut: timedOut || undefined, // Only include if true
      };

      if (diagnosticsEnabled) {
        result.diagnostics = {
          timingsMS: timingsMS ?? {},
          counts: {
            workerCount: workers.length,
            entriesLoaded: allEntries.length,
            singlesApplied: singleCandidates.length,
            singlesEvaluated: singleResults.length,
            combosBuilt: comboCandidates.length,
            combosEvaluated: comboResults.length,
            pruned,
            skippedAlreadyApplied,
            skippedNotApplicable,
          },
        };
      }

      const prefix = "🦘";
      const shortID = (creature.uuid ?? "Unknown").slice(-8);
      if (verifyScores && config.discoveryReplayRescoreBaseline) {
        const claimedScore = parseClaimedTagNumber(creature.tags, "score");
        const claimedError = parseClaimedTagNumber(creature.tags, "error");
        const changed = scoreMeaningfullyDifferent(
          claimedScore,
          originalEval.score,
        );
        const reason = claimedScore === undefined
          ? `${prefix} Baseline rescore: no claimed score tag found, so I rescored for ${shortID} (score=${originalEval.score}, error=${originalEval.error}).`
          : `${prefix} Score drift check: claimed score ${claimedScore} (error ${
            claimedError ?? "?"
          }) vs actual score ${originalEval.score} (error ${originalEval.error}) for ${shortID}.`;

        void claimedError; // Claimed error is optional; callers can re-tag using actualError.

        result.baselineRescore = {
          claimedScore,
          actualScore: originalEval.score,
          actualError: originalEval.error,
          changed,
          reason,
        };
      }

      if (best && best.score > originalEval.score) {
        const scoreDelta = best.score - originalEval.score;
        const message = `${best.description ?? best.changeType}: Score +${
          scoreDelta.toPrecision(6)
        } -> ${best.score.toPrecision(6)}`;
        result.improvement = {
          key: best.key,
          changeType: best.changeType,
          error: best.error,
          score: best.score,
          scoreDelta,
          message,
          creature: best.creature.exportJSON(),
        };
        if (verifyScores) {
          result.verifiedImprovement = {
            score: best.score,
            error: best.error,
            scoreDelta,
            improved: scoreDelta > 0,
            message:
              `${prefix} Verified improvement for ${shortID}: ${message}`,
            creature: best.creature.exportJSON(),
          };
        }
      }

      resultToReturn = result;
      return result;
    } finally {
      const teardownStart = diagnosticsEnabled ? performance.now() : 0;
      for (const worker of workers) {
        try {
          worker.terminate();
        } catch {
          // Ignore termination errors.
        }
      }
      if (resultToReturn?.diagnostics?.timingsMS) {
        resultToReturn.diagnostics.timingsMS.teardownWorkers =
          diagnosticsEnabled ? performance.now() - teardownStart : undefined;
        resultToReturn.diagnostics.timingsMS.total = diagnosticsEnabled
          ? performance.now() - totalStart
          : undefined;
      }
    }
  }
}
