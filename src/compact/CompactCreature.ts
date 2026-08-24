import { assert } from "@std/assert";
import { addTag, removeTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { Approach } from "@neat/LogApproach.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { COMPLEMENT } from "@methods/activations/types/COMPLEMENT.ts";
import { isAggregationSquash } from "@methods/activations/SquashUtils.ts";
import {
  cleanupOrphanedNeurons,
  cloneCreatureExport,
  pruneDeadSubgraphs,
  pruneZeroWeightSynapses,
} from "@compact/CompactUtils.ts";
import { assertValidSynapseReferences } from "@architecture/AssertValidSynapseReferences.ts";
import { mergeParallelBridges } from "@compact/ParallelBridgeMerge.ts";
import { simplifyLargeWeights } from "@compact/SimplifyLargeWeights.ts";
import { foldConstants } from "@compact/ConstantFold.ts";
import { mergeRedundantConstants } from "@compact/ConstantMerge.ts";
import { aggressivePrune } from "@compact/AggressivePrune.ts";
import { collapseConstantIf } from "@compact/IfCollapse.ts";
import { removeBackwardSynapses } from "@compact/RemoveBackwardSynapses.ts";
import {
  hasRoleTypedIfStructure,
  verifyExactBehaviour,
} from "@architecture/BehaviourGuard.ts";
import { mergeTagsByNameValue } from "@utils/TagUtils.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { exportJSONUnchecked } from "@creature/CreatureSerialization.ts";
import type { CompactVariants } from "@compact/CompactVariants.ts";

/**
 * Produce both compaction candidates for a creature (Issue #3037).
 *
 * The `safe` variant is the result of all exact, behaviour-preserving folds
 * (the long-standing {@link compactCreature} output). The `aggressive` variant
 * (Issue #3038) is the safe folds plus a dataset-free structural prune of
 * low-impact synapses — including those feeding aggregate consumers and
 * non-constant neurons that the safe pass must leave untouched. It is built on
 * top of the safe variant, so it is never structurally worse than safe. When
 * the prune finds nothing the two are identical and dedupe via UUID downstream,
 * so the duplicate is never scored.
 *
 * @param creature - The creature to compact
 * @param feedbackLoop - Whether to use a feedback loop during compaction
 * @param mcmcTemperature - Issue #2200: Optional MCMC temperature for probabilistic
 *   weight rescaling acceptance. When provided, worsening rescalings may be accepted
 *   with probability exp(-delta / temperature) instead of greedy rejection.
 * @returns The safe and aggressive candidates; either is absent when no
 *   compaction occurred.
 */
export function compactCreatureVariants(
  creature: Creature,
  feedbackLoop: boolean,
  mcmcTemperature?: number,
): CompactVariants {
  const safe = buildSafeCompact(creature, feedbackLoop, mcmcTemperature);
  if (!safe) return {};

  // Issue #3038: build the aggressive candidate on top of the safe floor by
  // speculatively pruning low-impact structure. When the prune finds nothing,
  // it returns the safe creature unchanged; identical variants then dedupe via
  // UUID downstream so the duplicate is never scored.
  const aggressive = buildAggressiveCompact(safe) ?? safe;
  return { safe, aggressive };
}

/**
 * Build the aggressive compaction candidate (Issue #3038): the safe variant
 * plus a dataset-free structural prune of low-impact synapses. Returns a new
 * creature only when the prune actually changed the structure; otherwise
 * `undefined` so the caller can reuse the safe floor.
 *
 * No training data is threaded in — pruning is judged purely on synapse-weight
 * magnitude. The result is a *candidate*: population scoring keeps it only if it
 * beats the safe floor, so an over-eager prune costs nothing.
 *
 * Pruning only ever removes synapses (never adds), so it cannot introduce new
 * backward edges — the safe floor's `removeBackwardSynapses` pass already
 * settled forward-only semantics, hence no `feedbackLoop` handling here.
 */
function buildAggressiveCompact(
  safe: Creature,
): Creature | undefined {
  const holdDebug = safe.DEBUG;
  safe.DEBUG = false;
  const safeExport = exportJSONUnchecked(safe);
  safe.DEBUG = holdDebug;
  normaliseCreatureExport(safeExport);

  const candidate = cloneCreatureExport(safeExport);

  const pruneResult = aggressivePrune(candidate);
  if (!pruneResult.changed) return undefined;

  // Clean up any structure the prune stranded (now-dangling neurons and
  // subgraphs that can no longer influence an output).
  cleanupOrphanedNeurons(candidate);
  pruneDeadSubgraphs(candidate);

  addTag(candidate, "approach", "compact" as Approach);
  delete candidate.memetic;
  removeTag(candidate, "approach-logged");

  // Preserve forwardOnly semantics from the safe floor.
  if (safe.forwardOnly === true) candidate.forwardOnly = true;

  assertValidSynapseReferences(
    candidate,
    "before Creature.fromJSON in buildAggressiveCompact",
  );

  // Issue #2514: opt out of the load-side recurrent throw — like the safe
  // path, this repair candidate may carry residual backward synapses that the
  // load-side cleanup strips.
  return Creature.fromJSON(candidate, false, "compactCreatureAggressive", {
    throwOnRecurrent: "never",
  });
}

/**
 * Compacts a creature by removing redundant neurons and connections.
 *
 * Thin wrapper over {@link compactCreatureVariants} that returns the safe
 * variant for back-compat — the floor that score-based selection can never do
 * worse than.
 *
 * @param creature - The creature to compact
 * @param feedbackLoop - Whether to use a feedback loop during compaction
 * @param mcmcTemperature - Issue #2200: Optional MCMC temperature for probabilistic
 *   weight rescaling acceptance. When provided, worsening rescalings may be accepted
 *   with probability exp(-delta / temperature) instead of greedy rejection.
 * @returns A new compacted creature or undefined if no compaction occurred
 */
export function compactCreature(
  creature: Creature,
  feedbackLoop: boolean,
  mcmcTemperature?: number,
): Creature | undefined {
  return compactCreatureVariants(creature, feedbackLoop, mcmcTemperature).safe;
}

/**
 * Build the safe compaction candidate — all exact, behaviour-preserving folds.
 * The returned creature's score is guaranteed ≥ the original's.
 *
 * Issue #3840: that guarantee is enforced, not merely documented. Every fold
 * here is exact for a creature whose neurons sum their inbound values, and the
 * complexity terms of the score can only fall, so score ≥ original follows from
 * behaviour being unchanged. For the one shape where "exact" cannot be reasoned
 * about from weight magnitudes — an `IF` neuron routed by role-typed synapses —
 * the candidate is compared against the original over a deterministic probe
 * matrix before it is accepted, and the whole compaction is discarded (returning
 * `undefined`, ie "nothing compacted") if behaviour moved.
 */
function buildSafeCompact(
  creature: Creature,
  feedbackLoop: boolean,
  mcmcTemperature?: number,
): Creature | undefined {
  const holdDebug = creature.DEBUG;
  creature.DEBUG = false;
  // Issue #2511: compaction may receive a forward-only creature with
  // intentional backward synapses (Issue #956 test fixtures, GRQ-12
  // post-strip recovery). Use the unchecked export so the save-side
  // assertion does not fire here — this is an internal clone, not a save.
  const startExport = exportJSONUnchecked(creature);
  creature.DEBUG = holdDebug;
  // Public export omits integer ids; compaction logic expects fromId/toId on synapses.
  normaliseCreatureExport(startExport);

  // Issue #1015: Use direct property copy instead of JSON.parse(JSON.stringify())
  // for better performance with large networks.
  const compactCreature = cloneCreatureExport(startExport);

  // Pre-allocate neuronMap with expected size for better performance
  const neuronMap = new Map<number, NeuronExport>(
    compactCreature.neurons.map((neuron) => [neuron.id!, neuron]),
  );

  // Pre-allocate connection maps and build in a single pass
  const inwardConnections = new Map<number, SynapseExport[]>();
  const outwardConnections = new Map<number, SynapseExport[]>();

  for (const synapse of compactCreature.synapses) {
    const outList = outwardConnections.get(synapse.fromId!);
    if (outList) {
      outList.push(synapse);
    } else {
      outwardConnections.set(synapse.fromId!, [synapse]);
    }

    const inList = inwardConnections.get(synapse.toId!);
    if (inList) {
      inList.push(synapse);
    } else {
      inwardConnections.set(synapse.toId!, [synapse]);
    }
  }

  let didCompact = false;

  // 29-Dec-2025: Safe algebraic bypass for COMPLEMENT neurons.
  //
  // When a COMPLEMENT neuron A (1 - x) has one or more outbound links to neuron(s) B,
  // and each B is not an aggregation squash (MAXIMUM/MINIMUM/IF/HYPOT), we can remove
  // A completely by folding its affine transform into each downstream neuron:
  //
  //   A = 1 - (Σ(wi * xi) + bA)
  //   contribution into B = wAB * A
  //                       = Σ((-wAB*wi) * xi) + wAB*(1 - bA)
  //
  // This is behaviour-preserving for summed pre-activation squashes (the default),
  // but it is NOT safe for aggregation squashes because they treat each inbound
  // value specially (eg MAXIMUM uses Math.max over inbound values).
  for (const neuron of compactCreature.neurons) {
    if (neuron.type !== "hidden") continue;
    if (neuron.squash !== COMPLEMENT.NAME) continue;

    const indexByUUID = new Map<number, number>();
    for (let j = 0; j < compactCreature.neurons.length; j++) {
      indexByUUID.set(compactCreature.neurons[j].id!, j);
    }

    const inConns = inwardConnections.get(neuron.id!) || [];
    const outConns = outwardConnections.get(neuron.id!) || [];
    if (inConns.length === 0) continue;
    if (outConns.length === 0) continue;

    // Conservative: only bypass when *all* downstream neurons are non-aggregate.
    // (We could partially bypass some outbounds while keeping the neuron for
    // aggregate consumers, but that is more complex and not required here.)
    const toNeurons = outConns.map((c) => neuronMap.get(c.toId!));
    if (toNeurons.some((n) => !n)) continue;
    if (toNeurons.some((n) => isAggregationSquash(n!.squash))) continue;

    // Avoid introducing self-loops or invalid forward-only edges via bypass.
    let unsafe = false;
    for (const outConn of outConns) {
      if (outConn.toId === neuron.id!) {
        unsafe = true;
        break;
      }

      for (const inConn of inConns) {
        if (
          inConn.fromId === outConn.toId || inConn.fromId === neuron.id!
        ) {
          unsafe = true;
          break;
        }

        // If this creature is forward-only and feedbackLoop=false, avoid creating
        // any backward synapses during bypass.
        if (!feedbackLoop && creature.forwardOnly === true) {
          const fromIndex = indexByUUID.get(inConn.fromId!);
          const toIndex = indexByUUID.get(outConn.toId!);
          if (
            fromIndex !== undefined && toIndex !== undefined &&
            fromIndex > toIndex
          ) {
            unsafe = true;
            break;
          }
        }
      }

      if (unsafe) break;
    }
    if (unsafe) continue;

    for (const outConn of outConns) {
      const toNeuron = neuronMap.get(outConn.toId!)!;

      // Bias fold into downstream: bB += wAB*(1 - bA)
      toNeuron.bias += outConn.weight * (1 - neuron.bias);

      // Redirect each inbound connection directly into this downstream.
      for (const inConn of inConns) {
        const newWeight = (-outConn.weight) * inConn.weight;

        const existing = compactCreature.synapses.find((s) =>
          s.fromId === inConn.fromId! &&
          s.toId === outConn.toId! &&
          (s.type ?? "") === (inConn.type ?? "")
        );
        // Issue #1972: Preserve tags from both inbound and outbound synapses.
        const mergedTags = mergeTagsByNameValue(inConn.tags, outConn.tags);
        if (existing) {
          existing.weight += newWeight;
          if (mergedTags) {
            existing.tags = mergeTagsByNameValue(existing.tags, mergedTags);
          }
        } else {
          const newSynapse: SynapseExport = {
            fromId: inConn.fromId!,
            toId: outConn.toId!,
            weight: newWeight,
          };
          if (mergedTags) newSynapse.tags = mergedTags;
          compactCreature.synapses.push(newSynapse);
        }
      }
    }

    // Remove the COMPLEMENT neuron and all of its incident synapses.
    compactCreature.synapses = compactCreature.synapses.filter((s) =>
      s.fromId !== neuron.id! && s.toId !== neuron.id!
    );
    compactCreature.neurons = compactCreature.neurons.filter((n) =>
      n.id !== neuron.id!
    );
    neuronMap.delete(neuron.id!);

    // Rebuild inward/outward maps after changes.
    inwardConnections.clear();
    outwardConnections.clear();
    compactCreature.synapses.forEach((synapse) => {
      outwardConnections.set(
        synapse.fromId!,
        (outwardConnections.get(synapse.fromId!) || []).concat(synapse),
      );
      inwardConnections.set(
        synapse.toId!,
        (inwardConnections.get(synapse.toId!) || []).concat(synapse),
      );
    });

    assertValidSynapseReferences(
      compactCreature,
      "after COMPLEMENT bypass neuron removal",
    );

    didCompact = true;
    break; // One safe bypass per compaction call.
  }

  for (const neuron of compactCreature.neurons) {
    if (neuron.type !== "hidden") continue;

    const inConns = inwardConnections.get(neuron.id!) || [];
    const outConns = outwardConnections.get(neuron.id!) || [];

    if (inConns.length === 1 && outConns.length === 1) {
      const [inConn] = inConns;
      const [outConn] = outConns;

      const fromNeuron = neuronMap.get(inConn.fromId!);
      const toNeuron = neuronMap.get(outConn.toId!);

      // Issue #3840: the merged synapse created below is a plain additive edge
      // — it carries no `type`. Folding a relay whose outbound edge holds an
      // `IF` role (`condition` / `positive` / `negative`) therefore silently
      // strips that role, and the load-side `fix()` then re-invents the missing
      // role at random. Skip aggregation consumers and role-typed edges, as the
      // COMPLEMENT bypass above already does.
      if (
        toNeuron && (
          isAggregationSquash(toNeuron.squash) ||
          inConn.type !== undefined ||
          outConn.type !== undefined
        )
      ) {
        continue;
      }

      // Issue #3840: only IDENTITY chains fold exactly.
      //
      //   removed = IDENTITY(b + w_in·x) = b + w_in·x
      //   contribution into `to` = w_out·b + (w_in·w_out)·x
      //
      // so the neuron disappears into one synapse of weight `w_in·w_out` plus a
      // bias term `w_out·b` on the consumer. LOGISTIC used to be folded the same
      // way, which is not an identity at all: `w_out·σ(b + w_in·σ(…))` is not
      // `w_in·w_out·σ(…)`. On a two-LOGISTIC chain that silently moved the
      // output from 0.512 to 0.211 — an "exact, behaviour-preserving" pass
      // rewriting the creature into a different function.
      if (
        fromNeuron &&
        toNeuron &&
        neuron.squash === fromNeuron.squash &&
        neuron.squash === IDENTITY.NAME &&
        inConn.fromId !== neuron.id! &&
        outConn.toId !== neuron.id!
      ) {
        const existingSynapse = compactCreature.synapses.find(
          (s) =>
            s.fromId === fromNeuron.id! &&
            s.toId === toNeuron.id! &&
            (s.type ?? "") === (inConn.type ?? ""),
        );

        if (existingSynapse) continue; // Skip compaction if synapse already exists

        const combinedWeight = inConn.weight * outConn.weight;
        assert(Number.isFinite(combinedWeight), "combinedWeight not finite");

        // Issue #3840: the removed neuron's bias must land on the consumer.
        // It used to be written back onto the neuron being deleted on the very
        // next lines, so `w_out·b` was dropped — a 0.11 output shift on a plain
        // IDENTITY chain with bias -0.1 and outbound weight 1.1.
        const consumerBias = toNeuron.bias + outConn.weight * neuron.bias;
        assert(Number.isFinite(consumerBias), "consumerBias not finite");
        toNeuron.bias = consumerBias;

        // Remove old synapses
        compactCreature.synapses = compactCreature.synapses.filter(
          (s) => s !== inConn && s !== outConn,
        );

        // Issue #1972: Preserve tags from both merged synapses.
        const chainMergedTags = mergeTagsByNameValue(inConn.tags, outConn.tags);

        // Add new synapse directly connecting fromNeuron to toNeuron
        const chainSynapse: SynapseExport = {
          weight: combinedWeight,
          fromId: fromNeuron.id!,
          toId: toNeuron.id!,
        };
        if (chainMergedTags) chainSynapse.tags = chainMergedTags;
        compactCreature.synapses.push(chainSynapse);

        // Remove neuron from neurons list
        compactCreature.neurons = compactCreature.neurons.filter((n) =>
          n.id !== neuron.id!
        );
        neuronMap.delete(neuron.id!);

        // Rebuild inward and outward maps after changes
        inwardConnections.clear();
        outwardConnections.clear();
        compactCreature.synapses.forEach((synapse) => {
          outwardConnections.set(
            synapse.fromId!,
            (outwardConnections.get(synapse.fromId!) || []).concat(synapse),
          );
          inwardConnections.set(
            synapse.toId!,
            (inwardConnections.get(synapse.toId!) || []).concat(synapse),
          );
        });

        assertValidSynapseReferences(
          compactCreature,
          "after chain compaction neuron removal",
        );

        didCompact = true;
        break; // restart the loop after each mutation
      }
    }
  }

  // Issue #3036: Exact IF-collapse when every condition input is constant.
  // The selector is fixed at compaction time, so the IF is rewritten to its
  // always-taken branch as a plain additive (IDENTITY) neuron, dropping the
  // dead condition + untaken-branch synapses. Lossless → safe variant. Runs
  // before the constant fold so any constants it strands are absorbed below.
  const ifCollapseResult = collapseConstantIf(compactCreature);
  if (ifCollapseResult.changed) {
    assertValidSynapseReferences(
      compactCreature,
      "after constant IF collapse",
    );
    didCompact = true;
  }

  // Issue #3035: Transitive constant fold + zero-varying-input collapse.
  // Fold `type:"constant"` producers (and hidden neurons that have become
  // effectively constant) into their non-aggregate consumers' biases, iterating
  // to a fixpoint so chained constant subgraphs collapse fully. Lossless, so it
  // belongs to the safe variant.
  const constantFoldResult = foldConstants(compactCreature);
  if (constantFoldResult.changed) {
    assertValidSynapseReferences(
      compactCreature,
      "after constant fold",
    );
    didCompact = true;
  }

  // Issue #3808: Merge the constants the fold above cannot absorb — those
  // feeding aggregate consumers (IF/MAXIMUM/MINIMUM/HYPOT) — into at most three
  // canonical bias-1 constants with fleet-wide well-known UUIDs. Each original
  // bias moves onto the outgoing synapse weight (b × w → 1 × w·b), so the
  // creature's error is unchanged while the redundant neurons disappear.
  const constantMergeResult = mergeRedundantConstants(compactCreature);
  if (constantMergeResult.changed) {
    assertValidSynapseReferences(
      compactCreature,
      "after constant merge",
    );
    didCompact = true;
  }

  // Issues #1947/#1948: Merge parallel bridge neurons that all connect to the
  // same target into a single IDENTITY neuron with merged weights. Issue #3637
  // retired the separate IDENTITY-only pass — this generalised pass already
  // covers IDENTITY (it is a mergeable squash, and the IDENTITY conversion step
  // short-circuits for it). See SquashUtils.isParallelMergeableSquash().
  const parallelResult = mergeParallelBridges(compactCreature);
  if (parallelResult.removedNeurons > 0) {
    didCompact = true;
  }

  /** If not feedback loop, remove synapses that are going backwards */
  if (!feedbackLoop) {
    const backwardResult = removeBackwardSynapses(compactCreature);
    if (backwardResult.removedSynapses > 0) {
      didCompact = true;
    }
  }

  // 30-Dec-2025: Simplify large weights for homogeneous squashes (issue #642).
  //
  // For ABSOLUTE and IDENTITY we can rescale a neuron's inbound weights/bias by 1/c and
  // its outbound weights by c, without changing behaviour:
  //
  //   z  = Σ(wi*xi) + b
  //   z' = z / c
  //   f(z') = f(z) / c         (for ABSOLUTE and IDENTITY, with c > 0)
  //   (v*c) * (f(z)/c) = v*f(z)
  //
  // This can turn a "huge inbound / tiny outbound" pair into two moderate values,
  // reducing the score penalty (which is based on max/avg abs weights and biases).
  const simplifiedLargeWeights = simplifyLargeWeights(
    compactCreature,
    mcmcTemperature,
  );
  if (simplifiedLargeWeights) {
    didCompact = true;
  }

  // 29-Dec-2025: Behaviour-preserving pruning of zero-weight synapses.
  // See https://github.com/stSoftwareAU/NEAT-AI/issues/977
  const zeroResult = pruneZeroWeightSynapses(compactCreature);
  if (zeroResult.removedSynapses > 0) {
    didCompact = true;
  }

  /**
   * Clean up orphaned neurons using the robust iterative utility.
   *
   * This replaces a previous buggy loop that failed to:
   * - Set `danglesFound = true` when removing neurons (so iteration never continued)
   * - Rebuild the outwardConnections map after backward-synapse removal
   *
   * See https://github.com/stSoftwareAU/NEAT-AI/issues/956
   */
  const orphanResult = cleanupOrphanedNeurons(compactCreature);
  if (orphanResult.removed > 0 || orphanResult.converted > 0) {
    didCompact = true;
  }

  // Prune dead subgraphs (neurons/synapses that cannot influence any output).
  const deadResult = pruneDeadSubgraphs(compactCreature);
  if (deadResult.removedNeurons > 0 || deadResult.removedSynapses > 0) {
    didCompact = true;
  }

  if (didCompact) {
    addTag(compactCreature, "approach", "compact" as Approach);
    delete compactCreature.memetic;
    removeTag(compactCreature, "approach-logged");

    /** CreatureExport.neurons excludes inputs as the export does not include them.*/
    const oldNeurons = startExport.neurons.length - startExport.output;
    addTag(compactCreature, "old-neurons", oldNeurons.toString());

    // Preserve forwardOnly semantics from source creature
    if (creature.forwardOnly === true) {
      compactCreature.forwardOnly = true;
    }

    assertValidSynapseReferences(
      compactCreature,
      "before Creature.fromJSON in compactCreature",
    );

    // Issue #2514: compaction may carry residual backward synapses on
    // a forward-only candidate so the load-side cleanup
    // (`mergeDuplicateSynapses` + `cleanupOrphanedNeurons` etc.) can
    // strip them. Opt out of the load-side throw so this repair path
    // can keep ingesting corrupt input on purpose.
    const c = Creature.fromJSON(compactCreature, false, "compactCreature", {
      throwOnRecurrent: "never",
    });

    // Issue #3840: the guarantee in this function's doc comment is now
    // enforced, not merely asserted. Every fold above is exact for a creature
    // whose neurons sum their inbound values, so the check is gated on the only
    // shape where "exact" has to be verified rather than reasoned about: an
    // `IF` neuron reached by role-typed synapses. Creatures without one pay a
    // single scan of the synapse array and no activation at all.
    if (
      hasRoleTypedIfStructure(startExport) &&
      !verifyExactBehaviour(creature, c, "buildSafeCompact")
    ) {
      // The whole compaction is discarded — "nothing compacted" — so the
      // caller keeps the original creature.
      return undefined;
    }

    return c;
  }

  return undefined;
}
