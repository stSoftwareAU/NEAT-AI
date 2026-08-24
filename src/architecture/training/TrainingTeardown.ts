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
import { validateOrDiagnose } from "@utils/Diagnostics.ts";
import { removeSyntheticSynapses } from "@propagate/RemoveSyntheticSynapses.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import type {
  CreatureExport,
  CreatureTrace,
} from "@architecture/CreatureInterfaces.ts";
import type { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { synapseTripleKey } from "@architecture/SynapseKey.ts";
import type {
  SynapseExport,
  SynapseTrace,
} from "@architecture/SynapseInterfaces.ts";
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
 * The trace snapshot that still carries a synapse's `trace` payload for a
 * cleaned row, or `undefined` when that row is new.
 *
 * Prefer an exact `(from, to, type)` hit. After an `IF` → `IDENTITY`
 * downgrade the remaining row is untyped on the same pair, so fall back to
 * the first trace row of that pair (Issue #3873).
 */
function matchingTraceSynapse(
  cleaned: SynapseExport,
  byTriple: Map<string, SynapseTrace>,
  byPair: Map<string, SynapseTrace[]>,
): SynapseTrace | undefined {
  if (
    typeof cleaned.fromUUID !== "string" || typeof cleaned.toUUID !== "string"
  ) {
    return undefined;
  }
  const exact = byTriple.get(
    synapseTripleKey(cleaned.fromUUID, cleaned.toUUID, cleaned.type),
  );
  if (exact) return exact;
  if (cleaned.type) return undefined;
  const pair = `${cleaned.fromUUID}->${cleaned.toUUID}`;
  return byPair.get(pair)?.[0];
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

  // Re-align the trace to the cleaned topology. Exact triple match first;
  // an untyped cleaned row also accepts a typed trace row on the same pair
  // so an IF→IDENTITY downgrade does not drop the only remaining outward
  // synapse (Issue #3873).
  const byTriple = new Map<string, SynapseTrace>();
  const byPair = new Map<string, SynapseTrace[]>();
  for (const s of bestTraceJSON.synapses) {
    if (typeof s.fromUUID !== "string" || typeof s.toUUID !== "string") {
      continue;
    }
    byTriple.set(synapseTripleKey(s.fromUUID, s.toUUID, s.type), s);
    const pair = `${s.fromUUID}->${s.toUUID}`;
    const list = byPair.get(pair);
    if (list) list.push(s);
    else byPair.set(pair, [s]);
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
    synapses: cleanedCreatureJSON.synapses.flatMap((s) => {
      if (typeof s.fromUUID !== "string" || typeof s.toUUID !== "string") {
        return [];
      }
      const traced = matchingTraceSynapse(s, byTriple, byPair);
      if (traced) {
        return [{
          ...traced,
          fromUUID: s.fromUUID,
          toUUID: s.toUUID,
          weight: s.weight,
          type: s.type,
        }];
      }
      return [{
        fromUUID: s.fromUUID,
        toUUID: s.toUUID,
        weight: s.weight,
        type: s.type,
      }] as SynapseTrace[];
    }),
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

  // Issue #3776: single-epoch runs are deliberately not restored — the best
  // snapshot is taken *before* `applyLearnings`, so reloading it would discard
  // the only epoch's learning entirely. Rollback needs a second epoch to
  // compare against, which is why scheduled training requests two.
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

  // Issue #3383: validate (and repair) the compact creature before it is
  // serialised into the worker result. `compactUnused` already guards its own
  // output, but the `compactVariants` fallback above loads its result with
  // validation disabled, so a constant neuron stranded with no outward
  // connection could otherwise reach `Creature.fromJSON` in
  // `processCompletedResults` and throw `NO_OUTWARD_CONNECTIONS`
  // non-deterministically on load. Repair it — or fail loudly at the producer —
  // rather than letting the fault surface downstream on deserialisation.
  compact = validateAndRepairCompact(compact);

  return {
    ID,
    iteration: loop.iteration,
    error: loop.bestError,
    trace: bestTraceJSON,
    compact: compact ? compact.exportJSON() : undefined,
  };
}

/**
 * Issue #3383: guard the compact creature returned to the evolution loop.
 *
 * Validates the compacted creature and, on failure, repairs it in place via
 * {@link validateOrDiagnose} (which runs `fix()` and re-validates, throwing
 * with full producer context if the creature is unrecoverable). This mirrors
 * the guard the primary {@link compactUnused} path already applies, closing the
 * gap where the {@link selectCompactVariant} fallback returned an unvalidated
 * creature. A constant neuron left with no outward connection is pruned by
 * `fix()`, so the failure can never surface non-deterministically as a
 * `NO_OUTWARD_CONNECTIONS` throw when the result is deserialised downstream.
 *
 * @param compact - The compacted creature (or `undefined` when no compaction
 *   occurred).
 * @returns The same creature reference, now guaranteed valid, or `undefined`.
 */
export function validateAndRepairCompact(
  compact: Creature | undefined,
): Creature | undefined {
  if (compact) {
    validateOrDiagnose(
      compact,
      "finaliseTraining:compact",
      compact.forwardOnly ? { forwardOnly: true } : undefined,
    );
  }
  return compact;
}
