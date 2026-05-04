/**
 * CreatureSerialization.ts - JSON import/export and cloning.
 *
 * Extracted from Creature.ts (Issue #1409) to keep the Creature class
 * under 500 lines and each module focused on a single responsibility.
 */

import { fail } from "@std/assert";
import type { TagInterface } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import type {
  CreatureExport,
  CreatureInternal,
  CreatureTrace,
} from "@architecture/CreatureInterfaces.ts";
import { normaliseComputationalNeuronOrder } from "@architecture/NormaliseComputationalNeuronOrder.ts";
import { repairInvalidIfNeuronsInCreature } from "@architecture/RepairInvalidIfNeurons.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { Neuron } from "@architecture/Neuron.ts";
import {
  ensureIdAbove,
  inputNeuronId,
  outputNeuronId,
} from "@architecture/NeuronId.ts";
import type { NeuronTrace } from "@architecture/NeuronInterfaces.ts";
import { Synapse } from "@architecture/Synapse.ts";
import type {
  SynapseExport,
  SynapseInternal,
  SynapseTrace,
} from "@architecture/SynapseInterfaces.ts";
import type { MemeticInterface } from "@blackbox/MemeticInterface.ts";
import {
  isMemeticWireData,
  type MemeticWeightEntryWire,
  type MemeticWireData,
} from "@blackbox/MemeticWireData.ts";
import { convertMemeticExportToWireJson } from "@creature/MemeticWireExport.ts";
import { getLogger } from "@utils/Logger.ts";
import { isRecord } from "@utils/TypeGuards.ts";
import {
  clampWeightBiasDetail,
  MAX_SAFE_WEIGHT_BIAS,
} from "@utils/WeightBiasClamp.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { assertNoRecurrentSynapseOnForwardOnly } from "@architecture/ForwardOnlyAssertion.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { computeCreatureStructuralHash } from "@utils/CreatureStructuralHash.ts";
import { cleanupOrphanedNeuronsInCreature } from "@compact/OrphanedNeuronCleanup.ts";
import { pruneOrphanMemeticReferences } from "@compact/MemeticCleanup.ts";
import { mergeDuplicateSynapsesInCreature } from "@compact/SynapsePruning.ts";
import { upgradeOne } from "@upgrade/UpgradeOne.ts";
import { CreatureExportBuilder } from "@utils/CreatureExportBuilder.ts";

/** Keys that must never be copied from untrusted data to prevent prototype pollution. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Safely copies own properties from source to target, skipping prototype-polluting keys.
 *
 * Uses Object.defineProperty instead of bracket assignment so that static analysis
 * tools (CodeQL) can verify that Object.prototype is never modified.
 */
