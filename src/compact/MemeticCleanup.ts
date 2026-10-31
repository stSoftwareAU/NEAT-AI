import type {
  MemeticAncestorSnapshot,
  MemeticInterface,
} from "@blackbox/MemeticInterface.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

/**
 * Resolves a runtime neuron id to a wire label using `CreatureExport` metadata.
 * Returns undefined when `id` fields are absent on neurons (pure wire JSON).
 */
function runtimeNeuronIdToWireLabel(
  exp: CreatureExport,
  id: number,
): string | undefined {
  const inCount = exp.input ?? 0;
  for (let i = 0; i < inCount; i++) {
    if (i === id) return `input-${i}`;
  }
  for (const n of exp.neurons) {
    const nid = (n as { id?: number }).id;
    if (nid === id && typeof n.uuid === "string") {
      return n.uuid;
    }
  }
  return undefined;
}

/**
 * Deletes memetic data if the removed synapse is referenced in it.
 *
 * @param creatureExport - The CreatureExport to clean up (modified in place).
 * @param fromId - Runtime source neuron id (legacy map) or resolvable via export ids for wire-array memetic.
 * @param toId - Runtime target neuron id.
 */
export function cleanupMemeticForRemovedSynapse(
  creatureExport: CreatureExport,
  fromId: number,
  toId: number,
): void {
  const memetic = creatureExport.memetic;
  if (!memetic?.weights) return;

  // deno-lint-ignore no-explicit-any
  const w = memetic.weights as any;
  if (Array.isArray(w)) {
    const fromLabel = runtimeNeuronIdToWireLabel(creatureExport, fromId);
    const toLabel = runtimeNeuronIdToWireLabel(creatureExport, toId);
    if (
      fromLabel &&
      toLabel &&
      w.some(
        (row: { fromUUID: string; toUUID: string }) =>
          row.fromUUID === fromLabel && row.toUUID === toLabel,
      )
    ) {
      delete creatureExport.memetic;
    }
    return;
  }

  const weights = w[fromId];
  if (weights?.some((entry: { toId: number }) => entry.toId === toId)) {
    delete creatureExport.memetic;
  }
}

/**
 * Deletes memetic data if the removed neuron is referenced in it.
 *
 * @param creatureExport - The CreatureExport to clean up (modified in place).
 * @param neuronRef - Runtime id for legacy memetic maps, or wire `uuid` / `input-N` when memetic uses array weights or string bias keys (e.g. after `exportJSON()`).
 */
export function cleanupMemeticForRemovedNeuron(
  creatureExport: CreatureExport,
  neuronRef: number | string,
): void {
  const memetic = creatureExport.memetic;
  if (!memetic) return;

  const wireLabel = typeof neuronRef === "string"
    ? neuronRef
    : runtimeNeuronIdToWireLabel(creatureExport, neuronRef);

  // deno-lint-ignore no-explicit-any
  const weightsAny = memetic.weights as any;
  if (Array.isArray(weightsAny)) {
    if (
      wireLabel &&
      weightsAny.some(
        (row: { fromUUID?: string; toUUID?: string }) =>
          row.fromUUID === wireLabel || row.toUUID === wireLabel,
      )
    ) {
      delete creatureExport.memetic;
      return;
    }
  } else if (memetic.weights && typeof neuronRef === "number") {
    if (weightsAny[neuronRef]) {
      delete creatureExport.memetic;
      return;
    }
    for (const entries of Object.values(weightsAny)) {
      if (
        Array.isArray(entries) &&
        entries.some((entry: { toId: number }) => entry.toId === neuronRef)
      ) {
        delete creatureExport.memetic;
        return;
      }
    }
  }

  const biases = memetic.biases as Record<string, number> | undefined;
  if (wireLabel !== undefined && biases?.[wireLabel] !== undefined) {
    delete creatureExport.memetic;
    return;
  }
  if (typeof neuronRef === "number" && biases?.[neuronRef] !== undefined) {
    delete creatureExport.memetic;
  }
}

type MemeticBiasWeights = {
  biases?: Record<number, number>;
  weights?: Record<number, { toId: number; weight: number }[]>;
};

/** Minimal creature shape for memetic pruning (avoids importing {@link Creature}). */
export type MemeticPruneTarget = {
  memetic?: MemeticInterface;
  neurons: { id: number }[];
  synapses: { from: number; to: number }[];
};

/**
 * Drops memetic biases/weights that reference neurons or synapses no longer
 * present on the live creature.
 *
 * Structural repair (`fix()`, orphan cleanup, some mutations) can remove
 * neurons or synapses while leaving copied memetic snapshots intact; strict
 * validation then fails with MEMETIC. This pass keeps valid entries only.
 *
 * `loadFrom` also runs it on ingest (Issue #4062), so a memetic written by an
 * earlier release that names structure the file lacks is pruned on load. It
 * works on the runtime integer-keyed shape; in a snapshot whose `weights` is
 * still the wire array shape, only that `weights` is skipped (its `biases` are
 * still checked).
 *
 * @returns The number of bias keys and weight rows removed. A weight array
 *   dropped whole because its source neuron is gone counts once.
 */
