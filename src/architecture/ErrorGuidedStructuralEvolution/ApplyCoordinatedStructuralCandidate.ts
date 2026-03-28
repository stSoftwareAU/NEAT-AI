import type { CreatureExport } from "../CreatureInterfaces.ts";
import { CreatureUtil } from "../CreatureUtils.ts";
import { nextNeuronId } from "../NeuronId.ts";
import { Creature } from "../../Creature.ts";
import {
  cleanupMemeticForRemovedNeuron,
  cleanupMemeticForRemovedSynapse,
  cleanupOrphanedNeurons,
} from "../../compact/CompactUtils.ts";
import type {
  CoordinatedStructuralCandidate,
  CoordinatedStructuralOperation,
} from "./CoordinatedStructuralCandidate.ts";
import {
  buildWireToRuntimeIdMap,
  resolveCoordinatedEdgeEndpoints,
} from "./DiscoveryWireIdentity.ts";

function buildIdToIndexMap(creature: CreatureExport): Map<number, number> {
  const idToIndex = new Map<number, number>();
  const inputCount = creature.input ?? 0;
  for (let i = 0; i < inputCount; i++) {
    idToIndex.set(i, i);
  }
  for (let i = 0; i < creature.neurons.length; i++) {
    idToIndex.set(creature.neurons[i].id!, inputCount + i);
  }
  return idToIndex;
}

function canAddForwardOnlySynapse(
  creature: CreatureExport,
  fromId: number,
  toId: number,
): boolean {
  if (creature.forwardOnly !== true) {
    return true;
  }
  const idToIndex = buildIdToIndexMap(creature);
  const from = idToIndex.get(fromId);
  const to = idToIndex.get(toId);
  if (from === undefined || to === undefined) {
    return false;
  }
  return from < to;
}

function populateRuntimeIdsFromCreature(
  creature: Creature,
  exported: CreatureExport,
): void {
  const wireToId = buildWireToRuntimeIdMap(creature);
  for (const neuron of exported.neurons) {
    if (!neuron.uuid) continue;
    const runtimeId = wireToId.get(neuron.uuid);
    if (runtimeId !== undefined) {
      neuron.id = runtimeId;
    }
  }
  for (const synapse of exported.synapses) {
    if (synapse.fromUUID) {
      const fromId = wireToId.get(synapse.fromUUID);
      if (fromId !== undefined) {
        synapse.fromId = fromId;
      }
    }
    if (synapse.toUUID) {
      const toId = wireToId.get(synapse.toUUID);
      if (toId !== undefined) {
        synapse.toId = toId;
      }
    }
  }
}

/**
 * Apply a coordinated structural candidate as a single ordered ablation.
 *
 * Behaviour:
 * - Clones the creature
 * - Applies all operations in-order
 * - `removeSynapse`: removes matching (from,to) if present (no-op if missing)
 * - `addSynapse`: adds if absent; if present, updates weight (idempotent)
 * - `setWeight`: updates weight of existing synapse (no-op if synapse missing)
 *
 * Notes:
 * - This function is intentionally conservative for forward-only creatures: it
 *   will not add a synapse that would create a self-loop or back-connection.
 */
