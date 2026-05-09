/**
 * SyntheticLocationUuid.ts — Issue #2613.
 *
 * Pure-function module that computes, for every hidden/constant neuron in a
 * creature, up to two alignment-only synthetic UUIDs. The first is anchored
 * on the nearest input neuron (shortest hop count traced backwards via
 * incoming synapses); the second is anchored on the nearest output neuron
 * (shortest hop count traced forwards via outgoing synapses).
 *
 * Format: `${anchor}-${steps}-${sign}-${rank}`
 *  - `anchor` is the canonical fixed UUID `input-N` or `output-N` of the
 *    nearest I/O neuron (ties broken by lowest index `N`).
 *  - `steps` is the shortest hop count (integer, ≥ 1).
 *  - `sign` is `pos` when the primary incoming synapse weight is `>= 0`,
 *    otherwise `neg` (zero-weight is treated as `pos`).
 *  - `rank` is the neuron's position (0-based) among siblings sharing the
 *    same `(anchor, steps, sign)` tuple, ordered by the primary incoming
 *    synapse `(|weight| desc, fromUUID asc)`.
 *
 * Bias-only hidden neurons (no incoming synapses) are skipped — they receive
 * no synthetic UUIDs and never align across incompatible parents.
 *
 * The function is deterministic across runs given the same creature (no
 * `Math.random`, no `Date.now`) and runs in O(N + E) time where N is the
 * number of neurons and E is the number of synapses.
 *
 * Synthetic UUIDs are never persisted. The function takes a read-only view
 * of the creature and is recomputed on demand by the crossover overlay.
 */

import type { Creature } from "@creature";
import type { Neuron } from "@architecture/Neuron.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { isOutputNeuronId, outputIndexFromId } from "@architecture/NeuronId.ts";
import type { Synapse } from "@architecture/Synapse.ts";

/** Resolves a neuron at array index `idx` to its canonical wire UUID. */
function neuronWireUuid(neuron: Neuron, idx: number): string {
  if (neuron.type === "input") {
    // Input neurons use `input-N` where N matches both the runtime id and
    // the array index (see NeuronId.ts).
    return `input-${idx}`;
  }
  if (neuron.type === "output" && isOutputNeuronId(neuron.id)) {
    return `output-${outputIndexFromId(neuron.id)}`;
  }
  // Hidden / constant: stable rfc 4122 uuid set at creation.
  // The Creature constructor guarantees this is present for hidden/constant.
  return neuron.uuid ?? `neuron-${idx}`;
}

/** Per-hidden-neuron primary-edge metadata used for ranking. */
interface HiddenInfo {
  /** Array index in `creature.neurons`. */
  idx: number;
  /** Runtime integer id (Map key in the public return type). */
  runtimeId: number;
  /** "pos" when the primary incoming weight is `>= 0`, else "neg". */
  sign: "pos" | "neg";
  /** Absolute weight of the primary incoming synapse. */
  primaryAbsWeight: number;
  /** Canonical wire UUID of the primary incoming synapse's source neuron. */
  primaryFromUuid: string;
}

/** Result of a multi-source BFS — distance and anchor UUID per neuron index. */
interface AnchorInfo {
  steps: number;
  anchor: string;
}

/**
 * Multi-source BFS over the creature graph.
 *
 * Starting from every neuron index in `sourceIdxs` (in the order they appear
 * — callers must pass them sorted so ties on hop count resolve to the
 * lowest-indexed source), the BFS walks edges produced by `neighbours` and
 * records for each visited neuron its shortest hop count plus the canonical
 * wire UUID of the source it was reached from.
 *
 * The returned map intentionally includes the source neurons themselves at
 * `steps: 0`; callers filter those out before generating synthetic UUIDs
 * because the spec requires `steps >= 1`.
 */
