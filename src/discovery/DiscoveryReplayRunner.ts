import { assertExists } from "@std/assert";
import type { CostName } from "../Costs.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { DiscoverStructure } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { RemovalCandidate } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import {
  applySplitSynapseInsertNeuronCandidate,
  type SplitSynapseInsertNeuronCandidate,
} from "../architecture/ErrorGuidedStructuralEvolution/SplitSynapseInsertNeuronCandidate.ts";
import { calculate as calculateScore } from "../architecture/Score.ts";
import { createNeatConfig } from "../config/NeatConfig.ts";
import type { NeatOptions } from "../config/NeatOptions.ts";
import type { Creature } from "../Creature.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { formatWeight } from "./FailureCache.ts";
import {
  deleteSuccessByKeySync,
  listSuccessEntriesSync,
  type SuccessCacheEntry,
} from "./SuccessCache.ts";

export interface DiscoveryReplayDirInput {
  creature: Creature;
  dataDir: string;
  options: NeatOptions;
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
}

export interface DiscoveryReplayRunnerLike {
  replayDir(input: DiscoveryReplayDirInput): Promise<DiscoveryReplayDirResult>;
}

export interface DiscoveryReplayRunnerDeps {
  listEntries?: (dir: string) => SuccessCacheEntry[];
  deleteEntry?: (dir: string, entry: SuccessCacheEntry) => void;
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

type EvaluationTask = {
  kind: "original" | "single" | "combo";
  creature: Creature;
  entry?: SuccessCacheEntry;
  description?: string;
};

/**
 * Evaluate a batch of replay tasks across a set of workers.
 *
 * @internal
 */
export async function evaluateAll(
  workers: WorkerHandler[],
  tasks: EvaluationTask[],
  feedbackLoop: boolean,
  costOfGrowth: number,
): Promise<Array<EvaluationTask & { error: number; score: number }>> {
  const queue = tasks.map((task, index) => ({ task, index }));
  const results: Array<
    (EvaluationTask & { error: number; score: number }) | undefined
  > = new Array(tasks.length);

  const processNext = async (worker: WorkerHandler): Promise<void> => {
    const next = queue.shift();
    if (!next) return;
    const { task, index } = next;

    const response = await worker.evaluate(task.creature, feedbackLoop);
    assertExists(
      response.evaluate,
      "Worker did not return evaluation data.",
    );
    const error = response.evaluate.error;
    const score = calculateScore(task.creature, error, costOfGrowth);
    results[index] = { ...task, error, score };

    await processNext(worker);
  };

  await Promise.all(workers.map((worker) => processNext(worker)));
  return results.filter((r) => r !== undefined);
}

function isRemovalType(changeType: string): boolean {
  return changeType === "remove-low-impact" || changeType === "remove-neuron" ||
    changeType === "remove-synapse";
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parseClaimedTagNumber(
  tags: Array<{ name: string; value?: string }> | undefined,
  key: "score" | "error",
): number | undefined {
  if (!tags || tags.length === 0) return undefined;
  for (const tag of tags) {
    if (!tag?.name) continue;
    if (tag.name.toLowerCase() !== key) continue;
    const raw = tag.value ?? "";
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function scoreMeaningfullyDifferent(
  claimed: number | undefined,
  actual: number,
): boolean {
  if (claimed === undefined) return false;
  if (!Number.isFinite(actual)) return true;
  const absDiff = Math.abs(claimed - actual);
  if (absDiff <= 1e-12) return false;
  const denom = Math.max(1, Math.abs(claimed), Math.abs(actual));
  return absDiff / denom > 1e-9;
}

async function mapConcurrent<TIn, TOut>(
  inputs: readonly TIn[],
  concurrency: number,
  fn: (value: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: TOut[] = new Array(inputs.length);
  let nextIndex = 0;

  const runOne = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= inputs.length) return;
      // deno-lint-ignore no-await-in-loop -- This loop is the concurrency limiter; awaiting here is intentional.
      results[i] = await fn(inputs[i], i);
    }
  };

  const runners = Array.from(
    { length: Math.min(limit, inputs.length) },
    () => runOne(),
  );
  await Promise.all(runners);
  return results;
}

function getRustRequest(entry: SuccessCacheEntry): Record<string, unknown> {
  return (entry.rustRequest as Record<string, unknown>) ?? {};
}

function isNeuronPresent(creature: Creature, uuid: string): boolean {
  return creature.neurons.some((n) => n.uuid === uuid);
}

function isSynapsePresent(
  creature: Creature,
  fromUUID: string,
  toUUID: string,
): boolean {
  const exported = creature.exportJSON();
  return exported.synapses.some((s) =>
    s.fromUUID === fromUUID && s.toUUID === toUUID
  );
}

function isAlreadyApplied(
  creature: Creature,
  entry: SuccessCacheEntry,
): boolean {
  const type = entry.changeType;
  const req = getRustRequest(entry);

  // Fast-path: structural removals.
  if (type === "remove-low-impact") {
    const c = req.removalCandidate as RemovalCandidate | undefined;
    return c?.neuronUUID ? !isNeuronPresent(creature, c.neuronUUID) : false;
  }
  if (type === "remove-neuron") {
    const c = req.harmfulNeuronCandidate as CandidateHarmfulNeuron | undefined;
    return c?.neuronUUID ? !isNeuronPresent(creature, c.neuronUUID) : false;
  }
  if (type === "remove-synapse") {
    const c = req.harmfulSynapseCandidate as CandidateSynapse | undefined;
    if (c?.fromNeuronUUID && c?.toNeuronUUID) {
      return !isSynapsePresent(creature, c.fromNeuronUUID, c.toNeuronUUID);
    }
    const details = req.synapseDetails as {
      fromNeuronUUID?: string;
      toNeuronUUID?: string;
    } | undefined;
    if (details?.fromNeuronUUID && details?.toNeuronUUID) {
      return !isSynapsePresent(
        creature,
        details.fromNeuronUUID,
        details.toNeuronUUID,
      );
    }
    return false;
  }

  if (type === "add-synapses") {
    const c = req.synapseCandidate as CandidateSynapse | undefined;
    if (!c?.fromNeuronUUID || !c?.toNeuronUUID) return false;
    return isSynapsePresent(creature, c.fromNeuronUUID, c.toNeuronUUID);
  }

  if (type === "change-squash") {
    const c = req.squashCandidate as CandidateSquash | undefined;
    if (!c?.neuronUUID || !c?.squash) return false;
    const neuron = creature.neurons.find((n) => n.uuid === c.neuronUUID);
    return neuron?.squash === c.squash;
  }

  if (type === "split-synapse-insert-neuron") {
    const c = req.splitSynapseInsertNeuronCandidate as
      | SplitSynapseInsertNeuronCandidate
      | undefined;
    if (!c?.newNeuron?.uuid) return false;
    return isNeuronPresent(creature, c.newNeuron.uuid);
  }

  if (type === "add-neurons") {
    // Approximate match using the same exponent-bucketing approach as the cache key.
    const details = req.neuronDetails as {
      fromNeuronUUID?: string;
      toNeuronUUID?: string;
      incomingWeight?: number;
      outgoingWeight?: number;
      bias?: number;
      squash?: string;
    } | undefined;
    const fromUUID = details?.fromNeuronUUID;
    const toUUID = details?.toNeuronUUID;
    if (!fromUUID || !toUUID) return false;

    const inW = safeNumber(details?.incomingWeight);
    const outW = safeNumber(details?.outgoingWeight);
    const bias = safeNumber(details?.bias);
    const squash = typeof details?.squash === "string"
      ? details.squash
      : undefined;
    if (
      inW === undefined || outW === undefined || bias === undefined || !squash
    ) {
      return false;
    }

    const inExp = formatWeight(inW);
    const outExp = formatWeight(outW);
    const biasExp = formatWeight(bias);

    // Find a hidden neuron with matching squash + bias magnitude that links from->hidden->to
    const exported = creature.exportJSON();
    for (const neuron of creature.neurons) {
      if (neuron.type !== "hidden") continue;
      if (neuron.squash !== squash) continue;
      if (formatWeight(neuron.bias) !== biasExp) continue;

      const inSyn = exported.synapses.find((s) =>
        s.fromUUID === fromUUID && s.toUUID === neuron.uuid
      );
      const outSyn = exported.synapses.find((s) =>
        s.fromUUID === neuron.uuid && s.toUUID === toUUID
      );
      if (!inSyn || !outSyn) continue;
      if (formatWeight(inSyn.weight) !== inExp) continue;
      if (formatWeight(outSyn.weight) !== outExp) continue;
      return true;
    }
    return false;
  }

  // Unknown type: do not assume applied.
  return false;
}

function applyEntryUsingRustRequest(
  baseCreature: Creature,
  entry: SuccessCacheEntry,
): Creature | undefined {
  const req = getRustRequest(entry);
  const discoveryID = entry.key || "replay";

  switch (entry.changeType) {
    case "split-synapse-insert-neuron": {
      const split = req.splitSynapseInsertNeuronCandidate as
        | SplitSynapseInsertNeuronCandidate
        | undefined;
      if (!split) return undefined;
      return applySplitSynapseInsertNeuronCandidate(baseCreature, split);
    }
    case "add-synapses": {
      const synapse = req.synapseCandidate as CandidateSynapse | undefined;
      if (!synapse) return undefined;
      return DiscoverStructure.addHelpfulSynapses(
        discoveryID,
        baseCreature,
        [synapse],
      );
    }
    case "add-neurons": {
      const neuron = req.neuronCandidate as CandidateNeuron | undefined;
      if (!neuron) return undefined;
      return DiscoverStructure.addHelpfulNeurons(
        discoveryID,
        baseCreature,
        [neuron],
      );
    }
    case "change-squash": {
      const squash = req.squashCandidate as CandidateSquash | undefined;
      if (!squash) return undefined;
      return DiscoverStructure.changeSquash(
        discoveryID,
        baseCreature,
        [squash],
      );
    }
    case "remove-synapse": {
      const synapse =
        (req.harmfulSynapseCandidate as CandidateSynapse | undefined) ??
          (req.synapseCandidate as CandidateSynapse | undefined);
      const details = req.synapseDetails as
        | { fromNeuronUUID?: string; toNeuronUUID?: string }
        | undefined;
      const resolved = synapse ??
        (details?.fromNeuronUUID && details?.toNeuronUUID
          ? {
            fromNeuronUUID: details.fromNeuronUUID,
            toNeuronUUID: details.toNeuronUUID,
            weight: 0,
            targetNeuronImpact: 0,
            expectedCreatureErrorReduction: 0,
            expectedCreatureScoreGain: 0,
            improvedCount: 0,
            totalCount: 0,
          } satisfies CandidateSynapse
          : undefined);
      if (!resolved) return undefined;
      const removed = DiscoverStructure.removeSynapse(
        discoveryID,
        baseCreature,
        resolved,
      );
      return removed ?? undefined;
    }
    case "remove-neuron": {
      const neuron = req.harmfulNeuronCandidate as
        | CandidateHarmfulNeuron
        | undefined;
      if (!neuron) return undefined;
      const removed = DiscoverStructure.removeHarmfulNeuron(
        discoveryID,
        baseCreature,
        neuron,
      );
      return removed ?? undefined;
    }
    case "remove-low-impact": {
      const c = req.removalCandidate as RemovalCandidate | undefined;
      if (!c) return undefined;
      const removed = DiscoverStructure.removeLowImpactNeuron(
        discoveryID,
        baseCreature,
        c,
      );
      return removed ?? undefined;
    }
    default:
      return undefined;
  }
}

function buildComboIndices(
  successfulSingles: Array<{ entry: SuccessCacheEntry }>,
  maxPairwise: number,
  maxTriples: number,
): number[][] {
  const combos: number[][] = [];
  const count = successfulSingles.length;
  if (count < 2) return combos;

  // All.
  combos.push(Array.from({ length: count }, (_, i) => i));

  // All removals as a separate candidate outcome (when there are 2+ removals).
  const removalOnly = successfulSingles
    .map((s, i) => (isRemovalType(s.entry.changeType) ? i : -1))
    .filter((i) => i >= 0);
  if (removalOnly.length >= 2 && removalOnly.length < count) {
    combos.push(removalOnly);
  }

  // Replay intentionally only evaluates the all-successful combination.
  // Pairwise/triple exploration can be reintroduced later if needed.
  void maxPairwise;
  void maxTriples;
  return combos;
}

function describeCombo(entries: SuccessCacheEntry[]): string {
  const types = Array.from(new Set(entries.map((e) => e.changeType)));
  const removalOnly = types.every(isRemovalType);
  if (removalOnly) {
    return `✂️ Replayed ${entries.length} cached pruning change${
      entries.length === 1 ? "" : "s"
    }`;
  }
  return `🏆 Replayed ${entries.length} cached change${
    entries.length === 1 ? "" : "s"
  } (${types.join(", ")})`;
}

export class DiscoveryReplayRunner implements DiscoveryReplayRunnerLike {
  #deps: {
    listEntries: (dir: string) => SuccessCacheEntry[];
    deleteEntry: (dir: string, entry: SuccessCacheEntry) => void;
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
      deleteEntry: deps.deleteEntry ??
        ((dir, entry) =>
          deleteSuccessByKeySync(dir, entry.changeType, entry.key)),
      applyEntry: deps.applyEntry ?? applyEntryUsingRustRequest,
      evaluateError: deps.evaluateError,
    };
  }