export function applyCoordinatedStructuralCandidate(
  creature: Creature,
  candidate: CoordinatedStructuralCandidate,
): Creature {
  const base: CreatureExport = creature.exportJSON();
  populateRuntimeIdsFromCreature(creature, base);
  const next: CreatureExport = JSON.parse(
    JSON.stringify(base),
  ) as CreatureExport;

  const ops: CoordinatedStructuralOperation[] = candidate.operations ?? [];
  if (!Array.isArray(ops) || ops.length === 0) {
    return creature;
  }
  const wireToId = buildWireToRuntimeIdMap(creature);

  // Track removed synapses so a later addSynapse can preserve metadata (type/tags)
  // when a Rust candidate performs a weight adjustment via remove+add.
  const removedSynapseMeta = new Map<
    string,
    {
      type?: "positive" | "negative" | "condition";
      tags?: Array<{ name: string; value: string }>;
    }
  >();

  const edgeKey = (fromId: number, toId: number): string =>
    `${fromId}->${toId}`;

  for (const op of ops) {
    if (!op || typeof op.type !== "string") continue;

    switch (op.type) {
      case "addNeuron": {
        // Ensure deterministic idempotency: if neuron already exists, update fields.
        const runtimeNeuronId = wireToId.get(op.neuronUuid);
        const existingIndex = next.neurons.findIndex((n) =>
          n.id === runtimeNeuronId
        );
        if (existingIndex >= 0) {
          // Some exports treat neuron entries as readonly, so replace the object.
          next.neurons[existingIndex] = {
            ...next.neurons[existingIndex],
            id: runtimeNeuronId,
            uuid: op.neuronUuid,
            type: op.neuronType,
            squash: op.squash,
            bias: op.bias,
          };
          continue;
        }

        const newNeuron = {
          id: nextNeuronId(),
          uuid: op.neuronUuid,
          type: op.neuronType,
          squash: op.squash,
          bias: op.bias,
        };
        wireToId.set(op.neuronUuid, newNeuron.id);

        if (typeof op.insertBeforeNeuronUuid === "string") {
          const beforeIdx = next.neurons.findIndex((n) =>
            n.uuid === op.insertBeforeNeuronUuid
          );
          if (beforeIdx >= 0) {
            next.neurons.splice(beforeIdx, 0, newNeuron);
            continue;
          }

          // `insertBeforeNeuronId` is an explicit ordering intent. If the target
          // neuron is missing and this creature is forward-only, appending would
          // violate layer ordering (hidden after output). Treat as a no-op instead.
          if (next.forwardOnly === true) {
            continue;
          }
        }

        // Default placement must preserve the invariant that hidden neurons appear
        // before output neurons (even when recurrent connections are allowed).
        if (op.neuronType === "hidden") {
          const firstOutputIdx = next.neurons.findIndex((n) =>
            n.type === "output"
          );
          if (firstOutputIdx >= 0) {
            next.neurons.splice(firstOutputIdx, 0, newNeuron);
          } else {
            next.neurons.push(newNeuron);
          }
        } else {
          next.neurons.push(newNeuron);
        }
        continue;
      }

      case "removeNeuron": {
        const neuronId = wireToId.get(op.neuronUuid);
        if (neuronId === undefined) {
          continue;
        }
        const beforeNeuronCount = next.neurons.length;
        next.neurons = next.neurons.filter((n) => n.id !== neuronId);
        if (next.neurons.length === beforeNeuronCount) {
          // No-op if neuron didn't exist (idempotent).
          continue;
        }

        // Remove any synapses that reference the neuron, and clean up memetic state.
        const removedEdges: Array<{ fromId: number; toId: number }> = [];
        for (const s of next.synapses) {
          if (s.fromId === neuronId || s.toId === neuronId) {
            removedEdges.push({ fromId: s.fromId!, toId: s.toId! });
          }
        }
        next.synapses = next.synapses.filter((s) =>
          !(s.fromId === neuronId || s.toId === neuronId)
        );
        for (const e of removedEdges) {
          cleanupMemeticForRemovedSynapse(next, e.fromId, e.toId);
        }
        cleanupMemeticForRemovedNeuron(next, neuronId);
        wireToId.delete(op.neuronUuid);
        continue;
      }

      case "changeSquash": {
        const neuronId = wireToId.get(op.neuronUuid);
        const n = next.neurons.find((x) => x.id === neuronId);
        if (n) n.squash = op.squash;
        continue;
      }

      case "setBias": {
        const neuronId = wireToId.get(op.neuronUuid);
        const n = next.neurons.find((x) => x.id === neuronId);
        if (n) n.bias = op.bias;
        continue;
      }

      case "removeSynapse": {
        const endpoints = resolveCoordinatedEdgeEndpoints(wireToId, op);
        if (!endpoints) {
          continue;
        }
        const existing = next.synapses.find((s) =>
          s.fromId === endpoints.fromId && s.toId === endpoints.toId
        );
        if (existing) {
          removedSynapseMeta.set(
            edgeKey(endpoints.fromId, endpoints.toId),
            {
              type: existing.type,
              tags: existing.tags
                ? existing.tags.map((t) => ({ ...t }))
                : undefined,
            },
          );
        }
        const before = next.synapses.length;
        next.synapses = next.synapses.filter((s) =>
          !(
            s.fromId === endpoints.fromId &&
            s.toId === endpoints.toId
          )
        );
        if (next.synapses.length !== before) {
          cleanupMemeticForRemovedSynapse(
            next,
            endpoints.fromId,
            endpoints.toId,
          );
        }
        continue;
      }

      case "addSynapse": {
        const endpoints = resolveCoordinatedEdgeEndpoints(wireToId, op);
        if (!endpoints) {
          continue;
        }
        // Ensure both endpoints exist; avoid crashing on stale ops.
        const existingNeuronIds = new Set<number>();
        const inputCount = next.input ?? 0;
        for (let i = 0; i < inputCount; i++) {
          existingNeuronIds.add(i);
        }
        for (const n of next.neurons) existingNeuronIds.add(n.id!);
        if (
          !existingNeuronIds.has(endpoints.fromId) ||
          !existingNeuronIds.has(endpoints.toId)
        ) {
          continue;
        }

        if (
          !canAddForwardOnlySynapse(next, endpoints.fromId, endpoints.toId)
        ) {
          continue;
        }

        const existing = next.synapses.find((s) =>
          s.fromId === endpoints.fromId && s.toId === endpoints.toId
        );
        if (existing) {
          existing.weight = op.weight;
        } else {
          const meta = removedSynapseMeta.get(
            edgeKey(endpoints.fromId, endpoints.toId),
          );
          next.synapses.push({
            fromId: endpoints.fromId,
            toId: endpoints.toId,
            fromUUID: op.fromNeuronUuid,
            toUUID: op.toNeuronUuid,
            weight: op.weight,
            type: meta?.type,
            tags: meta?.tags ? meta.tags.map((t) => ({ ...t })) : undefined,
          });
        }
        continue;
      }

      case "setWeight": {
        const endpoints = resolveCoordinatedEdgeEndpoints(wireToId, op);
        if (!endpoints) {
          continue;
        }
        const existing = next.synapses.find((s) =>
          s.fromId === endpoints.fromId && s.toId === endpoints.toId
        );
        if (existing) {
          existing.weight = op.weight;
        }
        // No-op if synapse doesn't exist (idempotent).
        continue;
      }
    }
  }

  // Clean up any neurons that have become orphaned after the coordinated edits.
  // This prevents validation failures (eg. NO_OUTWARD_CONNECTIONS) from triggering
  // fix() as a side effect, which can bump semanticVersion for forward-only creatures.
  cleanupOrphanedNeurons(next);

  const updated = Creature.fromJSON(next);
  delete updated.uuid;
  try {
    if (updated.forwardOnly === true) {
      updated.validate({ forwardOnly: true });
    } else {
      updated.validate();
    }
  } catch {
    // Last resort: fix invalid structures. This should be rare; if it happens
    // often, it indicates a bug in the operation application logic.
    if (updated.forwardOnly === true) {
      updated.fix({ forwardOnly: true });
      updated.validate({ forwardOnly: true });
    } else {
      updated.fix();
      updated.validate();
    }
  }

  CreatureUtil.makeUUID(updated);
  return updated;
}
