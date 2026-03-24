import type { CreatureExport } from "../CreatureInterfaces.ts";
import { CreatureUtil } from "../CreatureUtils.ts";
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
  const next: CreatureExport = JSON.parse(
    JSON.stringify(base),
  ) as CreatureExport;

  const ops: CoordinatedStructuralOperation[] = candidate.operations ?? [];
  if (!Array.isArray(ops) || ops.length === 0) {
    return creature;
  }

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
        const existingIndex = next.neurons.findIndex((n) =>
          n.id === op.neuronId
        );
        if (existingIndex >= 0) {
          // Some exports treat neuron entries as readonly, so replace the object.
          next.neurons[existingIndex] = {
            ...next.neurons[existingIndex],
            id: op.neuronId,
            type: op.neuronType,
            squash: op.squash,
            bias: op.bias,
          };
          continue;
        }

        const newNeuron = {
          id: op.neuronId,
          type: op.neuronType,
          squash: op.squash,
          bias: op.bias,
        };

        if (typeof op.insertBeforeNeuronId === "number") {
          const beforeIdx = next.neurons.findIndex((n) =>
            n.id === op.insertBeforeNeuronId
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
        const neuronId = op.neuronId;
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
        continue;
      }

      case "changeSquash": {
        const n = next.neurons.find((x) => x.id === op.neuronId);
        if (n) n.squash = op.squash;
        continue;
      }

      case "setBias": {
        const n = next.neurons.find((x) => x.id === op.neuronId);
        if (n) n.bias = op.bias;
        continue;
      }

      case "removeSynapse": {
        const existing = next.synapses.find((s) =>
          s.fromId === op.fromNeuronId && s.toId === op.toNeuronId
        );
        if (existing) {
          removedSynapseMeta.set(
            edgeKey(op.fromNeuronId, op.toNeuronId),
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
            s.fromId === op.fromNeuronId &&
            s.toId === op.toNeuronId
          )
        );
        if (next.synapses.length !== before) {
          cleanupMemeticForRemovedSynapse(
            next,
            op.fromNeuronId,
            op.toNeuronId,
          );
        }
        continue;
      }

      case "addSynapse": {
        // Ensure both endpoints exist; avoid crashing on stale ops.
        const existingNeuronIds = new Set<number>();
        const inputCount = next.input ?? 0;
        for (let i = 0; i < inputCount; i++) {
          existingNeuronIds.add(i);
        }
        for (const n of next.neurons) existingNeuronIds.add(n.id!);
        if (
          !existingNeuronIds.has(op.fromNeuronId) ||
          !existingNeuronIds.has(op.toNeuronId)
        ) {
          continue;
        }

        if (
          !canAddForwardOnlySynapse(next, op.fromNeuronId, op.toNeuronId)
        ) {
          continue;
        }

        const existing = next.synapses.find((s) =>
          s.fromId === op.fromNeuronId && s.toId === op.toNeuronId
        );
        if (existing) {
          existing.weight = op.weight;
        } else {
          const meta = removedSynapseMeta.get(
            edgeKey(op.fromNeuronId, op.toNeuronId),
          );
          next.synapses.push({
            fromId: op.fromNeuronId,
            toId: op.toNeuronId,
            weight: op.weight,
            type: meta?.type,
            tags: meta?.tags ? meta.tags.map((t) => ({ ...t })) : undefined,
          });
        }
        continue;
      }

      case "setWeight": {
        const existing = next.synapses.find((s) =>
          s.fromId === op.fromNeuronId && s.toId === op.toNeuronId
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
