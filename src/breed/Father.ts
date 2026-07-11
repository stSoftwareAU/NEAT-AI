import type { Creature } from "@creature";
import type { Neuron } from "@architecture/Neuron.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { stripNumericIdsFromCreatureExport } from "@creature/CreatureSerialization.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { isOutputNeuronId, outputIndexFromId } from "@architecture/NeuronId.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import { neuronUuid } from "@neuron/NeuronSerialization.ts";
import {
  computeSharedAnchorSyntheticUuids,
  computeSharedAnchorSyntheticUuidsExport,
  computeSyntheticLocationUuids,
  computeSyntheticLocationUuidsExport,
} from "@breed/SyntheticLocationUuid.ts";

/**
 * Default threshold for the synthetic-UUID alignment fallback (Issue #2614).
 * Mirrors `NeatArguments.syntheticAlignmentThreshold` so callers that omit
 * the option get the same behaviour as the configured pipeline default.
 */
const DEFAULT_SYNTHETIC_ALIGNMENT_THRESHOLD = 0.2;

/**
 * Lightweight neuron info needed for compatibility check.
 * Avoids full JSON export overhead.
 */
interface NeuronInfo {
  id: number;
  type: "input" | "hidden" | "output" | "constant";
  bias: number;
  squash?: string;
}

/**
 * Synapse maps used for building composite neuron keys.
 * Issue #1444: Consolidated from duplicate implementations.
 */
interface SynapseMaps {
  /** Maps source neuron ID to sorted list of destination neuron IDs */
  fromMap: Map<number, number[]>;
  /** Maps destination neuron ID to sorted list of source neuron IDs */
  toMap: Map<number, number[]>;
}

/**
 * Builds adjacency lists for connectivity fingerprints (issues #448, #1444, #1644).
 *
 * **Procedure is unchanged since the pre–Issue #1958 implementation:** the
 * same O(n) per-synapse insertion and per-list sort, then `buildNeuronKey`.
 * Only the endpoint type changed: **wire UUID strings** (`Map<string,
 * string[]>`) before #1958, **runtime integer ids** (`Map<number, number[]>`)
 * after — see `git show 0926664c^:src/breed/Father.ts` for the last
 * UUID-string version. `normaliseCreatureExport` must populate `fromId`/`toId`
 * on exports before key generation.
 *
 * Stable UUID alignment in `createCompatibleFather*` runs **before** key
 * matching; it does not change how keys are computed.
 */
function buildSynapseMaps(
  synapseCount: number,
  getFromId: (index: number) => number,
  getToId: (index: number) => number,
): SynapseMaps {
  const fromMap = new Map<number, number[]>();
  const toMap = new Map<number, number[]>();

  for (let i = 0; i < synapseCount; i++) {
    const fromId = getFromId(i);
    const toId = getToId(i);

    let fromList = fromMap.get(fromId);
    if (!fromList) {
      fromList = [];
      fromMap.set(fromId, fromList);
    }
    fromList.push(toId);

    let toList = toMap.get(toId);
    if (!toList) {
      toList = [];
      toMap.set(toId, toList);
    }
    toList.push(fromId);
  }

  // Sort individual per-neuron lists for consistent key generation
  for (const list of fromMap.values()) {
    list.sort();
  }
  for (const list of toMap.values()) {
    list.sort();
  }

  return { fromMap, toMap };
}

/**
 * Composite key: `sortedIncomingIds.join("-") + "|" + sortedOutgoingIds.join("-")`.
 * Same string shape as pre-#1958 when lists held UUID strings instead of ids.
 */
function buildNeuronKey(
  id: number,
  synapseMaps: SynapseMaps,
): string {
  const incomingKeys = (synapseMaps.toMap.get(id) || []).join("-");
  const outgoingKeys = (synapseMaps.fromMap.get(id) || []).join("-");
  return `${incomingKeys}|${outgoingKeys}`;
}

/**
 * Generates a key map from Creature objects directly without JSON export.
 * Issue #1034: Optimised version. Issue #1444: Uses consolidated buildSynapseMaps.
 */
