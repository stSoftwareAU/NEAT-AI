/**
 * TrainingTeardown.ts — Post-training teardown phase.
 *
 * Issue #2399: Extracted from Training.ts. Applies the best creature
 * snapshot back, prunes synthetic synapses, filters trace data to match
 * the pruned topology, drops traces for neurons/synapses that were not
 * actually tracked, and compacts the final creature.
 */

import { Creature } from "@creature";
import { compactUnused } from "@compact/CompactUnused.ts";
import { selectCompactVariant } from "@compact/CompactVariants.ts";
import { removeSyntheticSynapses } from "@propagate/RemoveSyntheticSynapses.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import type {
  CreatureExport,
  CreatureTrace,
} from "@architecture/CreatureInterfaces.ts";
import type { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import type { BackPropagationArguments } from "@propagate/BackPropagation.ts";
import type { TrainingResult } from "@architecture/training/TrainingTypes.ts";
import type { TrainingLoopResult } from "@architecture/training/TrainingLoop.ts";

/**
 * Resolve canonical wire UUIDs to runtime ids for an export that
 * includes both (internal snapshot).
 */
export function wireToRuntimeIdFromExport(
  json: CreatureExport,
): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < json.input; i++) {
    map.set(`input-${i}`, i);
  }
  for (const n of json.neurons) {
    if (typeof n.uuid === "string" && n.id !== undefined) {
      map.set(n.uuid, n.id);
    }
  }
  return map;
}

/**
 * Prune synthetic synapses from the creature and re-align the trace
 * snapshot so it matches the cleaned topology.
 *
 * Returns the (possibly updated) best creature and trace JSON.
 */
export function pruneSyntheticSynapses(
  creature: Creature,
  bestCreatureJSON: CreatureExport,
  bestTraceJSON: CreatureTrace,
  syntheticKeys: Set<string> | undefined,
  plankConstant: number,
): { bestCreatureJSON: CreatureExport; bestTraceJSON: CreatureTrace } {
  if (!syntheticKeys || syntheticKeys.size === 0) {
    return { bestCreatureJSON, bestTraceJSON };
  }

  // Issue #1923: Remove synthetic synapses after training completes.
  removeSyntheticSynapses(creature, syntheticKeys, plankConstant);
  // Invalidate caches after structural change.
  creature.clearState();

  // Update bestCreatureJSON to reflect the cleaned creature.
  const cleanedCreatureJSON = exportJSONWithRuntimeIds(creature);

  // Filter bestTraceJSON to match the cleaned creature structure.
  // traceJSON() is UUID-only (Issue #2054); match on wire UUIDs.
  const remainingSynapseKeys = new Set<string>();
  for (const s of cleanedCreatureJSON.synapses) {
    if (typeof s.fromUUID === "string" && typeof s.toUUID === "string") {
      remainingSynapseKeys.add(`${s.fromUUID}->${s.toUUID}`);
    }
  }
  const remainingNeuronUuids = new Set<string>();
  for (const n of cleanedCreatureJSON.neurons) {
    if (typeof n.uuid === "string") remainingNeuronUuids.add(n.uuid);
  }

  // Build a map of creature neuron properties for trace sync (keyed by wire uuid).
  const creatureNeuronProps = new Map<
    string,
    { squash?: string; bias: number; type: string }
  >();
  for (const n of cleanedCreatureJSON.neurons) {
    if (typeof n.uuid === "string") {
      creatureNeuronProps.set(n.uuid, {
        squash: n.squash,
        bias: n.bias,
        type: n.type,
      });
    }
  }

  const cleanedTraceJSON: CreatureTrace = {
    ...bestTraceJSON,
    synapses: bestTraceJSON.synapses.filter((s) =>
      typeof s.fromUUID === "string" &&
      typeof s.toUUID === "string" &&
      remainingSynapseKeys.has(`${s.fromUUID}->${s.toUUID}`)
    ),
    neurons: bestTraceJSON.neurons.filter((n) =>
      typeof n.uuid === "string" && remainingNeuronUuids.has(n.uuid)
    ).map((n) => {
      // Sync neuron properties (squash, bias, type) with the
      // cleaned creature. applyLearnings can change squash types
      // (e.g. IF → IDENTITY) which must be reflected in the trace.
      const uuid = n.uuid as string;
      const props = creatureNeuronProps.get(uuid);
      if (props) {
        return { ...n, squash: props.squash, bias: props.bias };
      }
      return n;
    }),
  };

  return {
    bestCreatureJSON: cleanedCreatureJSON,
    bestTraceJSON: cleanedTraceJSON,
  };
}

/**
 * Strip trace data from neurons/synapses that were not actually tracked
 * by the sparse configuration. Mutates the provided trace in place.
 */
export function stripUntrackedTraces(
  bestTraceJSON: CreatureTrace,
  bestCreatureJSON: CreatureExport,
  sparseConfig: SparseConfig,
): void {
  const wireToRuntimeId = wireToRuntimeIdFromExport(bestCreatureJSON);

  bestTraceJSON.neurons.forEach((n) => {
    const uuid = typeof n.uuid === "string" ? n.uuid : undefined;
    const runtimeId = uuid !== undefined
      ? wireToRuntimeId.get(uuid)
      : undefined;
    if (runtimeId === undefined || !sparseConfig.traceNeeded(runtimeId)) {
      delete (n as { trace?: unknown }).trace;
    }
  });

  bestTraceJSON.synapses.forEach((s) => {
    const toUuid = typeof s.toUUID === "string" ? s.toUUID : undefined;
    const runtimeId = toUuid !== undefined
      ? wireToRuntimeId.get(toUuid)
      : undefined;
    if (runtimeId === undefined || !sparseConfig.traceNeeded(runtimeId)) {
      delete (s as { trace?: unknown }).trace;
    }
  });
}

/**
 * Finalise training: load best creature, prune synthetic synapses,
 * strip unused traces, compact, and package the final result.
 */
export function finaliseTraining(
  creature: Creature,
  loop: TrainingLoopResult,
  iterationConfig: BackPropagationArguments,
  iterations: number,
  feedbackLoop: boolean,
  syntheticKeys: Set<string> | undefined,
  ID: string,
): TrainingResult {
  let { bestCreatureJSON, bestTraceJSON } = loop;

  if (iterations > 1) {
    creature.loadFrom(bestCreatureJSON, false, "training:teardownRestore"); // If not called via the worker.
  }

  const pruned = pruneSyntheticSynapses(
    creature,
    bestCreatureJSON,
    bestTraceJSON,
    syntheticKeys,
    iterationConfig.plankConstant,
  );
  bestCreatureJSON = pruned.bestCreatureJSON;
  bestTraceJSON = pruned.bestTraceJSON;

  stripUntrackedTraces(bestTraceJSON, bestCreatureJSON, loop.sparseConfig);

  let compact = compactUnused(bestTraceJSON, iterationConfig.plankConstant);
  if (!compact) {
    // Issue #3037: select the best of the safe + aggressive compaction
    // candidates (the safe variant is the floor; identical variants dedupe).
    compact = selectCompactVariant(
      Creature.fromJSON(bestTraceJSON).compactVariants(feedbackLoop),
    );
  }

  return {
    ID,
    iteration: loop.iteration,
    error: loop.bestError,
    trace: bestTraceJSON,
    compact: compact ? compact.exportJSON() : undefined,
  };
}
