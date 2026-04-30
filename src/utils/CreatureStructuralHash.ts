/**
 * Structural hash helper used by loadFrom warnings (Issue #2500).
 *
 * Production logs were repeatedly showing
 * `[loadFrom] Stripping recurrent synapse ... (UUID: unknown)` because
 * `CreatureExport` JSON omits the creature's `uuid` field. Without a
 * stable identifier the warnings cannot be correlated and the upstream
 * corruption source remains unknown.
 *
 * This module computes a short deterministic hash of the creature JSON
 * (input/output sizes, neuron uuids/types, and synapse uuid endpoints)
 * so that two corrupt copies of the same creature share a hash even
 * when no `uuid` is present.
 */
import type {
  CreatureExport,
  CreatureInternal,
} from "@architecture/CreatureInterfaces.ts";
import type {
  SynapseExport,
  SynapseInternal,
} from "@architecture/SynapseInterfaces.ts";

/** FNV-1a 32-bit hash (deterministic, dependency-free). */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Equivalent to multiplying by the FNV prime (16777619) modulo 2^32.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) +
      (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Compute a stable 8-character hex hash from a creature JSON payload.
 *
 * The hash is intentionally cheap — it is only used for log correlation,
 * not security. Inputs:
 *  - input/output neuron counts
 *  - per-neuron `type:uuid` (sorted by uuid for synapse-order independence
 *    only on the synapse list; neurons keep their array order so creatures
 *    with reordered hidden layers do not collide)
 *  - sorted list of `fromUUID->toUUID` (or numeric fallbacks) per synapse
 */
export function computeCreatureStructuralHash(
  json: CreatureExport | CreatureInternal,
): string {
  const parts: string[] = [];
  parts.push(`i${json.input ?? 0}`);
  parts.push(`o${json.output ?? 0}`);
  parts.push(`fo:${(json as CreatureExport).forwardOnly === true ? 1 : 0}`);

  const neurons = Array.isArray(json.neurons) ? json.neurons : [];
  parts.push(`n${neurons.length}`);
  for (const n of neurons) {
    if (!n) continue;
    const uuid = typeof (n as { uuid?: unknown }).uuid === "string"
      ? (n as { uuid: string }).uuid
      : "";
    parts.push(`${n.type ?? "?"}:${uuid}`);
  }

  const synapses = Array.isArray(json.synapses) ? json.synapses : [];
  parts.push(`s${synapses.length}`);
  const synEntries: string[] = new Array(synapses.length);
  for (let i = 0; i < synapses.length; i++) {
    const s = synapses[i] as SynapseExport & SynapseInternal;
    if (!s) {
      synEntries[i] = "";
      continue;
    }
    const fromKey = typeof s.fromUUID === "string"
      ? s.fromUUID
      : `#${s.fromId ?? s.from ?? "?"}`;
    const toKey = typeof s.toUUID === "string"
      ? s.toUUID
      : `#${s.toId ?? s.to ?? "?"}`;
    synEntries[i] = `${fromKey}->${toKey}`;
  }
  synEntries.sort();
  for (const entry of synEntries) parts.push(entry);

  return fnv1a32(parts.join("|")).toString(16).padStart(8, "0");
}