function generateNeuronKeyMapFromCreature(
  creature: Creature,
): Map<string, NeuronInfo> {
  const keyMap = new Map<string, NeuronInfo>();
  const neurons = creature.neurons;
  const synapses = creature.synapses;

  // Build ID lookup for neurons (for converting synapse indices to UUIDs)
  const indexToId: number[] = new Array(neurons.length);
  for (let i = 0; i < neurons.length; i++) {
    indexToId[i] = neurons[i].id;
  }

  const synapseMaps = buildSynapseMaps(
    synapses.length,
    (i) => indexToId[synapses[i].from],
    (i) => indexToId[synapses[i].to],
  );

  for (const neuron of neurons) {
    if (neuron.type === "hidden") {
      const key = buildNeuronKey(neuron.id!, synapseMaps);
      keyMap.set(key, {
        id: neuron.id,
        type: neuron.type,
        bias: neuron.bias,
        squash: neuron.squash,
      });
    }
  }

  return keyMap;
}

/**
 * Generates a key map from CreatureExport without array spread/sort overhead.
 * Issue #1444: Uses consolidated buildSynapseMaps instead of [...synapses].sort().
 */
function generateNeuronKeyMap(
  creature: CreatureExport,
): Map<string, NeuronExport> {
  const keyMap = new Map<string, NeuronExport>();
  const synapses = creature.synapses;

  const synapseMaps = buildSynapseMaps(
    synapses.length,
    (i) => synapses[i].fromId!,
    (i) => synapses[i].toId!,
  );

  for (const neuron of creature.neurons) {
    if (neuron.type === "hidden") {
      const key = buildNeuronKey(neuron.id!, synapseMaps);
      keyMap.set(key, neuron);
    }
  }

  return keyMap;
}

/**
 * Align hidden/constant neurons by stable wire `uuid` before connectivity-key
 * matching. Same genome on different machines shares uuids but may have
 * different runtime ids — uuid alignment is authoritative for lineage.
 */
function applyStableUuidAlignmentExport(
  motherNeurons: CreatureExport["neurons"],
  fatherNeurons: CreatureExport["neurons"],
  idMapping: Map<number, number>,
  usedMotherIds: Set<number>,
  usedFatherIds: Set<number>,
  fatherIds: Set<number>,
): void {
  const motherByUuid = new Map<string, number>();
  for (const n of motherNeurons) {
    if (n.type !== "hidden" && n.type !== "constant") continue;
    const u = n.uuid;
    if (typeof u === "string" && u.length > 0 && n.id !== undefined) {
      motherByUuid.set(u, n.id);
    }
  }
  for (const n of fatherNeurons) {
    if (n.type !== "hidden" && n.type !== "constant") continue;
    const u = n.uuid;
    if (typeof u !== "string" || u.length === 0 || n.id === undefined) continue;
    const motherId = motherByUuid.get(u);
    if (motherId === undefined) continue;
    if (fatherIds.has(motherId)) continue;
    if (usedMotherIds.has(motherId)) continue;
    if (usedFatherIds.has(n.id)) continue;
    idMapping.set(n.id, motherId);
    usedMotherIds.add(motherId);
    usedFatherIds.add(n.id);
  }
}

/**
 * Collects hidden-neuron wire UUIDs from a `CreatureExport` for the
 * real-UUID overlap pre-check (Issue #2614). Mirrors the behaviour of
 * `Creature.getHiddenNeuronWireKeys()` for the export shape.
 */
function collectHiddenWireUuidsFromExport(
  creature: CreatureExport,
): Set<string> {
  const out = new Set<string>();
  for (const n of creature.neurons) {
    if (n.type !== "hidden") continue;
    if (typeof n.uuid === "string" && n.uuid.length > 0) {
      out.add(n.uuid);
    } else if ((n as { id?: number }).id !== undefined) {
      out.add(String((n as { id: number }).id));
    }
  }
  return out;
}