export function pruneOrphanMemeticReferences(
  creature: MemeticPruneTarget,
): number {
  const memetic = creature.memetic;
  if (!memetic) return 0;

  const validIds = new Set<number>();
  for (const n of creature.neurons) {
    validIds.add(n.id);
  }

  const synapseKeys = new Set<string>();
  for (const s of creature.synapses) {
    const fromN = creature.neurons[s.from];
    const toN = creature.neurons[s.to];
    if (fromN?.id !== undefined && toN?.id !== undefined) {
      synapseKeys.add(`${fromN.id}->${toN.id}`);
    }
  }

  let removed = 0;
  const pruneSubtree = (node: MemeticBiasWeights): void => {
    const biases = node.biases as Record<string, number> | undefined;
    if (biases) {
      for (const k of Object.keys(biases)) {
        const id = Number(k);
        if (!validIds.has(id)) {
          delete biases[k];
          removed++;
        }
      }
    }

    const weights = node.weights as
      | Record<string, { toId: number; weight: number }[]>
      | undefined;
    // Issue #4062: a wire `weights` array is not the runtime map keyed by
    // neuron id; deleting its slots would corrupt it, so leave it untouched.
    if (!weights || Array.isArray(weights)) return;

    for (const k of Object.keys(weights)) {
      const fromId = Number(k);
      if (!validIds.has(fromId)) {
        delete weights[k];
        removed++;
        continue;
      }
      const arr = weights[k];
      if (!Array.isArray(arr)) continue;
      const filtered = arr.filter(
        (w) =>
          validIds.has(w.toId) &&
          synapseKeys.has(`${fromId}->${w.toId}`),
      );
      removed += arr.length - filtered.length;
      if (filtered.length === 0) {
        delete weights[k];
      } else if (filtered.length !== arr.length) {
        weights[k] = filtered;
      }
    }
  };

  pruneSubtree(memetic);

  if (Array.isArray(memetic.ancestry)) {
    for (const snap of memetic.ancestry as MemeticAncestorSnapshot[]) {
      pruneSubtree(snap);
    }
  }
  return removed;
}

/**
 * Removes memetic rows and bias keys that reference a synapse or neuron the
 * exported creature does not contain (Issue #4062).
 *
 * Operates on the UUID-only wire JSON, in place, and never on the live
 * creature. A weight row survives only when its `(fromUUID, toUUID)` pair is a
 * synapse in `json.synapses`; a bias key survives only when it names a neuron
 * in `json.neurons`, an `input-N` or an `output-N`. Every `ancestry[]`
 * snapshot is checked against the same sets. A legacy map-shaped `weights`
 * value is left untouched. Valid rows are never removed.
 *
 * @param json - The exported creature (modified in place).
 * @returns The number of weight rows and bias keys removed.
 */
export function pruneDanglingMemeticFromExport(json: CreatureExport): number {
  const memetic = json.memetic;
  if (!memetic) return 0;

  const pairKey = (from: string, to: string) => JSON.stringify([from, to]);
  const pairs = new Set<string>();
  for (const s of json.synapses ?? []) {
    if (typeof s.fromUUID === "string" && typeof s.toUUID === "string") {
      pairs.add(pairKey(s.fromUUID, s.toUUID));
    }
  }
  const labels = new Set<string>();
  for (let i = 0; i < (json.input ?? 0); i++) labels.add(`input-${i}`);
  for (let i = 0; i < (json.output ?? 0); i++) labels.add(`output-${i}`);
  for (const n of json.neurons ?? []) {
    if (typeof n.uuid === "string") labels.add(n.uuid);
  }

  let removed = 0;
  const prune = (snap: unknown): void => {
    if (typeof snap !== "object" || snap === null) return;
    const node = snap as {
      weights?: unknown;
      biases?: unknown;
      ancestry?: unknown;
    };
    if (Array.isArray(node.weights)) {
      const kept = node.weights.filter((row: unknown) => {
        const r = row as { fromUUID?: unknown; toUUID?: unknown } | null;
        return typeof r?.fromUUID === "string" &&
          typeof r.toUUID === "string" &&
          pairs.has(pairKey(r.fromUUID, r.toUUID));
      });
      removed += node.weights.length - kept.length;
      node.weights = kept;
    }
    const biases = node.biases;
    if (
      typeof biases === "object" && biases !== null && !Array.isArray(biases)
    ) {
      const map = biases as Record<string, unknown>;
      for (const key of Object.keys(map)) {
        if (!labels.has(key)) {
          delete map[key];
          removed++;
        }
      }
    }
    if (Array.isArray(node.ancestry)) {
      for (const a of node.ancestry) prune(a);
    }
  };
  prune(memetic);
  return removed;
}
