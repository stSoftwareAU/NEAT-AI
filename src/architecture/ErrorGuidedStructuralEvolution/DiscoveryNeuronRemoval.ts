/**
 * Neuron removal operations for discovery: removing harmful
 * and low-impact neurons based on discovery candidates.
 */

import { addTag, removeTag } from "@stsoftware/tags/mod";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  feedsIfNeuron,
  LOW_IMPACT_BEHAVIOUR_ALLOWANCE,
  verifyBoundedBehaviour,
} from "@architecture/BehaviourGuard.ts";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { corePruneNeuron } from "@wasm/WasmPruneNeuron.ts";
import type { Approach } from "@neat/LogApproach.ts";
import type { CandidateHarmfulNeuron } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import { getLogger } from "@utils/Logger.ts";
import type { RemoveNeuronCompensationData } from "@architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { validateAndFixIfNeeded } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryValidation.ts";
import {
  buildWireToRuntimeIdMap,
  resolveSingleNeuronReference,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";
import { clampAndTrack } from "@utils/OverflowGuardStats.ts";

/** Minimal mutable neuron shape the compensation helper edits (bias fold). */
interface CompensableNeuron {
  uuid?: string;
  bias?: number;
}

/** Minimal mutable synapse shape the compensation helper edits (weight bump). */
interface CompensableSynapse {
  fromUUID?: string;
  toUUID?: string;
  weight: number;
}

/**
 * Fold a removed neuron's mean downstream contribution into its targets' biases
 * (mean-preserving ablation).
 *
 * For each outgoing synapse `X -> T` with weight `w`, removing `X` deletes an
 * average contribution of `w · meanActivation(X)` from `T`'s pre-activation sum;
 * compensate by `T.bias += w · meanActivation` accumulated across all targets.
 * This is the pre-existing "mean-only fold" behaviour. Since Issue #3975 core
 * owns the fold for an uncompensated removal, so the one remaining caller is
 * the variance-aware path below, where the remedy is the caller's own
 * measurement and is applied before core sees the creature (Issue #1691).
 */
function applyMeanBiasFold(
  neurons: CompensableNeuron[],
  synapses: CompensableSynapse[],
  removedNeuronUuid: string,
  meanActivation: number,
  context: string,
): void {
  const outgoing = synapses.filter((s) => s.fromUUID === removedNeuronUuid);
  if (outgoing.length === 0) return;

  const weightSumsByTarget = new Map<string, number>();
  for (const synapse of outgoing) {
    const targetUuid = synapse.toUUID;
    if (!targetUuid || targetUuid === removedNeuronUuid) continue;
    weightSumsByTarget.set(
      targetUuid,
      (weightSumsByTarget.get(targetUuid) ?? 0) + synapse.weight,
    );
  }

  for (const [targetUuid, weightSum] of weightSumsByTarget) {
    const target = neurons.find((n) => n.uuid === targetUuid);
    if (!target) continue;
    target.bias = clampAndTrack(
      (target.bias ?? 0) + (weightSum * meanActivation),
      "rustFfi.bias",
      context,
    );
  }
}

/**
 * Apply the variance-aware remove-neuron compensation emitted by
 * NEAT-AI-Discovery (#1559 weight redistribution / #1623 bias fold) before the
 * neuron and its synapses are deleted (Issue #1691).
 *
 * Routing is mutually exclusive and matches the Discovery-side emission:
 * - **Constant candidate** (`constantNeuronBiasFold`): fold each pre-computed
 *   per-target bias delta into the downstream bias exactly. No mean fold and no
 *   weight bump — a constant neuron carries no per-sample variance, so the fold
 *   is complete on its own.
 * - **Variance-carrying candidate** (`removeNeuronCompensation`): apply the mean
 *   bias fold (when `meanActivation` is available) *and* bump the correlated
 *   survivor's weight into the shared target by `deltaWeight`.
 *
 * The caller is responsible for removing the neuron and its synapses afterwards.
 * Returns which remedy was applied (`"none"` when the payload was empty), so the
 * caller knows whether to hand its mean to core or has already folded it here.
 *
 * @returns `"constant"`, `"variance"`, or `"none"`.
 */
export function applyRemoveNeuronCompensation(
  neurons: CompensableNeuron[],
  synapses: CompensableSynapse[],
  removedNeuronUuid: string,
  meanActivation: number | undefined,
  compensation: RemoveNeuronCompensationData | undefined,
  context: string,
): "constant" | "variance" | "none" {
  const constantFold = compensation?.constantNeuronBiasFold;
  if (constantFold && constantFold.foldedTargets.length > 0) {
    for (const folded of constantFold.foldedTargets) {
      const target = neurons.find((n) => n.uuid === folded.targetNeuronUuid);
      if (!target) continue;
      target.bias = clampAndTrack(
        (target.bias ?? 0) + folded.biasDelta,
        "rustFfi.bias",
        `${context}/constantFold`,
      );
    }
    return "constant";
  }

  const redistribution = compensation?.removeNeuronCompensation;
  if (redistribution) {
    // The redistribution supplements — does not replace — the mean bias fold,
    // so apply the mean fold first when the removed neuron's mean is available.
    if (typeof meanActivation === "number" && Number.isFinite(meanActivation)) {
      applyMeanBiasFold(
        neurons,
        synapses,
        removedNeuronUuid,
        meanActivation,
        context,
      );
    }

    const survivorSynapse = synapses.find(
      (s) =>
        s.fromUUID === redistribution.survivorNeuronUuid &&
        s.toUUID === redistribution.targetNeuronUuid,
    );
    if (survivorSynapse) {
      survivorSynapse.weight = clampAndTrack(
        survivorSynapse.weight + redistribution.deltaWeight,
        "rustFfi.weight",
        `${context}/redistribute`,
      );
    } else {
      // Fail loud rather than silently dropping the remedy: a missing survivor
      // synapse means the emitted compensation cannot be applied as intended.
      getLogger().warn(
        `[${context}] weight redistribution skipped: survivor synapse ` +
          `${redistribution.survivorNeuronUuid} -> ` +
          `${redistribution.targetNeuronUuid} not found`,
      );
    }
    return "variance";
  }

  return "none";
}

/**
 * Remove one hidden neuron through the shared NEAT-AI-core rewrite
 * (Issue #3975).
 *
 * This is the whole of the removal: core cuts the neuron and every edge naming
 * it, folds the caller's mean into each point-wise target's bias, prunes the
 * memetic entries that stop naming live structure, runs its cleanup fixed point
 * over what is left, and validates the stable result before answering. There is
 * no TypeScript rewrite behind it and no fallback to one — a refusal comes back
 * as `undefined`, which the callers read as "no change", exactly as a candidate
 * that failed validation always has.
 *
 * The caller keeps what core deliberately does not own: candidate selection,
 * the Discovery-supplied compensation payload (applied here *before* the
 * rewrite, because it is the caller's own measured remedy), the behaviour
 * guard, and the accept/reject decision.
 *
 * @param exportJSON The creature to rewrite, already deep-copied by the caller.
 * @param neuronLabel Wire UUID of the neuron to remove.
 * @param meanActivation The caller's measured mean, when it has a finite one.
 * @param compensation The Discovery-emitted remedy, when one was supplied.
 * @param context Label used by the overflow guard and the log.
 * @returns The rewritten export, or `undefined` when core refused.
 */
function pruneNeuronThroughCore(
  exportJSON: CreatureExport,
  neuronLabel: string,
  meanActivation: number | undefined,
  compensation: RemoveNeuronCompensationData | undefined,
  context: string,
): CreatureExport | undefined {
  // Issue #1691: the Discovery-emitted remedy is the caller's own measurement,
  // not a rewrite rule, so it is applied to the creature before core sees it.
  // Its variance branch already folds the mean, which is why the mean is not
  // then handed to core as well — that would fold it twice.
  const remedy = (compensation?.constantNeuronBiasFold ||
      compensation?.removeNeuronCompensation)
    ? applyRemoveNeuronCompensation(
      exportJSON.neurons,
      exportJSON.synapses,
      neuronLabel,
      meanActivation,
      compensation,
      context,
    )
    : "none";

  const stats = (remedy === "none" && meanActivation !== undefined)
    ? { meanActivation }
    : undefined;

  const outcome = corePruneNeuron(exportJSON, neuronLabel, stats);
  if (!outcome.ok) {
    getLogger().warn(
      `[${context}] core refused to remove ${neuronLabel}: ` +
        `${outcome.reason} — ${outcome.message}`,
    );
    return undefined;
  }

  // Issue #3975: core tells us when it could not compensate a target, and a
  // removal accepted while carrying that report is a quietly degraded
  // creature. Say so rather than letting an "approximate" rewrite pass as an
  // ordinary success.
  //
  // `NO_STATISTICS` is excluded only when the Discovery remedy above already
  // compensated the creature and the statistics were therefore withheld on
  // purpose: core saying it had no measurement to fold is then the answer we
  // asked for, not a degraded creature. Warning on it would fire on every
  // #1691 removal and train the reader to ignore the real ones. A removal that
  // genuinely had no mean to offer is still reported.
  const degraded = outcome.uncompensated.filter((target) =>
    !(remedy !== "none" && target.reason === "NO_STATISTICS")
  );
  if (degraded.length > 0) {
    const detail = degraded
      .map((t) => `${t.targetUUID} (${t.reason}, ${t.squash})`)
      .join(", ");
    getLogger().warn(
      `[${context}] core removed ${neuronLabel} but could not compensate ` +
        `${degraded.length} target(s): ${detail}`,
    );
  }

  // Issue #2421: core folds the mean faithfully, and this repo additionally
  // caps what a runaway weight x activation product may do. Every bias and
  // weight in the answer is core-authored — the folded biases, the
  // canonicalisation that moves an activation into an outgoing weight, and any
  // correlated-survivor share — so the guard is applied across the whole
  // answer. Creature load clamps again (defence in depth); sweeping the answer
  // here also avoids the earlier per-fold lookup, which silently skipped the
  // clamp whenever a fold named a target the answer did not contain.
  for (const neuron of outcome.creature.neurons) {
    neuron.bias = clampAndTrack(neuron.bias, "rustFfi.bias", context);
  }
  for (const synapse of outcome.creature.synapses) {
    synapse.weight = clampAndTrack(synapse.weight, "rustFfi.weight", context);
  }

  return outcome.creature;
}

/**
 * Removes a harmful neuron from the creature efficiently.
 * This method uses the average activation from discovery records to adjust
 * downstream neurons' biases, then removes all synapses and the neuron itself.
 * This is more efficient than the generic removeNeuron as it uses actual
 * activation data rather than just the bias.
 *
 * @param ID - Unique identifier for the discovery process.
 * @param creature - The Creature instance to modify.
 * @param harmfulNeuron - The harmful neuron candidate to remove.
 * @param discoveryFailureCacheDir - Optional directory to log validation issues.
 * @returns A modified Creature with the neuron removed, or undefined if no change was made.
 */
export function removeHarmfulNeuron(
  ID: string,
  creature: Creature,
  harmfulNeuron?: CandidateHarmfulNeuron,
  discoveryFailureCacheDir?: string,
): Creature | undefined {
  if (!harmfulNeuron) return undefined;

  const creatureUUID = CreatureUtil.makeUUID(creature);
  const exportJSON = creature.exportJSON();
  const wireToId = buildWireToRuntimeIdMap(creature);
  const harmfulNeuronId = resolveSingleNeuronReference(
    wireToId,
    harmfulNeuron.neuronUuid,
  );
  if (harmfulNeuronId === undefined) {
    return undefined;
  }
  const harmfulNeuronLabel = harmfulNeuron.neuronUuid;

  // Check if neuron exists
  const neuronToRemove = exportJSON.neurons.find(
    (neuron) => neuron.uuid === harmfulNeuronLabel,
  );
  if (!neuronToRemove) {
    return undefined; // Neuron doesn't exist, nothing to remove
  }

  // Don't remove output neurons (input neurons don't exist in this type system)
  if (neuronToRemove.type === "output") {
    return undefined;
  }

  // Create a deep copy to modify
  const simplifiedExport: typeof exportJSON = JSON.parse(
    JSON.stringify(exportJSON),
  );

  const averageActivation = harmfulNeuron.averageActivation;
  // A measurement that is not a number cannot compensate anything, and folding
  // it would poison every downstream bias. Refuse the removal instead.
  if (!Number.isFinite(averageActivation)) {
    getLogger().warn(
      `[removeHarmfulNeuron] refusing ${harmfulNeuronLabel}: ` +
        `averageActivation is ${averageActivation}`,
    );
    return undefined;
  }

  const prunedExport = pruneNeuronThroughCore(
    simplifiedExport,
    harmfulNeuronLabel,
    averageActivation,
    harmfulNeuron.compensation,
    "removeHarmfulNeuron",
  );
  if (!prunedExport) return undefined;

  const tmpCreature = Creature.fromJSON(prunedExport);
  // We modified the structure, so we must delete UUID
  delete tmpCreature.uuid;

  // Validate and fix if needed
  const validationResult = validateAndFixIfNeeded(
    tmpCreature,
    creature,
    ID,
    "remove-neuron",
    harmfulNeuron,
    discoveryFailureCacheDir,
  );
  if (!validationResult.success) {
    return undefined;
  }

  if (
    removalBreaksIfRouting(
      "removeHarmfulNeuron",
      creature,
      exportJSON,
      tmpCreature,
      harmfulNeuronLabel,
    )
  ) {
    return undefined;
  }

  const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
  if (tmpUUID !== creatureUUID) {
    addTag(tmpCreature, "approach", "discovery" as Approach);
    addTag(tmpCreature, "discoveryID", ID);
    const summary = `🗑️ Removed harmful neuron ${harmfulNeuronLabel} (error: ${
      harmfulNeuron.errorMagnitude.toExponential(2)
    }, avg activation: ${averageActivation.toFixed(4)})`;
    addTag(tmpCreature, "Discovery", summary);
    removeTag(tmpCreature, "approach-logged");

    return tmpCreature;
  }
  return undefined;
}

// Track removal diagnostics across calls (static to aggregate across multiple removals)
const removalDiagnostics = {
  sameUUIDCount: 0,
  firstSameUUIDLogged: false,
};

/**
 * Removes a low-impact neuron from the creature.
 * Unlike removeHarmfulNeuron, this doesn't require averageActivation for bias adjustment
 * since low-impact neurons (by definition) have negligible effect on downstream neurons.
 *
 * @param ID - Unique identifier for the discovery process.
 * @param creature - The Creature instance to modify.
 * @param removalCandidate - The low-impact neuron candidate to remove.
 * @param discoveryFailureCacheDir - Optional directory to log validation issues.
 * @returns A modified Creature with the neuron removed, or undefined if no change was made.
 */
export function removeLowImpactNeuron(
  ID: string,
  creature: Creature,
  removalCandidate?: import("./DiscoverResult.ts").RemovalCandidate,
  discoveryFailureCacheDir?: string,
): Creature | undefined {
  if (!removalCandidate) return undefined;

  const creatureUUID = CreatureUtil.makeUUID(creature);
  const exportJSON = creature.exportJSON();
  const wireToId = buildWireToRuntimeIdMap(creature);
  const removalNeuronId = resolveSingleNeuronReference(
    wireToId,
    removalCandidate.neuronUuid,
  );
  if (removalNeuronId === undefined) {
    return undefined;
  }
  const removalLabel = removalCandidate.neuronUuid;

  // Check if neuron exists
  const neuronToRemove = exportJSON.neurons.find(
    (neuron) => neuron.uuid === removalLabel,
  );
  if (!neuronToRemove) {
    return undefined; // Neuron doesn't exist, nothing to remove
  }

  // Don't remove output neurons
  if (neuronToRemove.type === "output") {
    return undefined;
  }

  // Create a deep copy to modify
  const simplifiedExport: typeof exportJSON = JSON.parse(
    JSON.stringify(exportJSON),
  );

  const originalSynapseCount = simplifiedExport.synapses.length;
  const originalNeuronCount = simplifiedExport.neurons.length;

  // Bias compensation (average-preserving ablation) is core's, not this file's:
  // for each outgoing synapse X -> T with weight w, removing X deletes an
  // average contribution of (w * meanActivation(X)) from T's pre-activation
  // sum, and core folds that back into T's bias.
  const meanActivation = removalCandidate.meanActivation;
  const finiteMean =
    typeof meanActivation === "number" && Number.isFinite(meanActivation)
      ? meanActivation
      : undefined;

  const prunedExport = pruneNeuronThroughCore(
    simplifiedExport,
    removalLabel,
    finiteMean,
    removalCandidate.compensation,
    "removeLowImpactNeuron",
  );
  if (!prunedExport) return undefined;

  const removedSynapseCount = originalSynapseCount -
    prunedExport.synapses.length;
  const removedNeuronCount = originalNeuronCount -
    prunedExport.neurons.length;

  const tmpCreature = Creature.fromJSON(prunedExport);
  // We modified the structure, so we must delete UUID
  delete tmpCreature.uuid;

  // Validate and fix if needed
  const validationResult = validateAndFixIfNeeded(
    tmpCreature,
    creature,
    ID,
    "remove-low-impact",
    removalCandidate,
    discoveryFailureCacheDir,
  );
  if (!validationResult.success) {
    return undefined;
  }

  // Check if fix() re-added any structure
  const afterFixSynapseCount = tmpCreature.synapses.length;
  const afterFixNeuronCount = tmpCreature.neurons.length;
  const fixReaddedSynapses = afterFixSynapseCount -
    prunedExport.synapses.length;
  const fixReaddedNeurons = afterFixNeuronCount -
    prunedExport.neurons.length;

  if (
    removalBreaksIfRouting(
      "removeLowImpactNeuron",
      creature,
      exportJSON,
      tmpCreature,
      removalLabel,
    )
  ) {
    return undefined;
  }

  const tmpUUID = CreatureUtil.makeUUID(tmpCreature);
  if (tmpUUID !== creatureUUID) {
    // Reset diagnostics on successful removal
    removalDiagnostics.sameUUIDCount = 0;
    removalDiagnostics.firstSameUUIDLogged = false;

    addTag(tmpCreature, "approach", "discovery" as Approach);
    addTag(tmpCreature, "discoveryID", ID);
    const summary = `🪶 Removed low-impact neuron ${removalLabel} (error: ${
      removalCandidate.totalError.toFixed(4)
    }, impact: ${(removalCandidate.impact * 100).toFixed(2)}%)`;
    addTag(tmpCreature, "Discovery", summary);
    removeTag(tmpCreature, "approach-logged");

    return tmpCreature;
  }

  // UUID didn't change - track this case
  removalDiagnostics.sameUUIDCount++;

  // Log detailed diagnostics for first occurrence only
  if (!removalDiagnostics.firstSameUUIDLogged) {
    removalDiagnostics.firstSameUUIDLogged = true;
    getLogger().warn(
      `[DiscoverStructure] removeLowImpactNeuron UUID unchanged after removal:`,
      `\n  neuronId: ${removalLabel}`,
      `\n  removedSynapses: ${removedSynapseCount}, removedNeurons: ${removedNeuronCount}`,
      `\n  fix() re-added: synapses=${fixReaddedSynapses}, neurons=${fixReaddedNeurons}`,
      `\n  originalUUID: ${creatureUUID}`,
      `\n  newUUID: ${tmpUUID}`,
    );
  }

  return undefined;
}

/**
 * Issue #3840: reject a removal whose "impact" metric cannot see what it is
 * about to destroy.
 *
 * A neuron feeding an `IF` supplies a routing decision, not an additive
 * contribution: an `IF` node's threshold and leaf values ride as weights on
 * shared bias-1 constants, and one such constant can back hundreds of nodes.
 * Its contribution to any activation *sum* is ~0 — so every magnitude-based
 * impact metric scores it at 0.00% — while deleting it flips or breaks the
 * routing of every node reading it. Field evidence on Issue #3840: a removal
 * reported at `impact: 0.00%` cost 0.118 of score.
 *
 * So when the candidate feeds an `IF`, the claim is verified rather than
 * trusted: the candidate creature is activated alongside the original over a
 * deterministic probe matrix, and the removal is refused when the outputs moved
 * further than {@link LOW_IMPACT_BEHAVIOUR_ALLOWANCE} — a bound generous enough
 * to catch gross breakage (flipped routing, a dropped branch) without policing
 * the fine drift a mean-preserving ablation is entitled to. A candidate that
 * feeds no `IF` never reaches an activation here.
 *
 * @returns `true` when the removal must be abandoned.
 */
function removalBreaksIfRouting(
  context: string,
  original: Creature,
  originalExport: ReturnType<Creature["exportJSON"]>,
  candidate: Creature,
  removedNeuronUuid: string,
): boolean {
  if (!feedsIfNeuron(originalExport, removedNeuronUuid)) return false;

  return !verifyBoundedBehaviour(
    original,
    candidate,
    LOW_IMPACT_BEHAVIOUR_ALLOWANCE,
    `${context}(${removedNeuronUuid})`,
  );
}

/** Reset removal diagnostics (call at start of discovery to get fresh stats). */
export function resetRemovalDiagnostics(): void {
  removalDiagnostics.sameUUIDCount = 0;
  removalDiagnostics.firstSameUUIDLogged = false;
}

/** Get count of removals that failed due to same UUID. */
export function getRemovalSameUUIDCount(): number {
  return removalDiagnostics.sameUUIDCount;
}