function safeAssignProperties(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key of Object.keys(source)) {
    if (!UNSAFE_KEYS.has(key)) {
      Object.defineProperty(target, key, {
        value: source[key],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
}

/**
 * Removes internal integer neuron/synapse ids from a plain export object.
 * Prefer {@link exportSnapshotJSON} when starting from a {@link Creature}.
 */
export function stripNumericIdsFromCreatureExport(
  json: CreatureExport,
): CreatureExport {
  const clone = structuredClone(json) as CreatureExport;
  for (const n of clone.neurons) {
    delete (n as { id?: number }).id;
  }
  for (const s of clone.synapses) {
    delete (s as { fromId?: number }).fromId;
    delete (s as { toId?: number }).toId;
  }
  return clone;
}

/**
 * Builds creature export JSON from the live creature graph (no validation).
 *
 * @param includeIds When true, includes runtime integer IDs for internal use.
 */
function buildCreatureExportJSON(
  creature: Creature,
  includeIds: boolean,
): CreatureExport {
  const builder = new CreatureExportBuilder(creature);
  const json = builder.build(includeIds) as CreatureExport;
  if (includeIds && json.memetic) {
    normaliseCreatureExport(json);
  } else if (json.memetic) {
    json.memetic = convertMemeticExportToWireJson(creature, json.memetic);
  }
  return json;
}

/**
 * External creature JSON: wire UUIDs only, no runtime integer IDs.
 *
 * Issue #2054: The external export format omits `id` on neurons and
 * `fromId`/`toId` on synapses. External consumers should use UUID fields
 * (`uuid`, `fromUUID`, `toUUID`) which are stable across generations and
 * machines. When `memetic` is present, `biases` keys use wire identities;
 * `weights` is an array of `{ fromUUID, toUUID, weight }` (no numeric neuron
 * keys).
 *
 * **Hot-path policy (do not regress):** do **not** add unconditional
 * `creatureValidate` here. Full validation on every export destroys throughput
 * in evolution/training. Invariants should be enforced where structures are
 * produced (mutation, breed, discovery) and in tests; use `creature.DEBUG`
 * to opt into validation on export during development.
 *
 * **Issue #2511 — save-side forward-only assertion:** when
 * `creature.forwardOnly === true`, run a narrow O(N) sweep that throws
 * {@link TopologyError} on any `from >= to` synapse before serialisation.
 * This is the only check that fires unconditionally in this hot path —
 * the rest of `creatureValidate` stays gated by `creature.DEBUG`. The
 * goal is to capture the producing pipeline's stack frame so the
 * upstream corruption that previously surfaced only as `loadFrom`
 * `Stripping recurrent synapse` warnings can be traced to its source.
 */
export function exportJSON(creature: Creature): CreatureExport {
  if (creature.DEBUG) {
    creatureValidate(creature);
  }
  assertNoRecurrentSynapseOnForwardOnly(creature, "exportJSON");
  return buildCreatureExportJSON(creature, false);
}

/**
 * Wire-only snapshot JSON: same as {@link exportJSON} — omits runtime
 * integer neuron and synapse IDs (stable UUID endpoints only).
 *
 * Since Issue #2054, {@link exportJSON} already omits integer IDs, so this
 * method is equivalent. Retained for backward compatibility.
 */
export function exportSnapshotJSON(creature: Creature): CreatureExport {
  return exportJSON(creature);
}

/**
 * Internal-only export that **bypasses** the Issue #2511 save-side
 * forward-only assertion.
 *
 * Use this only in code paths that legitimately need to serialise a
 * potentially-corrupt creature for further processing — never as a
 * substitute for {@link exportJSON} on the user-facing save path.
 * Examples that legitimately need this bypass:
 *
 *  - `compactCreature(...)`: the input may carry backward synapses on
 *    purpose so compaction can strip them (Issue #956).
 *  - `applyChangeToCreature(...)` (discovery): candidate creatures may
 *    intentionally carry illegal hints that the combiner is meant to
 *    filter; serialising the candidate is part of the filtering work,
 *    not a save.
 *  - Diagnostic write paths after a validation failure: we are already
 *    on an error path and want to capture the offending creature for
 *    triage; throwing again here would replace the upstream error.
 *
 * When in doubt, prefer {@link exportJSON} — the assertion is the only
 * thing that names the producing pipeline when corruption escapes.
 */
export function exportJSONUnchecked(creature: Creature): CreatureExport {
  return buildCreatureExportJSON(creature, false);
}

/**
 * Convert the creature to a trace JSON object.
 */
export function traceJSON(creature: Creature): CreatureTrace {
  const exportCreature = exportJSON(creature);

  const state = creature.state;
  let exportIndex = 0;
  creature.neurons.forEach((n) => {
    if (n.type !== "input") {
      if (n.type !== "constant") {
        const indx = n.index;

        const traceNeuron: NeuronTrace = exportCreature
          .neurons[exportIndex] as NeuronTrace;

        const ns = state.node(indx);
        if (ns.count) {
          (traceNeuron as NeuronTrace).trace = ns;
        }
      }
      exportIndex++;
    }
  });

  creature.synapses.forEach((c, indx) => {
    const exportConnection = exportCreature.synapses[indx] as SynapseTrace;
    const cs = state.connection(c.from, c.to);
    if (cs.count) {
      exportConnection.trace = cs;
    }
  });

  return exportCreature as CreatureTrace;
}

/**
 * Converts wire memetic JSON to runtime integer neuron IDs.
 * Wire exports use string bias keys and a `weights` array of
 * `{ fromUUID, toUUID, weight }`; legacy object maps are still accepted.
 */
function convertMemeticToIntIds(
  memetic: MemeticWireData,
  creature: Creature,
  uuidToIndex: Map<string, number>,
): MemeticInterface | MemeticWireData {
  if (!memetic) return memetic;

  const uuidToIntId = new Map<string, number>();
  for (const [uuid, index] of uuidToIndex) {
    if (index < creature.neurons.length) {
      uuidToIntId.set(uuid, creature.neurons[index].id);
    }
  }

  const needsConversion = (key: string): boolean => {
    return isNaN(Number(key)) && uuidToIntId.has(key);
  };

  // Check if any keys need conversion
  let hasUuidKeys = false;
  if (memetic.biases) {
    for (const key of Object.keys(memetic.biases)) {
      if (needsConversion(key)) {
        hasUuidKeys = true;
        break;
      }
    }
  }
  const weightsAreWireArray = Array.isArray(memetic.weights);

  if (
    !hasUuidKeys && memetic.weights && !weightsAreWireArray
  ) {
    for (
      const key of Object.keys(
        memetic.weights as Record<string, MemeticWeightEntryWire[]>,
      )
    ) {
      if (needsConversion(key)) {
        hasUuidKeys = true;
        break;
      }
    }
  }

  if (!hasUuidKeys && !weightsAreWireArray) return memetic;

  // Deep clone to avoid mutating the original JSON, then validate
  const parsed: unknown = JSON.parse(JSON.stringify(memetic));
  if (!isMemeticWireData(parsed)) return memetic;
  const result: MemeticWireData = parsed;

  // Convert biases keys
  if (result.biases) {
    const newBiases: Record<number, number> = {};
    for (const key of Object.keys(result.biases)) {
      const intId = uuidToIntId.get(key);
      if (intId !== undefined) {
        newBiases[intId] = result.biases[key];
      } else {
        const numKey = Number(key);
        if (!isNaN(numKey)) {
          newBiases[numKey] = result.biases[key];
        }
      }
    }
    (result as unknown as Record<string, unknown>).biases = newBiases;
  }

  // Convert weights: wire array { fromUUID, toUUID, weight } or UUID-keyed map
  if (result.weights) {
    const newWeights: Record<number, MemeticWeightEntryWire[]> = {};
    if (Array.isArray(result.weights)) {
      for (const row of result.weights) {
        if (
          row === null || row === undefined || typeof row.weight !== "number"
        ) {
          continue;
        }
        const fu = row.fromUUID;
        const tu = row.toUUID;
        if (typeof fu !== "string" || typeof tu !== "string") continue;
        const fromInt = uuidToIntId.get(fu);
        const toInt = uuidToIntId.get(tu);
        if (fromInt === undefined || toInt === undefined) continue;
        if (!newWeights[fromInt]) newWeights[fromInt] = [];
        newWeights[fromInt].push({ toId: toInt, weight: row.weight });
      }
      (result as unknown as Record<string, unknown>).weights = newWeights;
    } else {
      const weightMap = result.weights as Record<
        string,
        MemeticWeightEntryWire[]
      >;
      for (const key of Object.keys(weightMap)) {
        const intId = uuidToIntId.get(key);
        const numericKey = intId !== undefined ? intId : Number(key);
        if (isNaN(numericKey)) continue;

        const entries = weightMap[key].map(
          (entry: MemeticWeightEntryWire) => {
            const newEntry: MemeticWeightEntryWire = { ...entry };
            if (typeof newEntry.toUUID === "string") {
              const toIntId = uuidToIntId.get(newEntry.toUUID);
              if (toIntId !== undefined) {
                newEntry.toId = toIntId;
                delete newEntry.toUUID;
              }
            }
            return newEntry;
          },
        );
        newWeights[numericKey] = entries;
      }
      (result as unknown as Record<string, unknown>).weights = newWeights;
    }
  }

  // Convert ancestry if present
  if (result.ancestry && Array.isArray(result.ancestry)) {
    result.ancestry = result.ancestry.map((ancestor: MemeticWireData) => {
      return convertMemeticToIntIds(
        ancestor,
        creature,
        uuidToIndex,
      ) as MemeticWireData;
    });
  }

  return result;
}

function forwardOnlyHiddenLacksInbound(creature: Creature): boolean {
  const inboundTo = new Set<number>();
  for (const s of creature.synapses) {
    inboundTo.add(s.to);
  }
  for (
    let i = creature.input;
    i < creature.neurons.length - creature.output;
    i++
  ) {
    if (creature.neurons[i].type === "hidden" && !inboundTo.has(i)) {
      return true;
    }
  }
  return false;
}

/**
 * Strictness gate for the load-side recurrent-synapse check.
 *
 * Issue #2514: promoted from a silent strip+warn to a `TopologyError`
 * throw by default for `forwardOnly` creatures so the producer's stack
 * frame surfaces the corruption source instead of self-healing on every
 * load.
 *
 *  - `"forwardOnly"` (default): throw `TopologyError` when the loaded
 *    creature is `forwardOnly === true` and any synapse has
 *    `from >= to`. Recurrent creatures are unaffected.
 *  - `"always"`: throw `TopologyError` on any `from >= to` regardless
 *    of `forwardOnly`. Use sparingly — most legitimate recurrent
 *    creatures legitimately carry such edges.
 *  - `"never"`: legacy strip-and-warn. Reserved for repair tools and
 *    diagnostic paths that intentionally process corrupt input
 *    (`compactCreature`, `applyChangeToCreature`, `Upgrade`,
 *    Diagnostics).
 */
export type ThrowOnRecurrent = "always" | "forwardOnly" | "never";

/** Optional second-tier configuration for {@link loadFrom}. */
export interface LoadFromOptions {
  /**
   * Controls how the load-side recurrent-synapse gate behaves.
   * Defaults to `"forwardOnly"` (Issue #2514).
   */
  throwOnRecurrent?: ThrowOnRecurrent;
}

/**
 * Load the creature from a JSON object.
 *
 * @param source Optional tag describing the calling site (e.g.
 *   `"breed"`, `"discovery"`, `"fromJSON"`). Included in any
 *   `[loadFrom] Stripping recurrent synapse` warning or
 *   `TopologyError` so production logs and stack traces can identify
 *   the upstream pipeline that produced corrupt JSON. See Issue #2500
 *   and #2514.
 * @param options.throwOnRecurrent Strictness for the recurrent-synapse
 *   gate. Defaults to `"forwardOnly"` — a forward-only creature with
 *   any `from >= to` synapse throws {@link TopologyError} so the
 *   producing pipeline's stack frame is preserved rather than silently
 *   stripped (Issue #2514).
 */
export function loadFrom(
  creature: Creature,
  json: CreatureInternal | CreatureExport,
  validate: boolean,
  source?: string,
  options?: LoadFromOptions,
): void {
  const sourceTag = source ?? "loadFrom";
  const throwOnRecurrent: ThrowOnRecurrent = options?.throwOnRecurrent ??
    "forwardOnly";
  creature.uuid = (json as CreatureInternal).uuid;
  if (json.semanticVersion) {
    creature.semanticVersion = json.semanticVersion;
    const major = Number.parseInt(
      json.semanticVersion.split(".")[0] ?? "0",
      10,
    );
    creature.cachedMajorVersion = Number.isFinite(major) ? major : 0;
  }
  creature.forwardOnly = (json as CreatureExport).forwardOnly;

  const neuronCount = json.neurons.length;
  const synapseCount = json.synapses.length;
  creature.neurons = new Array(neuronCount);
  creature.synapses = new Array(synapseCount);

  if (json.tags) {
    creature.tags = [...json.tags];
  }

  creature.clearState();
  const state = creature.state;
  // UUIDs are the canonical wire identity for neurons and synapses.
  // uuidToIndex resolves UUID strings (e.g. "input-0", neuron.uuid) to
  // runtime array indices. numericIdToIndex is a fallback for internal
  // round-trips that may still carry runtime integer IDs.
  const uuidToIndex = new Map<string, number>();
  const numericIdToIndex = new Map<number, number>();

  let i = json.input;
  while (i--) {
    const neuronId = inputNeuronId(i);
    numericIdToIndex.set(neuronId, i);
    uuidToIndex.set(`input-${i}`, i);
    const n = new Neuron(neuronId, "input", 0, creature);
    n.index = i;
    creature.neurons[i] = n;
  }

  let pos = json.input;
  let outputIndex = 0;
  const neurons = json.neurons;
  // Issue #2378: track clamped magnitudes so we emit a single aggregated
  // warn line per load, rather than one info line per overflow value.
  let clampedBiasCount = 0;
  let clampedWeightCount = 0;
  let maxObservedBias = 0;
  let maxObservedWeight = 0;

  for (let i = 0; i < neurons.length; i++) {
    const jn = neurons[i];
    if (jn.type === "input") continue;

    if (jn.type === "output") {
      const outId = outputNeuronId(outputIndex++);
      (jn as { id: number }).id = outId;
      if (typeof jn.uuid === "string") {
        uuidToIndex.set(jn.uuid, pos);
      }
    } else if (typeof jn.uuid === "string") {
      uuidToIndex.set(jn.uuid, pos);
    }

    // Issue #2378: defence-in-depth — clamp bias magnitude at load time
    // so runaway values (up to ~1e+195 seen in production) cannot be
    // carried across generations via persisted JSON. Clone before mutating
    // so we never modify the caller's JSON object.
    let jnForLoad = jn;
    if (typeof jn.bias === "number") {
      const biasDetail = clampWeightBiasDetail(jn.bias);
      if (biasDetail.clamped) {
        clampedBiasCount++;
        if (Math.abs(jn.bias) > maxObservedBias) {
          maxObservedBias = Math.abs(jn.bias);
        }
        jnForLoad = { ...jn, bias: biasDetail.value };
      }
    }

    const n = Neuron.fromJSON(jnForLoad, creature);
    n.index = pos;
    ensureIdAbove(n.id);

    if ((jn as NeuronTrace).trace) {
      const target = state.node(n.index);
      const source = (jn as NeuronTrace).trace;
      if (isRecord(target) && isRecord(source)) {
        safeAssignProperties(target, source);
      }
    }

    numericIdToIndex.set(n.id, pos);
    creature.neurons[pos++] = n;
  }

  const synapses = json.synapses;
  let isSorted = true;
  let lastFrom = -1;
  let lastTo = -1;
  const isForwardOnly = creature.forwardOnly === true;
  let validSynapseCount = 0;
  // Issue #2500: lazily compute a structural hash on first strip so we
  // always emit a usable identifier even when the creature has no UUID
  // (CreatureExport JSON omits creature uuid).
  let cachedStructuralHash: string | undefined;
  const getStructuralHash = (): string => {
    if (cachedStructuralHash === undefined) {
      cachedStructuralHash = computeCreatureStructuralHash(json);
    }
    return cachedStructuralHash;
  };
  for (let i = 0; i < synapseCount; i++) {
    const synapse = synapses[i];
    const se = synapse as SynapseExport;

    let from: number | undefined;
    if (typeof se.fromUUID === "string") {
      from = uuidToIndex.get(se.fromUUID);
    }
    if (from === undefined && se.fromId !== undefined) {
      from = numericIdToIndex.get(se.fromId);
    }
    if (from === undefined) {
      from = (synapse as SynapseInternal).from;
    }

    if (from === undefined) {
      fail(
        `FROM is undefined: fromId ${se.fromId}, fromUUID ${se.fromUUID}, index ${
          (synapse as SynapseInternal).from
        }, synapse[${i}/${synapseCount}], uuidToIndex size ${uuidToIndex.size}`,
      );
    }

    let to: number | undefined;
    if (typeof se.toUUID === "string") {
      to = uuidToIndex.get(se.toUUID);
    }
    if (to === undefined && se.toId !== undefined) {
      to = numericIdToIndex.get(se.toId);
    }
    if (to === undefined) {
      to = (synapse as SynapseInternal).to;
    }

    if (to === undefined) {
      fail(
        `TO is undefined: id ${se.toId}, index ${
          (synapse as SynapseInternal).to
        }`,
      );
    }

    const recurrentGateFires = throwOnRecurrent === "always"
      ? from! >= to!
      : (throwOnRecurrent === "forwardOnly" && isForwardOnly && from! >= to!);
    const stripGateFires = throwOnRecurrent === "never" && isForwardOnly &&
      from! >= to!;
    if (recurrentGateFires || stripGateFires) {
      // Issue #2500: include a usable identifier (uuid OR structural
      // hash) and a `source=...` tag so corrupt-creature events from a
      // single offending pipeline can be correlated across log lines.
      // Issue #2511: include `depth=<to-from>` so self-loops (depth=0)
      // and cross-loops (depth<0, e.g. output-0 -> hidden-3) are
      // distinguishable at a glance in production logs.
      const uuidLabel = creature.uuid ?? `hash:${getStructuralHash()}`;
      const depth = to - from;
      const fromIdLabel = se.fromUUID ?? se.fromId;
      const toIdLabel = se.toUUID ?? se.toId;
      if (recurrentGateFires) {
        // Issue #2514: promote the silent strip to a TopologyError so
        // the caller's stack frame surfaces the corruption source.
        // `new Error().stack` is captured on the thrown error so logs
        // can attribute the offending pipeline.
        const message = `🚨 [loadFrom] Recurrent synapse ${from}->${to} ` +
          `(fromUUID=${fromIdLabel}, toUUID=${toIdLabel}, depth=${depth}) ` +
          `on forward-only creature (UUID: ${uuidLabel}, source=${sourceTag}). ` +
          `This indicates upstream corruption (Issue #2514).`;
        throw new TopologyError(message, "INVALID_CONNECTION");
      }
      // throwOnRecurrent === "never": legacy strip + warn path,
      // reserved for repair tools that intentionally ingest corrupt
      // input (compactCreature, applyChangeToCreature, Upgrade,
      // Diagnostics).
      getLogger().error(
        `🚨 [loadFrom] Stripping recurrent synapse ${from}->${to} ` +
          `(fromUUID=${fromIdLabel}, toUUID=${toIdLabel}, depth=${depth}) ` +
          `from forward-only creature (UUID: ${uuidLabel}, source=${sourceTag}). ` +
          `This indicates upstream corruption.`,
      );
      continue;
    }

    if (isSorted) {
      if (from > lastFrom) {
        lastFrom = from;
        lastTo = -1;
      } else if (from < lastFrom || to <= lastTo) {
        isSorted = false;
      }
      lastTo = to;
    }

    // Issue #2378: defence-in-depth — clamp weight magnitude at load time.
    let effectiveWeight = synapse.weight;
    if (typeof effectiveWeight === "number") {
      const weightDetail = clampWeightBiasDetail(effectiveWeight);
      if (weightDetail.clamped) {
        clampedWeightCount++;
        if (Math.abs(effectiveWeight) > maxObservedWeight) {
          maxObservedWeight = Math.abs(effectiveWeight);
        }
        effectiveWeight = weightDetail.value;
      }
    }

    const tmpSynapse = new Synapse(from!, to!, effectiveWeight, synapse.type);
    creature.synapses[validSynapseCount++] = tmpSynapse;

    if (synapse.frozen) {
      tmpSynapse.frozen = true;
    }

    if (synapse.tags) {
      tmpSynapse.tags = synapse.tags.slice();
    }

    if ((synapse as SynapseTrace).trace) {
      const target = state.connection(tmpSynapse.from, tmpSynapse.to);
      const source = (synapse as SynapseTrace).trace;
      if (isRecord(target) && isRecord(source)) {
        safeAssignProperties(target, source);
      }
    }
  }
  if (validSynapseCount < synapseCount) {
    creature.synapses.length = validSynapseCount;
  }

  const mergedDuplicateSynapses = mergeDuplicateSynapsesInCreature(creature);

  if (mergedDuplicateSynapses > 0) {
    creature.memetic = undefined;
  } else if (json.memetic && uuidToIndex.size > 0) {
    creature.memetic = convertMemeticToIntIds(
      json.memetic as unknown as MemeticWireData,
      creature,
      uuidToIndex,
    ) as MemeticInterface;
  } else {
    creature.memetic = json.memetic;
  }
  // Issue #1863: Load per-creature evolvable hyperparameters
  creature.hyperparameters = json.hyperparameters
    ? { ...json.hyperparameters }
    : undefined;
  creature.clearCache();

  if (!isSorted) {
    creature.synapses.sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      return a.to - b.to;
    });
  }

  creature.prebuildInwardIndexIfLarge();

  // Forward-only ingest: merge duplicate (from,to) rows (Issue #2086 / GRQ-25),
  // then repair when recurrent synapses were stripped (GRQ-12), duplicates were
  // merged in loadFrom, or `validate` is true and a hidden has no inbound
  // (GRQ-24/25 after offline `mergeDuplicateSynapses`, and strict ingest).
  //
  // When `validate` is false we do not repair NO_INWARD-only graphs so callers
  // (e.g. discovery replay) can load intentional intermediate topologies.
  //
  // We avoid full fix() here so persisted creature.uuid does not force-clear
  // memetic (fix()'s topology-hash comparison).
  const stripOccurred = isForwardOnly && validSynapseCount < synapseCount;
  const repairNoInwardForValidate = validate &&
    creature.forwardOnly === true &&
    forwardOnlyHiddenLacksInbound(creature);
  if (
    creature.forwardOnly === true &&
    (mergedDuplicateSynapses > 0 ||
      stripOccurred ||
      repairNoInwardForValidate)
  ) {
    cleanupOrphanedNeuronsInCreature(creature);
    pruneOrphanMemeticReferences(creature);
    repairInvalidIfNeuronsInCreature(creature);
    pruneOrphanMemeticReferences(creature);
  }

  normaliseComputationalNeuronOrder(creature);

  // Issue #2378: if any weights or biases were clamped at load time, emit
  // a single aggregated warn line with the creature UUID so the offending
  // lineage can be traced in production logs (rather than thousands of
  // per-value info lines in Score.ts).
  if (clampedWeightCount > 0 || clampedBiasCount > 0) {
    const uuidLabel = creature.uuid ?? `hash:${getStructuralHash()}`;
    getLogger().warn(
      "🗜️ [loadFrom] Clamped overflowing weights/biases to " +
        `±${MAX_SAFE_WEIGHT_BIAS} on creature ${uuidLabel} (source=${sourceTag}): ` +
        `${clampedWeightCount} weight(s) (max |w|=${maxObservedWeight}), ` +
        `${clampedBiasCount} bias(es) (max |b|=${maxObservedBias}).`,
    );
  }

  if (validate) {
    creatureValidate(creature);
  }
}

/**
 * Factory method to create a creature from JSON.
 * Handles semantic version upgrades via upgradeOne().
 * Normalises legacy properties (nodes -> neurons, connections -> synapses).
 */
export function fromJSON(
  json: CreatureInternal | CreatureExport,
  validate: boolean,
  CreatureClass: {
    new (
      input: number,
      output: number,
      options: { lazyInitialization: boolean; semanticVersion?: string },
    ): Creature;
  },
  source?: string,
  options?: LoadFromOptions,
): Creature {
  const sourceTag = source ?? "fromJSON";
  // Issue #2349: treat empty/falsy semanticVersion the same as missing.
  // An empty version is NOT a genuine "0.x" legacy creature — it's a
  // lost/corrupt version field. Only run upgradeOne for real 0.x versions.
  const rawVersion = json.semanticVersion || undefined;
  if (rawVersion && rawVersion.startsWith("0.")) {
    json = upgradeOne(json);
  }

  const creature = new CreatureClass(json.input, json.output, {
    lazyInitialization: true,
    semanticVersion: json.semanticVersion || undefined,
  });

  const raw = json as unknown as Record<string, unknown>;
  if (raw.nodes) {
    raw.neurons = raw.nodes;
    delete raw.nodes;
  }
  if (raw.connections) {
    raw.synapses = raw.connections;
    delete raw.connections;
  }
  loadFrom(creature, json, validate, sourceTag, options);

  return creature;
}

/**
 * Creates a shallow clone of a creature.
 * Significantly faster than using fromJSON(exportJSON()).
 * Issue #1025: Performance optimisation for fittest creature tracking.
 */
export function shallowClone(
  creature: Creature,
  CreatureClass: {
    new (
      input: number,
      output: number,
      options: {
        lazyInitialization: boolean;
        semanticVersion: string;
      },
    ): Creature;
  },
): Creature {
  const clone = new CreatureClass(creature.input, creature.output, {
    lazyInitialization: true,
    semanticVersion: creature.semanticVersion,
  });

  clone.uuid = creature.uuid;
  clone.score = creature.score;
  clone.forwardOnly = creature.forwardOnly;
  clone.DEBUG = creature.DEBUG;

  if (creature.memetic) {
    // Deep clone nested weights/biases/ancestry. A shallow copy shares those
    // objects with the source so mutating the clone's synapses can leave stale
    // memetic entries that still match the parent — DEBUG export then fails
    // memetic-vs-synapse validation (e.g. XOR-evolve with global DEBUG).
    clone.memetic = JSON.parse(
      JSON.stringify(creature.memetic),
    ) as MemeticInterface;
  }

  // Issue #1863: Copy per-creature evolvable hyperparameters
  if (creature.hyperparameters) {
    clone.hyperparameters = { ...creature.hyperparameters };
  }

  if (creature.tags) {
    clone.tags = [...creature.tags];
  }

  if (creature.cachedScoreComponents) {
    clone.cachedScoreComponents = { ...creature.cachedScoreComponents };
  }

  const neuronCount = creature.neurons.length;
  clone.neurons = new Array(neuronCount);

  for (let i = 0; i < creature.input; i++) {
    const original = creature.neurons[i];
    const neuron = new Neuron(original.id, "input", 0, clone);
    neuron.index = i;
    const originalTags = original.tags as TagInterface[] | undefined;
    if (originalTags) {
      (neuron as { tags: TagInterface[] | undefined }).tags = [
        ...originalTags,
      ];
    }
    clone.neurons[i] = neuron;
  }

  for (let i = creature.input; i < neuronCount; i++) {
    const original = creature.neurons[i];
    const neuron = new Neuron(
      original.id,
      original.type,
      original.bias,
      clone,
      original.squash,
      original.uuid,
    );
    neuron.index = i;
    if (original.frozen) {
      neuron.frozen = true;
    }
    const originalTags = original.tags as TagInterface[] | undefined;
    if (originalTags) {
      (neuron as { tags: TagInterface[] | undefined }).tags = [
        ...originalTags,
      ];
    }
    clone.neurons[i] = neuron;
  }

  const synapseCount = creature.synapses.length;
  clone.synapses = new Array(synapseCount);

  for (let i = 0; i < synapseCount; i++) {
    const original = creature.synapses[i];
    const synapse = new Synapse(
      original.from,
      original.to,
      original.weight,
      original.type,
    );
    if (original.frozen) {
      synapse.frozen = true;
    }
    if (original.tags) {
      synapse.tags = [...original.tags];
    }
    clone.synapses[i] = synapse;
  }

  return clone;
}
