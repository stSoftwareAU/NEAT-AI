/**
 * PruningTemplate.ts — Pruning template primitive (Issue #2495).
 *
 * Use the compact Europa creature as a pruning template — production hidden
 * neurons whose role is already covered by Europa's smaller equivalent are
 * candidates for removal, shrinking production toward a denser representation
 * without losing score.
 *
 * Distinct from `CompactModuleGraft` (#2493) and `KnowledgeDistillation`
 * (#2494): instead of moving Europa's structure or behaviour across, we use
 * Europa as an oracle to identify which production neurons are redundant and
 * remove them — Europa is *not* mutated and contributes no neurons or
 * synapses to the recipient.
 *
 * Procedure:
 *
 *   1. Build an activation fingerprint per hidden neuron in both creatures
 *      on the same probe dataset (per-row activation vector).
 *   2. Mark each production hidden neuron as a removal candidate when its
 *      fingerprint correlates highly with at least one Europa neuron's
 *      fingerprint — i.e. some Europa neuron already supplies the same signal.
 *   3. Validate-then-commit: try removing each candidate one at a time. The
 *      removal commits only when the recipient's score on the probe dataset
 *      does not drop below the configured tolerance (default 0% drop).
 *      Otherwise the candidate is rolled back from a pre-removal snapshot.
 *
 * UUID stability: surviving recipient neurons keep their original `uuid`
 * (per the AGENTS.md neuron UUID stability invariant). The orphaned-neuron
 * cleanup that runs after each removal uses the existing
 * `removeHiddenNeuron` plumbing from `compact/OrphanedNeuronCleanup.ts` so
 * that integer-id remapping is correct and the same defences applied to the
 * compaction pipeline (cache clears, memetic invalidation) apply here too.
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { removeHiddenNeuron } from "@compact/OrphanedNeuronCleanup.ts";
import { MSE } from "@costs/MSE.ts";
import type { SparseConfigLike } from "@propagate/sparse/SparseConfigLike.ts";
import type {
  DnaSharingPrepareOptions,
  DnaSharingStrategy,
} from "./DnaSharingStrategy.ts";

/**
 * Trace-all SparseConfig stub for {@link buildActivationFingerprints}. The
 * fingerprint pass needs `state.activations` populated for every hidden
 * neuron — `activateAndTrace` does that via the WASM trace path. We don't
 * actually backpropagate here, so the stub trivially returns `true` for
 * every gate. Same shape as `SparseConfigLike` consumers elsewhere
 * (see `src/propagate/sparse/SparseConfigLike.ts`).
 */
const FINGERPRINT_TRACE_ALL: SparseConfigLike = {
  traceNeeded: () => true,
  propagateNeeded: () => true,
  updateNeeded: () => true,
};

/**
 * Default Pearson-style absolute correlation threshold above which a
 * production neuron is considered redundantly covered by an Europa neuron.
 * 0.95 is conservative — only nearly identical activation patterns count.
 */
const DEFAULT_CORRELATION_THRESHOLD = 0.95;
/**
 * Default tolerance — fraction of the working score that the trial score is
 * allowed to drop by before the candidate is rolled back. Zero means a
 * candidate is committed only if the score does not regress at all.
 */
const DEFAULT_TOLERANCE = 0;
/** Hard cap on candidates considered, to keep wall-clock bounded. */
const DEFAULT_MAX_CANDIDATES = 64;

/** Options for {@link pruningTemplate}. */
export interface PruningTemplateOptions {
  /** Probe dataset; activation fingerprints and scoring use this. */
  probe: DataRecordInterface[];
  /**
   * Correlation threshold (0..1) above which a production neuron is treated
   * as redundantly covered. Default {@link DEFAULT_CORRELATION_THRESHOLD}
   * (0.95). Values <= 0 disable the redundancy gate (every hidden neuron
   * becomes a candidate).
   */
  correlationThreshold?: number;
  /**
   * Score-drop tolerance (fractional). A candidate removal commits when
   * `trialScore >= workingScore - tolerance * |workingScore|`. Default
   * {@link DEFAULT_TOLERANCE} (0 — any drop rolls back).
   */
  tolerance?: number;
  /**
   * Hard cap on candidates considered per call. Default
   * {@link DEFAULT_MAX_CANDIDATES} (64). Candidates are sorted by
   * descending correlation so the strongest matches are tried first.
   */
  maxCandidates?: number;
}

/**
 * Build an activation fingerprint per hidden neuron in `creature` against
 * `probe`. Each fingerprint is a length-`probe.length` Float32Array of the
 * neuron's per-row activation. Non-finite values are coerced to zero so
 * downstream correlation maths stays finite.
 */