/**
 * Computes the real-UUID overlap ratio used to gate the synthetic-UUID
 * alignment fallback (Issue #2614). The numerator is the number of
 * hidden-neuron UUIDs shared between the two sets; the denominator is the
 * smaller of the two set sizes — matching the ratio used by
 * `geneticCompatibility`. Returns `1` when both sets are empty so empty
 * topologies are treated as fully compatible (the fallback never fires).
 */
function realUuidOverlapRatio(
  motherUuids: Set<string>,
  fatherUuids: Set<string>,
): number {
  const smallest = motherUuids.size < fatherUuids.size
    ? motherUuids
    : fatherUuids;
  const other = motherUuids.size < fatherUuids.size ? fatherUuids : motherUuids;
  if (smallest.size === 0) return 1;
  let matches = 0;
  for (const u of smallest) {
    if (other.has(u)) matches++;
  }
  return matches / smallest.size;
}

/**
 * Issue #2655 — compute the set of hidden/constant wire UUIDs shared between
 * mother and father from already-collected wire-UUID sets. Used to seed the
 * shared-anchor synthetic-UUID pass so each shared neuron becomes an extra
 * alignment anchor.
 */
function computeSharedHiddenUuids(
  motherUuids: ReadonlySet<string>,
  fatherUuids: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  const [smaller, larger] = motherUuids.size < fatherUuids.size
    ? [motherUuids, fatherUuids]
    : [fatherUuids, motherUuids];
  for (const u of smaller) {
    if (larger.has(u)) out.add(u);
  }
  return out;
}

/**
 * Issue #2655 — merge two synthetic-UUID maps (per-neuron-id Sets) into a
 * single map, mutating `target` in place. Used to combine the I/O-anchor
 * and shared-anchor synthetic IDs before invoking
 * `applySyntheticUuidAlignment` so the loose-match rule (first match wins)
 * applies across both anchor sources.
 */
function mergeSyntheticMaps(
  target: Map<number, Set<string>>,
  extra: ReadonlyMap<number, ReadonlySet<string>>,
): void {
  for (const [id, set] of extra) {
    let existing = target.get(id);
    if (!existing) {
      existing = new Set<string>();
      target.set(id, existing);
    }
    for (const v of set) existing.add(v);
  }
}

/**
 * Synthetic-UUID alignment fallback (Issue #2614).
 *
 * Builds `Map<syntheticUUID, motherNeuronId>` from the mother's hidden
 * neurons, then walks each father hidden/constant neuron and aligns it
 * to a mother id if **either** of its two synthetic UUIDs matches a key
 * in the map (loose match — first match wins, input anchor preferred).
 *
 * Existing usage guards still apply: an alignment is only recorded when
 * `motherId` is not already present in the father's id space, when no
 * other father neuron has already claimed the mother id, and when the
 * father neuron itself has not already been aligned by an earlier pass.
 *
 * Aligned neurons inherit the mother's real UUID via the existing
 * remap step in `createCompatibleFather*`. Synthetic UUIDs are never
 * written into a neuron, the `idMapping`, or the resulting export.
 */
function applySyntheticUuidAlignment(
  motherSynthByMotherId: Map<number, Set<string>>,
  fatherSynthByFatherId: Map<number, Set<string>>,
  idMapping: Map<number, number>,
  usedMotherIds: Set<number>,
  usedFatherIds: Set<number>,
  fatherIds: Set<number>,
): void {
  if (
    motherSynthByMotherId.size === 0 ||
    fatherSynthByFatherId.size === 0
  ) {
    return;
  }

  // Build synthetic→mother-id index. When a synthetic UUID is shared by
  // multiple mother neurons (rare but possible at the same anchor/steps/sign
  // bucket once any mother neuron is bias-only and skipped above), keep the
  // smallest mother id for deterministic behaviour.
  const motherBySynthetic = new Map<string, number>();
  for (const [motherId, synthSet] of motherSynthByMotherId) {
    for (const synth of synthSet) {
      const existing = motherBySynthetic.get(synth);
      if (existing === undefined || motherId < existing) {
        motherBySynthetic.set(synth, motherId);
      }
    }
  }

  for (const [fatherId, synthSet] of fatherSynthByFatherId) {
    if (usedFatherIds.has(fatherId)) continue;
    for (const synth of synthSet) {
      const motherId = motherBySynthetic.get(synth);
      if (motherId === undefined) continue;
      if (fatherIds.has(motherId)) continue;
      if (usedMotherIds.has(motherId)) continue;
      // First match wins (loose match rule, Issue #2614).
      idMapping.set(fatherId, motherId);
      usedMotherIds.add(motherId);
      usedFatherIds.add(fatherId);
      break;
    }
  }
}

