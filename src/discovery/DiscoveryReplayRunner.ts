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
import type {
  CoordinatedStructuralCandidate,
} from "../architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import {
  applyCoordinatedStructuralCandidate,
} from "../architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import { calculate as calculateScore } from "../architecture/Score.ts";
import { createNeatConfig } from "../config/NeatConfig.ts";
import type { NeatOptions } from "../config/NeatOptions.ts";
import type { Creature } from "../Creature.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { formatWeight } from "./FailureCache.ts";
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

export interface DiscoveryReplayDiagnostics {
  /**
   * Timing breakdown in milliseconds. Values are best-effort and intended for
   * visibility (where time is being spent), not micro-benchmarking.
   */
  timingsMS: {
    total?: number;
    setupWorkers?: number;
    listEntries?: number;
    sortEntries?: number;
    applySingles?: number;
    evaluateBaselineAndSingles?: number;
    buildCombos?: number;
    evaluateCombos?: number;
    selectBest?: number;
    teardownWorkers?: number;
  };
  counts: {
    workerCount: number;
    entriesLoaded: number;
    singlesApplied: number;
    singlesEvaluated: number;
    combosBuilt: number;
    combosEvaluated: number;
    pruned: number;
    skippedAlreadyApplied: number;
    skippedNotApplicable: number;
  };
}

export interface DiscoveryReplayDirResult {
  original: {
    error: number;
    score: number;
  };
  diagnostics?: DiscoveryReplayDiagnostics;
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

/**
 * Whether a claimed score (e.g. from tags) differs meaningfully from a re-computed score.
 * Uses a relaxed relative threshold so we do not report drift from normal floating-point
 * and string round-trip noise.
 *
 * Post-WASM migration, small differences are expected because: (1) WASM activation uses
 * f32 in Rust, so results can differ at the last few bits from pre-migration f64 JS or
 * between main-thread and worker WASM instances; (2) worker evaluation rebuilds the
 * creature from JSON, so weight/bias round-trip can introduce sub-ulp differences;
 * (3) the claimed score is stored via number.toString(), which can round when parsed back.
 */
function scoreMeaningfullyDifferent(
  claimed: number | undefined,
  actual: number,
): boolean {
  if (claimed === undefined) return false;
  if (!Number.isFinite(actual)) return true;
  const absDiff = Math.abs(claimed - actual);
  if (absDiff <= 1e-12) return false;
  const denom = Math.max(1, Math.abs(claimed), Math.abs(actual));
  return absDiff / denom > 1e-6;
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

function nearlyEqual(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const diff = Math.abs(a - b);
  if (diff <= 1e-12) return true;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return diff <= 1e-7 * scale;
}

type SetWeightOp = {
  type: "setWeight";
  fromNeuronUuid: string;
  toNeuronUuid: string;
  weight: number;
};

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

  // Coordinated structural candidates are multi-op groups and may not be
  // trivially “already applied” (eg remove/remove/add sequences).
  // We treat them as already applied only when we can verify every operation.
  if (type === "coordinated-structural") {
    const spec = req.coordinatedStructuralCandidate as
      | CoordinatedStructuralCandidate
      | undefined;
    const ops = spec?.operations;
    if (!Array.isArray(ops) || ops.length === 0) return false;

    // Reduce the ordered operation list into a final expected state per edge.
    // This handles weight adjustments that Rust expresses as remove+add on the
    // same synapse: the last op wins.
    const expectedByEdge = new Map<
      string,
      { present: boolean; weight?: number }
    >();
    const edgeKey = (fromUUID: string, toUUID: string): string =>
      `${fromUUID}\0${toUUID}`;

    for (const op of ops) {
      if (!op || typeof op.type !== "string") return false;
      if (op.type === "removeSynapse") {
        expectedByEdge.set(edgeKey(op.fromNeuronUuid, op.toNeuronUuid), {
          present: false,
        });
        continue;
      }
      if (op.type === "addSynapse") {
        expectedByEdge.set(edgeKey(op.fromNeuronUuid, op.toNeuronUuid), {
          present: true,
          weight: op.weight,
        });
        continue;
      }
      if ((op.type as string) === "setWeight") {
        const set = op as unknown as SetWeightOp;
        const key = edgeKey(set.fromNeuronUuid, set.toNeuronUuid);
        const existing = expectedByEdge.get(key);
        // setWeight is a no-op if the synapse doesn't exist. If the edge is
        // already marked as absent (from a prior removeSynapse), leave it absent.
        if (existing?.present === false) {
          // No-op: leave the edge as absent.
          continue;
        }
        // Otherwise, update the weight (synapse must be present).
        expectedByEdge.set(key, {
          present: true,
          weight: set.weight,
        });
        continue;
      }
      // Unknown op: do not assume applied.
      return false;
    }

    const exported = creature.exportJSON();
    for (const [key, expected] of expectedByEdge.entries()) {
      const [fromUUID, toUUID] = key.split("\0");
      const synapse = exported.synapses.find((s) =>
        s.fromUUID === fromUUID && s.toUUID === toUUID
      );

      if (!expected.present) {
        if (synapse) return false;
        continue;
      }

      if (!synapse) return false;
      if (expected.weight === undefined) return false;
      if (!nearlyEqual(synapse.weight, expected.weight)) return false;
    }

    return true;
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
    case "coordinated-structural": {
      const coordinated = req.coordinatedStructuralCandidate as
        | CoordinatedStructuralCandidate
        | undefined;
      if (!coordinated) return undefined;
      return applyCoordinatedStructuralCandidate(baseCreature, coordinated);
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
    const diagnosticsEnabled =
      (config as unknown as { discoveryReplayDiagnostics?: boolean })
        .discoveryReplayDiagnostics ?? false;
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
        const setupStart = diagnosticsEnabled ? performance.now() : 0;
        for (let i = 0; i < workerCount; i++) {
          const preferDirect = workerCount === 1;
          let w = new WorkerHandler(
            dataDir,
            config.costName as CostName,
            preferDirect,
            config.customCost,
          );
          try {
            // Warm worker sequentially to avoid cold-cache download storms and
            // to ensure only usable workers are added to the pool.
            // deno-lint-ignore no-await-in-loop
            await w.waitUntilReady();
          } catch (err) {
            try {
              w.terminate();
            } catch {
              // Ignore termination errors.
            }
            if (!preferDirect) {
              console.warn(
                "[DiscoveryReplayRunner] Worker init failed; falling back to direct execution for this worker slot.",
                err,
              );
              w = new WorkerHandler(
                dataDir,
                config.costName as CostName,
                true,
                config.customCost,
              );
              // deno-lint-ignore no-await-in-loop
              await w.waitUntilReady();
            } else {
              throw err;
            }
          }
          workers.push(w);
        }
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