export function buildActivationFingerprints(
  creature: Creature,
  probe: DataRecordInterface[],
): Map<string, Float32Array> {
  const fingerprints = new Map<string, Float32Array>();
  if (probe.length === 0) return fingerprints;

  // Snapshot each hidden neuron's runtime index up-front.
  const hiddenIndices: Array<{ uuid: string; index: number }> = [];
  for (const n of creature.neurons) {
    if (
      n.type === "hidden" &&
      typeof n.uuid === "string" &&
      typeof n.index === "number"
    ) {
      hiddenIndices.push({ uuid: n.uuid, index: n.index });
      fingerprints.set(n.uuid, new Float32Array(probe.length));
    }
  }
  if (hiddenIndices.length === 0) return fingerprints;

  for (let i = 0; i < probe.length; i++) {
    // `activateAndTrace` populates `state.activations[index]` for every
    // non-input neuron (see `CreatureActivation.activateAndTraceWasm`). The
    // plain `activate` path returns the output buffer only, leaving hidden
    // activations unobservable from TypeScript.
    creature.activateAndTrace(probe[i].input, false, FINGERPRINT_TRACE_ALL);
    const acts = creature.state.activations;
    for (const { uuid, index } of hiddenIndices) {
      const v = acts[index];
      fingerprints.get(uuid)![i] = Number.isFinite(v) ? v : 0;
    }
  }
  return fingerprints;
}

/**
 * Pearson-style absolute correlation between two equal-length fingerprints.
 *
 * Returns 0 when either vector is constant (no signal), and the absolute
 * value of the Pearson coefficient otherwise. Sign-flipped correlation
 * still implies the same information content (modulo a downstream weight
 * sign), so we treat it as redundantly covered.
 */
export function fingerprintCorrelation(
  a: Float32Array,
  b: Float32Array,
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < a.length; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= a.length;
  meanB /= a.length;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    dot += da * db;
    normA += da * da;
    normB += db * db;
  }
  const denom = Math.sqrt(normA * normB);
  if (denom === 0 || !Number.isFinite(denom)) return 0;
  const r = dot / denom;
  return Number.isFinite(r) ? Math.abs(r) : 0;
}

/**
 * For each recipient hidden neuron, find the donor neuron whose fingerprint
 * most closely matches it. Returns candidates ordered by descending best
 * correlation (strongest matches first), filtered to those at or above the
 * given `threshold`.
 */
export function findRedundantHiddenNeurons(
  recipient: Creature,
  donor: Creature,
  probe: DataRecordInterface[],
  options: { correlationThreshold?: number } = {},
): Array<{ uuid: string; correlation: number }> {
  const threshold = options.correlationThreshold ??
    DEFAULT_CORRELATION_THRESHOLD;
  const recipientFps = buildActivationFingerprints(recipient, probe);
  const donorFps = buildActivationFingerprints(donor, probe);

  const candidates: Array<{ uuid: string; correlation: number }> = [];
  for (const [uuid, recipFp] of recipientFps) {
    let best = 0;
    for (const donorFp of donorFps.values()) {
      const r = fingerprintCorrelation(recipFp, donorFp);
      if (r > best) best = r;
    }
    if (best >= threshold) candidates.push({ uuid, correlation: best });
  }
  candidates.sort((a, b) => b.correlation - a.correlation);
  return candidates;
}

/**
 * Score `creature` against `probe` as `-MSE`. Higher is better.
 *
 * Mirrors `DnaSharingBakeOff.scoreOnProbe` so the validate-then-commit gate
 * compares against the same metric the bake-off harness reports. Kept
 * private to avoid an additional cross-module import cycle.
 */
function scoreOnProbe(
  creature: Creature,
  probe: DataRecordInterface[],
): number {
  if (probe.length === 0) return 0;
  const cost = new MSE();
  let totalError = 0;
  for (const sample of probe) {
    const output = creature.activate(sample.input, false);
    totalError += cost.calculate(sample.output, output);
  }
  return -(totalError / probe.length);
}