function applyStableUuidAlignmentCreatures(
  motherNeurons: Neuron[],
  fatherNeurons: Neuron[],
  idMapping: Map<number, number>,
  usedMotherIds: Set<number>,
  usedFatherIds: Set<number>,
  fatherIds: Set<number>,
): void {
  const motherByUuid = new Map<string, number>();
  for (const n of motherNeurons) {
    if (n.type !== "hidden" && n.type !== "constant") continue;
    const u = n.uuid;
    if (typeof u === "string" && u.length > 0) {
      motherByUuid.set(u, n.id);
    }
  }
  for (const n of fatherNeurons) {
    if (n.type !== "hidden" && n.type !== "constant") continue;
    const u = n.uuid;
    if (typeof u !== "string" || u.length === 0) continue;
    const motherId = motherByUuid.get(u);
    if (motherId === undefined) continue;
    if (fatherIds.has(motherId)) continue;
    if (usedMotherIds.has(motherId)) continue;
    if (usedFatherIds.has(n.id)) continue;
    idMapping.set(n.id, motherId);
    usedMotherIds.add(motherId);
    usedFatherIds.add(n.id);
  }
}

export function createCompatibleFather(
  mother: CreatureExport,
  father: CreatureExport,
  syntheticAlignmentThreshold: number = DEFAULT_SYNTHETIC_ALIGNMENT_THRESHOLD,
): CreatureExport {
  normaliseCreatureExport(mother);
  normaliseCreatureExport(father);
  const idMapping = new Map<number, number>();
  const usedMotherIds = new Set<number>();
  const usedFatherIds = new Set<number>();

  // Create a set of all IDs in the mother's neurons
  const motherIds = new Set(mother.neurons.map((neuron) => neuron.id!));

  // Create a set of all IDs in the father's neurons
  const fatherIds = new Set(father.neurons.map((neuron) => neuron.id!));

  if (father.neurons.every((neuron) => motherIds.has(neuron.id!))) {
    return stripNumericIdsFromCreatureExport(structuredClone(father));
  }

  applyStableUuidAlignmentExport(
    mother.neurons,
    father.neurons,
    idMapping,
    usedMotherIds,
    usedFatherIds,
    fatherIds,
  );

  // Issue #2614: When the real-UUID overlap between mother and father is
  // below `syntheticAlignmentThreshold`, fall back to location-based
  // synthetic UUIDs (loose-match — either anchor) so structurally similar
  // but genetically incompatible parents pick up real crossover anchors.
  // The synthetic UUIDs are only consulted here; real UUIDs continue to
  // drive the gene swap below and the resulting export.
  if (syntheticAlignmentThreshold > 0) {
    const motherWireUuids = collectHiddenWireUuidsFromExport(mother);
    const fatherWireUuids = collectHiddenWireUuidsFromExport(father);
    const overlap = realUuidOverlapRatio(motherWireUuids, fatherWireUuids);
    if (overlap < syntheticAlignmentThreshold) {
      const motherSynth = computeSyntheticLocationUuidsExport(mother);
      const fatherSynth = computeSyntheticLocationUuidsExport(father);
      // Issue #2655: every neuron whose real UUID is shared between both
      // parents becomes an additional alignment anchor. Synthetic IDs from
      // shared anchors merge into the same per-neuron Set so the loose-match
      // rule (first match wins) applies uniformly across both anchor sources.
      const sharedAnchors = computeSharedHiddenUuids(
        motherWireUuids,
        fatherWireUuids,
      );
      if (sharedAnchors.size > 0) {
        mergeSyntheticMaps(
          motherSynth,
          computeSharedAnchorSyntheticUuidsExport(mother, sharedAnchors),
        );
        mergeSyntheticMaps(
          fatherSynth,
          computeSharedAnchorSyntheticUuidsExport(father, sharedAnchors),
        );
      }
      applySyntheticUuidAlignment(
        motherSynth,
        fatherSynth,
        idMapping,
        usedMotherIds,
        usedFatherIds,
        fatherIds,
      );
    }
  }

  // Generate neuron key maps for both mother and father, using sorted synapses
  const motherKeyMap = generateNeuronKeyMap(mother);
  const fatherKeyMap = generateNeuronKeyMap(father);

  // Step 1b: Identify matching neurons by composite key (connectivity fingerprint).
  // Issue #1644: Direct Map lookup O(1) replaces Array.from().filter() O(n) per key.
  motherKeyMap.forEach((motherNeuron, motherKey) => {
    const matchingFatherNeuron = fatherKeyMap.get(motherKey);

    // Only map IDs that are not already present in the father and have not been used
    if (
      matchingFatherNeuron &&
      !fatherIds.has(motherNeuron.id!) &&
      !usedMotherIds.has(motherNeuron.id!) &&
      !usedFatherIds.has(matchingFatherNeuron.id!)
    ) {
      idMapping.set(matchingFatherNeuron.id!, motherNeuron.id!);
      usedMotherIds.add(motherNeuron.id!);
      usedFatherIds.add(matchingFatherNeuron.id!);
    }
  });

  const motherIdToUuid = new Map<number, string>();
  for (let i = 0; i < mother.input; i++) {
    motherIdToUuid.set(i, `input-${i}`);
  }
  for (const neuron of mother.neurons) {
    if (neuron.type === "output") {
      motherIdToUuid.set(neuron.id!, `output-${outputIndexFromId(neuron.id!)}`);
    } else if (neuron.type === "hidden" || neuron.type === "constant") {
      motherIdToUuid.set(
        neuron.id!,
        neuron.uuid ?? `legacy-neuron-${neuron.id}`,
      );
    }
  }

  const fatherIdToUuid = new Map<number, string>();
  for (let i = 0; i < father.input; i++) {
    fatherIdToUuid.set(i, `input-${i}`);
  }
  for (const neuron of father.neurons) {
    if (neuron.type === "output") {
      fatherIdToUuid.set(neuron.id!, `output-${outputIndexFromId(neuron.id!)}`);
    } else if (neuron.type === "hidden" || neuron.type === "constant") {
      fatherIdToUuid.set(
        neuron.id!,
        neuron.uuid ?? `legacy-neuron-${neuron.id}`,
      );
    }
  }

  // Step 2: Apply ID mappings to neurons, maintaining the original order
  const newNeurons = father.neurons.map((fatherNeuron) => {
    const newId = idMapping.get(fatherNeuron.id!);
    if (newId) {
      // Use the mother's UUID for remapped neurons
      const newUuid = motherIdToUuid.get(newId);
      return {
        ...fatherNeuron,
        id: newId,
        uuid: newUuid ?? fatherNeuron.uuid,
      };
    }
    return fatherNeuron;
  });

  // Build combined ID → UUID map for synapse uuid resolution
  const combinedIdToUuid = new Map<number, string>(fatherIdToUuid);
  for (const neuron of newNeurons) {
    if (neuron.uuid) {
      combinedIdToUuid.set(neuron.id!, neuron.uuid);
    }
  }

  // Step 3: Apply ID mappings to synapses
  const newSynapses = father.synapses.map((synapse) => {
    const updatedFromId = idMapping.get(synapse.fromId!) ??
      synapse.fromId!;
    const updatedToId = idMapping.get(synapse.toId!) ?? synapse.toId!;
    return {
      ...synapse,
      fromId: updatedFromId,
      toId: updatedToId,
      fromUUID: combinedIdToUuid.get(updatedFromId) ?? synapse.fromUUID,
      toUUID: combinedIdToUuid.get(updatedToId) ?? synapse.toUUID,
    };
  });

  // Step 4: Return the updated father creature
  const adjustedFather: CreatureExport = {
    ...father,
    neurons: newNeurons,
    synapses: newSynapses,
  };

  delete adjustedFather.memetic;
  return stripNumericIdsFromCreatureExport(adjustedFather);
}

