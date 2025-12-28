import { assertExists } from "@std/assert";
import type { CostName } from "../Costs.ts";
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
  improvement?: {
    key?: string;
    changeType: string;
    error: number;
    score: number;
    scoreDelta: number;
    message: string;
    creature: unknown;
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

async function evaluateAll(
  workers: WorkerHandler[],
  tasks: EvaluationTask[],
  feedbackLoop: boolean,
  costOfGrowth: number,
): Promise<Array<EvaluationTask & { error: number; score: number }>> {
  const queue = tasks.slice();
  const results: Array<EvaluationTask & { error: number; score: number }> = [];

  const processNext = async (worker: WorkerHandler): Promise<void> => {
    const task = queue.shift();
    if (!task) return;

    const response = await worker.evaluate(task.creature, feedbackLoop);
    assertExists(
      response.evaluate,
      "Worker did not return evaluation data.",
    );
    const error = response.evaluate.error;
    const score = calculateScore(task.creature, error, costOfGrowth);
    results.push({ ...task, error, score });

    await processNext(worker);
  };

  await Promise.all(workers.map((worker) => processNext(worker)));
  return results;
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
  count: number,
  maxPairwise: number,
  maxTriples: number,
): number[][] {
  const combos: number[][] = [];
  if (count < 2) return combos;

  // All.
  combos.push(Array.from({ length: count }, (_, i) => i));

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
        const workerCount = config.threads;
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

      const evaluateViaWorkers = async (
        c: Creature,
        feedbackLoop: boolean,
        costOfGrowth: number,
      ) => {
        const tasks: EvaluationTask[] = [{ kind: "single", creature: c }];
        const evaluated = await evaluateAll(
          workers,
          tasks,
          feedbackLoop,
          costOfGrowth,
        );
        return { error: evaluated[0].error, score: evaluated[0].score };
      };

      const deps = {
        ...this.#deps,
        evaluateError: this.#deps.evaluateError ?? evaluateViaWorkers,
      };

      // Evaluate original first.
      const originalEval = await deps.evaluateError(
        creature,
        config.feedbackLoop,
        config.costOfGrowth,
      );

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

      // Evaluate all singles in parallel (workers) or via injected evaluator (tests).
      const singleResults = this.#deps.evaluateError
        ? await Promise.all(
          singleCandidates.map(async (c) => {
            const evalResult = await deps.evaluateError(
              c.creature,
              config.feedbackLoop,
              config.costOfGrowth,
            );
            return {
              entry: c.entry,
              creature: c.creature,
              ...evalResult,
              scoreDelta: evalResult.score - originalEval.score,
            };
          }),
        )
        : (await evaluateAll(
          workers,
          singleCandidates.map((c) => ({
            kind: "single" as const,
            creature: c.creature,
            entry: c.entry,
            description: c.entry.description,
          })),
          config.feedbackLoop,
          config.costOfGrowth,
        )).map((r) => ({
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
        successfulSingles.length,
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

      const comboResults = this.#deps.evaluateError
        ? await Promise.all(
          comboCandidates.map(async (c) => {
            const evalResult = await deps.evaluateError(
              c.creature,
              config.feedbackLoop,
              config.costOfGrowth,
            );
            return {
              creature: c.creature,
              entries: c.entries,
              ...evalResult,
              scoreDelta: evalResult.score - originalEval.score,
            };
          }),
        )
        : (await evaluateAll(
          workers,
          comboCandidates.map((c) => ({
            kind: "combo" as const,
            creature: c.creature,
            description: describeCombo(c.entries),
          })),
          config.feedbackLoop,
          config.costOfGrowth,
        )).map((r, i) => ({
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

      allEvaluated.sort((a, b) => (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0));
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