function multiSourceBfs(
  sourceIdxs: number[],
  wireUuid: string[],
  neighbours: (idx: number) => number[],
): Map<number, AnchorInfo> {
  const info = new Map<number, AnchorInfo>();
  const queue: number[] = [];
  for (const src of sourceIdxs) {
    info.set(src, { steps: 0, anchor: wireUuid[src] });
    queue.push(src);
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const curInfo = info.get(cur)!;
    const nextSteps = curInfo.steps + 1;
    const next = neighbours(cur);
    for (let i = 0; i < next.length; i++) {
      const n = next[i];
      if (!info.has(n)) {
        info.set(n, { steps: nextSteps, anchor: curInfo.anchor });
        queue.push(n);
      }
    }
  }
  return info;
}

/**
 * Computes the alignment-only synthetic UUIDs for every hidden/constant
 * neuron in the creature. See the file-level docstring for the format.
 *
 * The returned map is keyed by `neuron.id` (runtime integer). Bias-only
 * hidden neurons (no incoming synapses) are absent from the map.
 */
export function computeSyntheticLocationUuids(
  creature: Creature,
): Map<number, Set<string>> {
  const neurons = creature.neurons;
  const synapses = creature.synapses;
  const N = neurons.length;

  // 1. Resolve canonical wire UUIDs once per neuron index.
  const wireUuid: string[] = new Array(N);
  for (let i = 0; i < N; i++) {
    wireUuid[i] = neuronWireUuid(neurons[i], i);
  }

  // 2. Build incoming and outgoing adjacency by neuron index. The synapse
  //    objects are stored — the primary-edge selection below needs both
  //    weight and source uuid.
  const incoming: Synapse[][] = new Array(N);
  const outgoing: Synapse[][] = new Array(N);
  for (let i = 0; i < N; i++) {
    incoming[i] = [];
    outgoing[i] = [];
  }
  for (let i = 0; i < synapses.length; i++) {
    const s = synapses[i];
    incoming[s.to].push(s);
    outgoing[s.from].push(s);
  }

  // 3. Collect input and output neuron indices, sorted so that lowest
  //    "external" index (input index for inputs, output index for outputs)
  //    is processed first by the BFS — that gives the lowest-index
  //    tie-break on equal hop counts for free.
  const inputIdxs: number[] = [];
  const outputIdxs: number[] = [];
  for (let idx = 0; idx < N; idx++) {
    const t = neurons[idx].type;
    if (t === "input") inputIdxs.push(idx);
    else if (t === "output") outputIdxs.push(idx);
  }
  // For inputs, the input index equals the neuron's array index (and id).
  inputIdxs.sort((a, b) => a - b);
  // For outputs, sort by output index ascending — output-0 first, etc.
  outputIdxs.sort((a, b) => {
    const ai = outputIndexFromId(neurons[a].id);
    const bi = outputIndexFromId(neurons[b].id);
    return ai - bi;
  });

  // 4. Multi-source BFS for nearest-input anchors (forward via outgoing).
  const inputAnchorByIdx = multiSourceBfs(
    inputIdxs,
    wireUuid,
    (idx) => outgoing[idx].map((s) => s.to),
  );

  // 5. Multi-source BFS for nearest-output anchors (backward via incoming).
  const outputAnchorByIdx = multiSourceBfs(
    outputIdxs,
    wireUuid,
    (idx) => incoming[idx].map((s) => s.from),
  );

  // 6. Compute primary-incoming-edge metadata for every hidden/constant
  //    neuron with at least one incoming synapse. Bias-only neurons are
  //    skipped — no entry is produced for them.
  const hiddenInfos: HiddenInfo[] = [];
  for (let idx = 0; idx < N; idx++) {
    const n = neurons[idx];
    if (n.type !== "hidden" && n.type !== "constant") continue;
    const inc = incoming[idx];
    if (inc.length === 0) continue;
    let primary = inc[0];
    let primaryAbs = Math.abs(primary.weight);
    let primaryFrom = wireUuid[primary.from];
    for (let k = 1; k < inc.length; k++) {
      const s = inc[k];
      const aw = Math.abs(s.weight);
      const fu = wireUuid[s.from];
      if (aw > primaryAbs || (aw === primaryAbs && fu < primaryFrom)) {
        primary = s;
        primaryAbs = aw;
        primaryFrom = fu;
      }
    }
    hiddenInfos.push({
      idx,
      runtimeId: n.id,
      sign: primary.weight >= 0 ? "pos" : "neg",
      primaryAbsWeight: primaryAbs,
      primaryFromUuid: primaryFrom,
    });
  }

  // 7. Group hidden neurons by `(anchor, steps, sign)` for each anchor
  //    direction, then sort each group by `(|weight| desc, fromUUID asc)`
  //    of the primary incoming synapse. The position in that sorted list
  //    is the rank component of the synthetic UUID.
  type Bucket = HiddenInfo[];
  const inputBuckets = new Map<string, Bucket>();
  const outputBuckets = new Map<string, Bucket>();

  for (const info of hiddenInfos) {
    const ia = inputAnchorByIdx.get(info.idx);
    if (ia && ia.steps >= 1) {
      const key = `${ia.anchor}|${ia.steps}|${info.sign}`;
      let arr = inputBuckets.get(key);
      if (!arr) {
        arr = [];
        inputBuckets.set(key, arr);
      }
      arr.push(info);
    }
    const oa = outputAnchorByIdx.get(info.idx);
    if (oa && oa.steps >= 1) {
      const key = `${oa.anchor}|${oa.steps}|${info.sign}`;
      let arr = outputBuckets.get(key);
      if (!arr) {
        arr = [];
        outputBuckets.set(key, arr);
      }
      arr.push(info);
    }
  }

  const sortBucket = (arr: Bucket): void => {
    arr.sort((a, b) => {
      if (b.primaryAbsWeight !== a.primaryAbsWeight) {
        return b.primaryAbsWeight - a.primaryAbsWeight;
      }
      if (a.primaryFromUuid < b.primaryFromUuid) return -1;
      if (a.primaryFromUuid > b.primaryFromUuid) return 1;
      // Final tie-break: stable on the runtime id so re-ordering of the
      // synapse list cannot change the result.
      return a.runtimeId - b.runtimeId;
    });
  };

  const result = new Map<number, Set<string>>();
  const addToResult = (runtimeId: number, uuid: string): void => {
    let set = result.get(runtimeId);
    if (!set) {
      set = new Set<string>();
      result.set(runtimeId, set);
    }
    set.add(uuid);
  };

  for (const [key, arr] of inputBuckets) {
    sortBucket(arr);
    const sep1 = key.indexOf("|");
    const sep2 = key.indexOf("|", sep1 + 1);
    const anchor = key.slice(0, sep1);
    const stepsStr = key.slice(sep1 + 1, sep2);
    const sign = key.slice(sep2 + 1);
    for (let rank = 0; rank < arr.length; rank++) {
      addToResult(
        arr[rank].runtimeId,
        `${anchor}-${stepsStr}-${sign}-${rank}`,
      );
    }
  }
  for (const [key, arr] of outputBuckets) {
    sortBucket(arr);
    const sep1 = key.indexOf("|");
    const sep2 = key.indexOf("|", sep1 + 1);
    const anchor = key.slice(0, sep1);
    const stepsStr = key.slice(sep1 + 1, sep2);
    const sign = key.slice(sep2 + 1);
    for (let rank = 0; rank < arr.length; rank++) {
      addToResult(
        arr[rank].runtimeId,
        `${anchor}-${stepsStr}-${sign}-${rank}`,
      );
    }
  }

  return result;
}