/**
 * Optimised version of createCompatibleFather that accepts Creature objects directly.
 * Avoids expensive JSON export operations during parent selection.
 *
 * Issue #1034: Performance - Avoid JSON exports in parent selection compatibility check.
 *
 * @param mother - The mother creature (accessed directly, not exported)
 * @param father - The father creature (accessed directly, not exported)
 * @returns A CreatureExport with the father's neurons mapped to be compatible with the mother
 */
export function createCompatibleFatherFromCreatures(
  mother: Creature,
  father: Creature,
  syntheticAlignmentThreshold: number = DEFAULT_SYNTHETIC_ALIGNMENT_THRESHOLD,
): CreatureExport {
  const idMapping = new Map<number, number>();
  const usedMotherIds = new Set<number>();

  const motherNeurons = mother.neurons;
  const fatherNeurons = father.neurons;
  const fatherSynapses = father.synapses;

  // Create a set of all IDs in the father's neurons
  const fatherIds = new Set<number>();
  for (const neuron of fatherNeurons) {
    fatherIds.add(neuron.id);
  }

  const usedFatherIds = new Set<number>();
  applyStableUuidAlignmentCreatures(
    motherNeurons,
    fatherNeurons,
    idMapping,
    usedMotherIds,
    usedFatherIds,
    fatherIds,
  );

  // Issue #2614: synthetic-UUID alignment fallback for genetically
  // incompatible parents — same gating and rules as the export path.
  if (syntheticAlignmentThreshold > 0) {
    const motherWireUuids = mother.getHiddenNeuronWireKeys();
    const fatherWireUuids = father.getHiddenNeuronWireKeys();
    const overlap = realUuidOverlapRatio(motherWireUuids, fatherWireUuids);
    if (overlap < syntheticAlignmentThreshold) {
      const motherSynth = computeSyntheticLocationUuids(mother);
      const fatherSynth = computeSyntheticLocationUuids(father);
      // Issue #2655: shared hidden UUIDs become extra alignment anchors.
      const sharedAnchors = computeSharedHiddenUuids(
        motherWireUuids,
        fatherWireUuids,
      );
      if (sharedAnchors.size > 0) {
        mergeSyntheticMaps(
          motherSynth,
          computeSharedAnchorSyntheticUuids(mother, sharedAnchors),
        );
        mergeSyntheticMaps(
          fatherSynth,
          computeSharedAnchorSyntheticUuids(father, sharedAnchors),
        );
      }
      applySyntheticUuidAlignment(
        motherSynth,
        fatherSynth,
        idMapping,
        usedMotherIds,
        usedFatherIds,
        fatherIds,
      );
    }
  }

  // Generate neuron key maps for both mother and father, using Creature objects directly
  const motherKeyMap = generateNeuronKeyMapFromCreature(mother);
  const fatherKeyMap = generateNeuronKeyMapFromCreature(father);

  // Connectivity-key matching for neurons not aligned by stable uuid above.
  motherKeyMap.forEach((motherNeuron, motherKey) => {
    const matchingFatherNeuron = fatherKeyMap.get(motherKey);

    if (
      matchingFatherNeuron &&
      !fatherIds.has(motherNeuron.id) &&
      !usedMotherIds.has(motherNeuron.id) &&
      !usedFatherIds.has(matchingFatherNeuron.id)
    ) {
      idMapping.set(matchingFatherNeuron.id, motherNeuron.id);
      usedMotherIds.add(motherNeuron.id);
      usedFatherIds.add(matchingFatherNeuron.id);
    }
  });

  // Build index to UUID lookup for father
  const fatherIndexToId: number[] = new Array(fatherNeurons.length);
  for (let i = 0; i < fatherNeurons.length; i++) {
    fatherIndexToId[i] = fatherNeurons[i].id;
  }

  // Issue #2050: Build ID-to-UUID map for mother neurons.
  // Input neurons use id = inputIndex (see NeuronId.ts), so map id `i`
  // directly rather than indexing motherNeurons positionally — a bred or
  // immigrant genome may carry fewer/reordered neuron entries than its
  // declared input count, which made `motherNeurons[i]` undefined.
  const motherIdToUuid = new Map<number, string>();
  for (let i = 0; i < mother.input; i++) {
    motherIdToUuid.set(i, `input-${i}`);
  }
  for (const neuron of motherNeurons) {
    if (neuron.type !== "input") {
      motherIdToUuid.set(neuron.id, neuron.uuid ?? neuronUuid(neuron));
    }
  }

  // Step 2: Build the exported neurons with UUID mappings applied
  // Issue #2050: Build a combined ID → UUID map for synapse uuid resolution
  const combinedIdToUuid = new Map<number, string>();
  for (let i = 0; i < father.input; i++) {
    combinedIdToUuid.set(i, `input-${i}`);
  }

  const newNeurons: NeuronExport[] = [];
  for (const neuron of fatherNeurons) {
    if (neuron.type === "input") continue;

    const newId = idMapping.get(neuron.id) || neuron.id;
    // Issue #2050: Determine uuid - use mother's uuid for remapped neurons
    let uuid: string;
    if (idMapping.has(neuron.id)) {
      uuid = motherIdToUuid.get(newId) ?? neuronUuid(neuron);
    } else if (isOutputNeuronId(newId)) {
      uuid = `output-${outputIndexFromId(newId)}`;
    } else {
      uuid = neuron.uuid ?? neuronUuid(neuron);
    }
    combinedIdToUuid.set(newId, uuid);

    const exportNeuron: NeuronExport = {
      type: neuron.type as "hidden" | "output" | "constant",
      uuid: uuid,
      bias: neuron.bias,
    };
    if (neuron.squash) {
      exportNeuron.squash = neuron.squash;
    }
    // Copy tags if present
    if ((neuron as { tags?: unknown }).tags) {
      (exportNeuron as { tags?: unknown }).tags =
        (neuron as { tags: unknown }).tags;
    }
    newNeurons.push(exportNeuron);
  }

  // Step 3: Build the exported synapses with UUID mappings applied
  const newSynapses: CreatureExport["synapses"] = [];
  for (const synapse of fatherSynapses) {
    const fromId = fatherIndexToId[synapse.from];
    const toId = fatherIndexToId[synapse.to];

    const updatedFromId = idMapping.get(fromId) || fromId;
    const updatedToId = idMapping.get(toId) || toId;

    const exportSynapse: CreatureExport["synapses"][0] = {
      fromUUID: combinedIdToUuid.get(updatedFromId),
      toUUID: combinedIdToUuid.get(updatedToId),
      weight: synapse.weight,
    };
    if (synapse.type) {
      exportSynapse.type = synapse.type;
    }
    // Copy tags if present
    if (synapse.tags) {
      exportSynapse.tags = synapse.tags;
    }
    newSynapses.push(exportSynapse);
  }

  // Step 4: Return the updated father creature export
  const adjustedFather: CreatureExport = {
    input: father.input,
    output: father.output,
    neurons: newNeurons,
    synapses: newSynapses,
  };

  // Copy other properties from father if they exist (matching exportJSON() behaviour)
  if (father.tags && father.tags.length > 0) {
    adjustedFather.tags = father.tags;
  }
  if (father.semanticVersion) {
    adjustedFather.semanticVersion = father.semanticVersion;
  }
  if (father.forwardOnly === true) {
    adjustedFather.forwardOnly = father.forwardOnly;
  }
  // Note: memetic is intentionally not copied, matching original behaviour

  return adjustedFather;
}
