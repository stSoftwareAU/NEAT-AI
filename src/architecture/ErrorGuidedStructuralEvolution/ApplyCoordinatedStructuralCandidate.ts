import type { CreatureExport } from "../CreatureInterfaces.ts";
import { CreatureUtil } from "../CreatureUtils.ts";
import { Creature } from "../../Creature.ts";
import { cleanupMemeticForRemovedSynapse } from "../../compact/CompactUtils.ts";
import type {
  CoordinatedStructuralCandidate,
  CoordinatedStructuralOperation,
} from "./CoordinatedStructuralCandidate.ts";

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

    if (op.type === "addNeuron") {
      // Ensure deterministic idempotency: if neuron already exists, update fields.
      const existingIndex = next.neurons.findIndex((n) =>
        n.uuid === op.neuronUuid
      );
      if (existingIndex >= 0) {
        // Some exports treat neuron entries as readonly, so replace the object.
        next.neurons[existingIndex] = {
          ...next.neurons[existingIndex],
          uuid: op.neuronUuid,
          type: op.neuronType,
          squash: op.squash,
          bias: op.bias,
        };
        continue;
      }

      const newNeuron = {
        uuid: op.neuronUuid,
        type: op.neuronType,
        squash: op.squash,
        bias: op.bias,
      };

      if (typeof op.insertBeforeNeuronUuid === "string") {
        const beforeIdx = next.neurons.findIndex((n) =>
          n.uuid === op.insertBeforeNeuronUuid
        );
        if (beforeIdx >= 0) {
          next.neurons.splice(beforeIdx, 0, newNeuron);
          continue;
        }
      }

      // Default: append at the end (safe for non-forward-only creatures).
      next.neurons.push(newNeuron);
      continue;
    }

    if (op.type === "removeNeuron") {
      const uuid = op.neuronUuid;
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
      continue;
    }

    if (op.type === "changeSquash") {
      const n = next.neurons.find((x) => x.uuid === op.neuronUuid);
      if (n) n.squash = op.squash;
      continue;
    }

    if (op.type === "setBias") {
      const n = next.neurons.find((x) => x.uuid === op.neuronUuid);
      if (n) n.bias = op.bias;
      continue;
    }

    if (op.type === "removeSynapse") {
      const existing = next.synapses.find((s) =>
        s.fromUUID === op.fromNeuronUuid && s.toUUID === op.toNeuronUuid
      );
      if (existing) {
        removedSynapseMeta.set(edgeKey(op.fromNeuronUuid, op.toNeuronUuid), {
          type: existing.type,
          tags: existing.tags
            ? existing.tags.map((t) => ({ ...t }))
            : undefined,
        });
      }
      const before = next.synapses.length;
      next.synapses = next.synapses.filter((s) =>
        !(s.fromUUID === op.fromNeuronUuid && s.toUUID === op.toNeuronUuid)
      );
      if (next.synapses.length !== before) {
        cleanupMemeticForRemovedSynapse(
          next,
          op.fromNeuronUuid,
          op.toNeuronUuid,
        );
      }
      continue;
    }

    if (op.type === "addSynapse") {
      // Ensure both endpoints exist; avoid crashing on stale ops.
      const existingNeuronUUIDs = new Set<string>();
      const inputCount = next.input ?? 0;
      for (let i = 0; i < inputCount; i++) {
        existingNeuronUUIDs.add(`input-${i}`);
      }
      for (const n of next.neurons) existingNeuronUUIDs.add(n.uuid);
      if (
        !existingNeuronUUIDs.has(op.fromNeuronUuid) ||
        !existingNeuronUUIDs.has(op.toNeuronUuid)
      ) {
        continue;
      }

      if (!canAddForwardOnlySynapse(next, op.fromNeuronUuid, op.toNeuronUuid)) {
        continue;
      }

      const existing = next.synapses.find((s) =>
        s.fromUUID === op.fromNeuronUuid && s.toUUID === op.toNeuronUuid
      );
      if (existing) {
        existing.weight = op.weight;
      } else {
        const meta = removedSynapseMeta.get(
          edgeKey(op.fromNeuronUuid, op.toNeuronUuid),
        );
        next.synapses.push({
          fromUUID: op.fromNeuronUuid,
          toUUID: op.toNeuronUuid,
          weight: op.weight,
          type: meta?.type,
          tags: meta?.tags ? meta.tags.map((t) => ({ ...t })) : undefined,
        });
      }
      continue;
    }
  }

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