/** Validate `creature` honouring its `forwardOnly` flag. Returns whether it passed. */
function tryValidate(
  creature: Creature,
  forwardOnly: boolean | undefined,
): boolean {
  try {
    if (forwardOnly) {
      creatureValidate(creature, { forwardOnly: true });
    } else {
      creatureValidate(creature);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Restore `live` to the state captured in `snapshot`. Used to roll back a
 * rejected candidate removal — `loadFrom` is the same plumbing the rest of
 * the pipeline uses for in-place state replacement.
 */
function rollback(live: Creature, snapshot: CreatureExport): void {
  live.loadFrom(snapshot, false, "transfer:pruningTemplate:rollback");
}

/**
 * Result of a pruning-template run. `removedUuids` lists the production
 * neuron UUIDs that were committed; the working creature is mutated in
 * place (or returned by {@link pruningTemplate}). Useful for tests and
 * harness diagnostics.
 */
export interface PruningTemplateResult {
  /** Production hidden-neuron UUIDs that were committed for removal. */
  removedUuids: string[];
  /** Production candidates that were considered but rolled back on score regression. */
  rolledBackUuids: string[];
  /** Score of the recipient before any removal. */
  initialScore: number;
  /** Score of the recipient after all committed removals. */
  finalScore: number;
}

/**
 * Identify production hidden neurons whose role is redundantly covered by
 * Europa's smaller equivalent and remove them, validate-then-commit.
 * Returns the pruned creature, or `undefined` when:
 *
 * - The probe is empty.
 * - No candidates clear the correlation threshold.
 * - Every candidate removal regresses the score beyond tolerance.
 *
 * The recipient's pre-existing neuron `uuid`s are preserved verbatim for
 * surviving neurons (per the AGENTS.md UUID stability invariant). Donor
 * neurons are *not* added — Europa is only used as an oracle here.
 */
export function pruningTemplate(
  recipient: Creature,
  donor: Creature,
  options: PruningTemplateOptions,
): { creature: Creature; result: PruningTemplateResult } | undefined {
  if (options.probe.length === 0) return undefined;

  const correlationThreshold = options.correlationThreshold ??
    DEFAULT_CORRELATION_THRESHOLD;
  const tolerance = Math.max(0, options.tolerance ?? DEFAULT_TOLERANCE);
  const maxCandidates = Math.max(
    1,
    options.maxCandidates ?? DEFAULT_MAX_CANDIDATES,
  );

  const candidates = findRedundantHiddenNeurons(
    recipient,
    donor,
    options.probe,
    {
      correlationThreshold,
    },
  ).slice(0, maxCandidates);
  if (candidates.length === 0) return undefined;

  // Work on a fresh clone so the caller's recipient is left untouched until
  // we can return a successful pruned creature. The harness adapter
  // (`PruningTemplateStrategy.prepare`) commits the result back via
  // `loadFrom` only on success.
  const recipientExport = recipient.exportJSON();
  const working = Creature.fromJSON(recipientExport);
  if (recipientExport.forwardOnly) working.fix({ forwardOnly: true });
  else working.fix();

  const initialScore = scoreOnProbe(working, options.probe);
  let workingScore = initialScore;

  const removedUuids: string[] = [];
  const rolledBackUuids: string[] = [];

  for (const { uuid } of candidates) {
    // Snapshot the working state so we can roll back a regression cleanly.
    const snapshot = working.exportJSON();

    // Locate the candidate by UUID in the live (post-removals) topology.
    const target = working.neurons.find((n) =>
      n.type === "hidden" && n.uuid === uuid
    );
    if (!target) continue;

    try {
      removeHiddenNeuron(working, target.index);
      if (snapshot.forwardOnly) working.fix({ forwardOnly: true });
      else working.fix();
    } catch {
      rollback(working, snapshot);
      continue;
    }

    if (!tryValidate(working, snapshot.forwardOnly)) {
      rollback(working, snapshot);
      continue;
    }

    const trialScore = scoreOnProbe(working, options.probe);
    const allowedDrop = tolerance * Math.abs(workingScore);
    // Score is `-MSE`, higher is better. A "drop" is `workingScore - trialScore`.
    if (workingScore - trialScore > allowedDrop) {
      rollback(working, snapshot);
      rolledBackUuids.push(uuid);
      continue;
    }

    removedUuids.push(uuid);
    workingScore = trialScore;
  }

  if (removedUuids.length === 0) return undefined;

  // Final defensive validation. A lingering invalid state here is a bug.
  if (!tryValidate(working, recipientExport.forwardOnly)) return undefined;

  return {
    creature: working,
    result: {
      removedUuids,
      rolledBackUuids,
      initialScore,
      finalScore: workingScore,
    },
  };
}

/**
 * `DnaSharingStrategy` adapter for the bake-off harness.
 *
 * Calling `prepare(recipient, donor)` runs {@link pruningTemplate} and, on
 * success, mutates the recipient in place via `loadFrom` so the harness
 * proceeds with the pruned topology. On rejection (no candidates, every
 * removal regresses, or `creatureValidate` fails) the recipient is left
 * untouched and the row shows zero structural change.
 */
export class PruningTemplateStrategy implements DnaSharingStrategy {
  readonly name = "PruningTemplate";

  constructor(private readonly opts: PruningTemplateOptions) {}

  prepare(
    recipient: Creature,
    donor: Creature,
    _options: DnaSharingPrepareOptions,
  ): Promise<void> {
    const outcome = pruningTemplate(recipient, donor, this.opts);
    if (outcome) {
      recipient.loadFrom(
        outcome.creature.exportJSON(),
        false,
        "transfer:pruningTemplate",
      );
    }
    return Promise.resolve();
  }
}