  async replayDir(
    input: DiscoveryReplayDirInput,
  ): Promise<DiscoveryReplayDirResult> {
    const { creature, dataDir, options } = input;
    const config = createNeatConfig(options);
    const verifyScores = config.discoveryReplayVerifyScores;
    const replayConcurrency = verifyScores
      ? config.discoveryReplayConcurrency
      : config.threads;

    const successCacheDir = config.discoverySuccessCacheDir;
    if (!successCacheDir) {
      throw new Error(
        "discoverySuccessCacheDir must be set to use discoveryReplayDir().",
      );
    }

    CreatureUtil.makeUUID(creature);

    // Default evaluation uses workers for speed, but tests can inject an
    // evaluator to keep replay deterministic and fast.
    const workers: WorkerHandler[] = [];

    try {
      if (!this.#deps.evaluateError) {
        const workerCount = replayConcurrency;
        for (let i = 0; i < workerCount; i++) {
          workers.push(
            new WorkerHandler(
              dataDir,
              config.costName as CostName,
              workerCount === 1,
              config.customCost,
            ),
          );
        }
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

      // Load cache entries and prioritise by historical delta.
      const allEntries = deps.listEntries(successCacheDir)
        .filter((e) =>
          typeof e.key === "string" && typeof e.changeType === "string"
        )
        // Do not persist combo entries; replay builds combos on demand from singles.
        .filter((e) => !e.changeType.startsWith("combo-"));

      allEntries.sort((a, b) => {
        const aDelta = safeNumber(a.scoreDelta) ?? 0;
        const bDelta = safeNumber(b.scoreDelta) ?? 0;
        return bDelta - aDelta;
      });

      const selectedEntries = allEntries.slice(
        0,
        config.discoveryReplayMaxSingles,
      );

      let skippedAlreadyApplied = 0;
      let skippedNotApplicable = 0;

      // Apply all singles we can.
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

      const tasksBaselineAndSingles: EvaluationTask[] = [
        { kind: "original", creature },
        ...singleCandidates.map((c) => ({
          kind: "single" as const,
          creature: c.creature,
          entry: c.entry,
          description: c.entry.description,
        })),
      ];

      const evaluatedBaselineAndSingles = await evaluateTasks(
        tasksBaselineAndSingles,
      );

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
      for (const failed of failedSingles) {
        deps.deleteEntry(successCacheDir, failed.entry);
        pruned++;
      }

      // Build combos from still-successful singles.
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

      const comboTasks: EvaluationTask[] = comboCandidates.map((c) => ({
        kind: "combo" as const,
        creature: c.creature,
        description: describeCombo(c.entries),
      }));

      const evaluatedCombos = await evaluateTasks(comboTasks);

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
      };

      if (verifyScores && config.discoveryReplayRescoreBaseline) {
        const claimedScore = parseClaimedTagNumber(creature.tags, "score");
        const claimedError = parseClaimedTagNumber(creature.tags, "error");
        const changed = scoreMeaningfullyDifferent(
          claimedScore,
          originalEval.score,
        );
        const prefix = "🦘";
        const reason = claimedScore === undefined
          ? `${prefix} Baseline rescore: no claimed score tag found, so I rescored on the current dataset (score=${originalEval.score}, error=${originalEval.error}).`
          : `${prefix} Score drift check: claimed score ${claimedScore} (error ${
            claimedError ?? "?"
          }) vs actual score ${originalEval.score} (error ${originalEval.error}) on the current dataset.`;

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
            message: `Verified improvement on current dataset: ${message}`,
            creature: best.creature.exportJSON(),
          };
        }
      }

      return result;
    } finally {
      for (const worker of workers) {
        try {
          worker.terminate();
        } catch {
          // Ignore termination errors.
        }
      }
    }
  }
}