/**
 * Export-shape variant of {@link computeSyntheticLocationUuids} used by
 * the export-only `createCompatibleFather` path (Issue #2614).
 *
 * Operates on a `CreatureExport` whose neurons carry numeric `id` fields
 * and whose synapses carry `fromId` / `toId` fields. Callers must invoke
 * `normaliseCreatureExport` first so those fields are populated.
 *
 * The output is keyed by `neuron.id` (the export-side integer id) so it
 * lines up with the rest of the alignment passes in `Father.ts`.
 *
 * Bias-only hidden neurons are skipped exactly as in the runtime variant.
 */
export function computeSyntheticLocationUuidsExport(
  creature: CreatureExport,
): Map<number, Set<string>> {
  const neurons = creature.neurons;
  const synapses = creature.synapses;
  const N = neurons.length;
  const inputCount = creature.input;

  // Build id → array index map. Inputs occupy the first `input` indices and
  // are not present in the export's `neurons` array — they are addressed by
  // their canonical id `0..input-1`. We extend the index space by mapping
  // each input id back to itself (so BFS source iteration stays simple) and
  // map every non-input neuron's id to its position in the neurons array
  // (offset by `input`).
  const idToIndex = new Map<number, number>();
  for (let i = 0; i < inputCount; i++) idToIndex.set(i, i);
  for (let i = 0; i < N; i++) {
    const id = (neurons[i] as { id?: number }).id;
    if (id !== undefined) idToIndex.set(id, inputCount + i);
  }

  const totalNodes = inputCount + N;

  // 1. Resolve canonical wire UUID per index. Inputs use `input-N`, outputs
  // use `output-N` (derived from id), hidden/constant use the export uuid.
  const wireUuid: string[] = new Array(totalNodes);
  for (let i = 0; i < inputCount; i++) wireUuid[i] = `input-${i}`;
  for (let i = 0; i < N; i++) {
    const n = neurons[i];
    const id = (n as { id?: number }).id;
    if (n.type === "output" && id !== undefined && isOutputNeuronId(id)) {
      wireUuid[inputCount + i] = `output-${outputIndexFromId(id)}`;
    } else if (typeof n.uuid === "string" && n.uuid.length > 0) {
      wireUuid[inputCount + i] = n.uuid;
    } else {
      wireUuid[inputCount + i] = `neuron-${inputCount + i}`;
    }
  }

  // 2. Build incoming/outgoing adjacency by index. Synapses unresolved
  // against the index map (e.g. dangling fromId) are silently skipped.
  interface SyntheticEdge {
    from: number;
    to: number;
    weight: number;
  }
  const incoming: SyntheticEdge[][] = new Array(totalNodes);
  const outgoing: SyntheticEdge[][] = new Array(totalNodes);
  for (let i = 0; i < totalNodes; i++) {
    incoming[i] = [];
    outgoing[i] = [];
  }
  for (let i = 0; i < synapses.length; i++) {
    const s = synapses[i];
    if (s.fromId === undefined || s.toId === undefined) continue;
    const fromIdx = idToIndex.get(s.fromId);
    const toIdx = idToIndex.get(s.toId);
    if (fromIdx === undefined || toIdx === undefined) continue;
    const edge: SyntheticEdge = {
      from: fromIdx,
      to: toIdx,
      weight: s.weight,
    };
    incoming[toIdx].push(edge);
    outgoing[fromIdx].push(edge);
  }

  // 3. Source index lists for the two BFS sweeps.
  const inputIdxs: number[] = [];
  for (let i = 0; i < inputCount; i++) inputIdxs.push(i);
  const outputIdxs: number[] = [];
  for (let i = 0; i < N; i++) {
    if (neurons[i].type === "output") outputIdxs.push(inputCount + i);
  }
  outputIdxs.sort((a, b) => {
    const ai = (neurons[a - inputCount] as { id?: number }).id ?? 0;
    const bi = (neurons[b - inputCount] as { id?: number }).id ?? 0;
    if (!isOutputNeuronId(ai) || !isOutputNeuronId(bi)) return ai - bi;
    return outputIndexFromId(ai) - outputIndexFromId(bi);
  });

  const inputAnchorByIdx = multiSourceBfs(
    inputIdxs,
    wireUuid,
    (idx) => outgoing[idx].map((e) => e.to),
  );
  const outputAnchorByIdx = multiSourceBfs(
    outputIdxs,
    wireUuid,
    (idx) => incoming[idx].map((e) => e.from),
  );

  // 4. Per-hidden-neuron primary edge metadata.
  interface ExportInfo {
    idx: number;
    exportId: number;
    sign: "pos" | "neg";
    primaryAbsWeight: number;
    primaryFromUuid: string;
  }
  const hiddenInfos: ExportInfo[] = [];
  for (let i = 0; i < N; i++) {
    const n = neurons[i];
    if (n.type !== "hidden" && n.type !== "constant") continue;
    const idx = inputCount + i;
    const inc = incoming[idx];
    if (inc.length === 0) continue;
    const exportId = (n as { id?: number }).id;
    if (exportId === undefined) continue;
    let primary = inc[0];
    let primaryAbs = Math.abs(primary.weight);
    let primaryFrom = wireUuid[primary.from];
    for (let k = 1; k < inc.length; k++) {
      const e = inc[k];
      const aw = Math.abs(e.weight);
      const fu = wireUuid[e.from];
      if (aw > primaryAbs || (aw === primaryAbs && fu < primaryFrom)) {
        primary = e;
        primaryAbs = aw;
        primaryFrom = fu;
      }
    }
    hiddenInfos.push({
      idx,
      exportId,
      sign: primary.weight >= 0 ? "pos" : "neg",
      primaryAbsWeight: primaryAbs,
      primaryFromUuid: primaryFrom,
    });
  }

  // 5. Bucket and rank — same shape as the runtime variant.
  type Bucket = ExportInfo[];
  const inputBuckets = new Map<string, Bucket>();
  const outputBuckets = new Map<string, Bucket>();
  for (const info of hiddenInfos) {
    const ia = inputAnchorByIdx.get(info.idx);
    if (ia && ia.steps >= 1) {
      const key = `${ia.anchor}|${ia.steps}|${info.sign}`;
      let arr = inputBuckets.get(key);
      if (!arr) {
        arr = [];
        inputBuckets.set(key, arr);
      }
      arr.push(info);
    }
    const oa = outputAnchorByIdx.get(info.idx);
    if (oa && oa.steps >= 1) {
      const key = `${oa.anchor}|${oa.steps}|${info.sign}`;
      let arr = outputBuckets.get(key);
      if (!arr) {
        arr = [];
        outputBuckets.set(key, arr);
      }
      arr.push(info);
    }
  }
  const sortBucket = (arr: Bucket): void => {
    arr.sort((a, b) => {
      if (b.primaryAbsWeight !== a.primaryAbsWeight) {
        return b.primaryAbsWeight - a.primaryAbsWeight;
      }
      if (a.primaryFromUuid < b.primaryFromUuid) return -1;
      if (a.primaryFromUuid > b.primaryFromUuid) return 1;
      return a.exportId - b.exportId;
    });
  };

  const result = new Map<number, Set<string>>();
  const addToResult = (exportId: number, uuid: string): void => {
    let set = result.get(exportId);
    if (!set) {
      set = new Set<string>();
      result.set(exportId, set);
    }
    set.add(uuid);
  };

  for (const [key, arr] of inputBuckets) {
    sortBucket(arr);
    const sep1 = key.indexOf("|");
    const sep2 = key.indexOf("|", sep1 + 1);
    const anchor = key.slice(0, sep1);
    const stepsStr = key.slice(sep1 + 1, sep2);
    const sign = key.slice(sep2 + 1);
    for (let rank = 0; rank < arr.length; rank++) {
      addToResult(
        arr[rank].exportId,
        `${anchor}-${stepsStr}-${sign}-${rank}`,
      );
    }
  }
  for (const [key, arr] of outputBuckets) {
    sortBucket(arr);
    const sep1 = key.indexOf("|");
    const sep2 = key.indexOf("|", sep1 + 1);
    const anchor = key.slice(0, sep1);
    const stepsStr = key.slice(sep1 + 1, sep2);
    const sign = key.slice(sep2 + 1);
    for (let rank = 0; rank < arr.length; rank++) {
      addToResult(
        arr[rank].exportId,
        `${anchor}-${stepsStr}-${sign}-${rank}`,
      );
    }
  }

  return result;
}
