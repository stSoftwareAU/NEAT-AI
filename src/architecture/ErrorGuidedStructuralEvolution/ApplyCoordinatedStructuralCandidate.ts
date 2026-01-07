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

// Local operation shapes (kept small and structural so the editor stays happy even
// if its module graph gets temporarily out-of-date). Deno `check` remains the
// source-of-truth for type safety.
type AddNeuronOp = {
  type: "addNeuron";
  neuronUuid: string;
  neuronType: "hidden" | "output";
  squash: string;
  bias: number;
  insertBeforeNeuronUuid?: string;
};

type RemoveNeuronOp = { type: "removeNeuron"; neuronUuid: string };
type ChangeSquashOp = {
  type: "changeSquash";
  neuronUuid: string;
  squash: string;
};
type SetBiasOp = { type: "setBias"; neuronUuid: string; bias: number };
type RemoveSynapseOp = {
  type: "removeSynapse";
  fromNeuronUuid: string;
  toNeuronUuid: string;
};
type AddSynapseOp = {
  type: "addSynapse";
  fromNeuronUuid: string;
  toNeuronUuid: string;
  weight: number;
};

function buildUuidToIndexMap(creature: CreatureExport): Map<string, number> {
  const uuidToIndex = new Map<string, number>();
  const inputCount = creature.input ?? 0;
  for (let i = 0; i < inputCount; i++) {
    uuidToIndex.set(`input-${i}`, i);
  }
  for (let i = 0; i < creature.neurons.length; i++) {
    uuidToIndex.set(creature.neurons[i].uuid, inputCount + i);
  }
  return uuidToIndex;
}

function canAddForwardOnlySynapse(
  creature: CreatureExport,
  fromUUID: string,
  toUUID: string,
): boolean {
  if (creature.forwardOnly !== true) {
    return true;
  }
  const uuidToIndex = buildUuidToIndexMap(creature);
  const from = uuidToIndex.get(fromUUID);
  const to = uuidToIndex.get(toUUID);
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

  const edgeKey = (fromUUID: string, toUUID: string): string =>
    `${fromUUID}→${toUUID}`;

  for (const op of ops) {
    if (!op || typeof op.type !== "string") continue;

    if ((op.type as string) === "addNeuron") {
      const add = op as unknown as AddNeuronOp;
      // Ensure deterministic idempotency: if neuron already exists, update fields.
      const existingIndex = next.neurons.findIndex((n) =>
        n.uuid === add.neuronUuid
      );
      if (existingIndex >= 0) {
        // Some exports treat neuron entries as readonly, so replace the object.
        next.neurons[existingIndex] = {
          ...next.neurons[existingIndex],
          uuid: add.neuronUuid,
          type: add.neuronType,
          squash: add.squash,
          bias: add.bias,
        };
        continue;
      }

      const newNeuron = {
        uuid: add.neuronUuid,
        type: add.neuronType,
        squash: add.squash,
        bias: add.bias,
      };

      if (typeof add.insertBeforeNeuronUuid === "string") {
        const beforeIdx = next.neurons.findIndex((n) =>
          n.uuid === add.insertBeforeNeuronUuid
        );
        if (beforeIdx >= 0) {
          next.neurons.splice(beforeIdx, 0, newNeuron);
          continue;
        }

        // `insertBeforeNeuronUuid` is an explicit ordering intent. If the target
        // neuron is missing and this creature is forward-only, appending would
        // violate layer ordering (hidden after output). Treat as a no-op instead.
        if (next.forwardOnly === true) {
          continue;
        }
      }

      // Default placement must preserve the invariant that hidden neurons appear
      // before output neurons (even when recurrent connections are allowed).
      if (add.neuronType === "hidden") {
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

    if ((op.type as string) === "removeNeuron") {
      const remove = op as unknown as RemoveNeuronOp;
      const uuid = remove.neuronUuid;
      const beforeNeuronCount = next.neurons.length;
      next.neurons = next.neurons.filter((n) => n.uuid !== uuid);
      if (next.neurons.length === beforeNeuronCount) {
        // No-op if neuron didn't exist (idempotent).
        continue;
      }

      // Remove any synapses that reference the neuron, and clean up memetic state.
      const removedEdges: Array<{ fromUUID: string; toUUID: string }> = [];
      for (const s of next.synapses) {
        if (s.fromUUID === uuid || s.toUUID === uuid) {
          removedEdges.push({ fromUUID: s.fromUUID, toUUID: s.toUUID });
        }
      }
      next.synapses = next.synapses.filter((s) =>
        !(s.fromUUID === uuid || s.toUUID === uuid)
      );
      for (const e of removedEdges) {
        cleanupMemeticForRemovedSynapse(next, e.fromUUID, e.toUUID);
      }
      cleanupMemeticForRemovedNeuron(next, uuid);
      continue;
    }

    if ((op.type as string) === "changeSquash") {
      const change = op as unknown as ChangeSquashOp;
      const n = next.neurons.find((x) => x.uuid === change.neuronUuid);
      if (n) n.squash = change.squash;
      continue;
    }

    if ((op.type as string) === "setBias") {
      const set = op as unknown as SetBiasOp;
      const n = next.neurons.find((x) => x.uuid === set.neuronUuid);
      if (n) n.bias = set.bias;
      continue;
    }

    if ((op.type as string) === "removeSynapse") {
      const remove = op as unknown as RemoveSynapseOp;
      const existing = next.synapses.find((s) =>
        s.fromUUID === remove.fromNeuronUuid && s.toUUID === remove.toNeuronUuid
      );
      if (existing) {
        removedSynapseMeta.set(
          edgeKey(remove.fromNeuronUuid, remove.toNeuronUuid),
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
          s.fromUUID === remove.fromNeuronUuid &&
          s.toUUID === remove.toNeuronUuid
        )
      );
      if (next.synapses.length !== before) {
        cleanupMemeticForRemovedSynapse(
          next,
          remove.fromNeuronUuid,
          remove.toNeuronUuid,
        );
      }
      continue;
    }

    if ((op.type as string) === "addSynapse") {
      const add = op as unknown as AddSynapseOp;
      // Ensure both endpoints exist; avoid crashing on stale ops.
      const existingNeuronUUIDs = new Set<string>();
      const inputCount = next.input ?? 0;
      for (let i = 0; i < inputCount; i++) {
        existingNeuronUUIDs.add(`input-${i}`);
      }
      for (const n of next.neurons) existingNeuronUUIDs.add(n.uuid);
      if (
        !existingNeuronUUIDs.has(add.fromNeuronUuid) ||
        !existingNeuronUUIDs.has(add.toNeuronUuid)
      ) {
        continue;
      }

      if (
        !canAddForwardOnlySynapse(next, add.fromNeuronUuid, add.toNeuronUuid)
      ) {
        continue;
      }

      const existing = next.synapses.find((s) =>
        s.fromUUID === add.fromNeuronUuid && s.toUUID === add.toNeuronUuid
      );
      if (existing) {
        existing.weight = add.weight;
      } else {
        const meta = removedSynapseMeta.get(
          edgeKey(add.fromNeuronUuid, add.toNeuronUuid),
        );
        next.synapses.push({
          fromUUID: add.fromNeuronUuid,
          toUUID: add.toNeuronUuid,
          weight: add.weight,
          type: meta?.type,
          tags: meta?.tags ? meta.tags.map((t) => ({ ...t })) : undefined,
        });
      }
      continue;
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
