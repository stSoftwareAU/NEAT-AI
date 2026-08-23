/**
 * Shared assertion for Issue #3844: a creature's `memetic` record must never
 * name structure the creature no longer carries.
 *
 * `memetic` holds per-neuron bias deltas and per-synapse weight deltas keyed to
 * a **specific structure**. Carrying `memetic` is perfectly legitimate — what
 * must never happen is a key that resolves to nothing, because the Rust reader
 * fails loud on one.
 *
 * The check runs against the **wire export**, not the runtime record, because
 * that is the shape that leaves the process. A stale *wire label* is dropped
 * silently on the next import (`NormaliseCreatureExport.convertMapKeys` cannot
 * resolve it), but a stale *runtime integer* key is copied through verbatim by
 * both `convertMapKeys` ("already a numeric key") and
 * `MemeticWireExport.canonicalBiases` (`next[wireKey ?? k]`) — so it reaches
 * the wire and downstream engines. Checking the export catches both.
 *
 * `ancestry[]` snapshots are walked to any depth: they are keyed to older
 * structures and are the half of the record no per-removal cleanup helper
 * inspects.
 *
 * @module
 */
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

/** Wire identities and synapse pairs a creature export actually carries. */
function liveStructure(
  exported: CreatureExport,
): { labels: Set<string>; ids: Set<number>; synapses: Set<string> } {
  const labels = new Set<string>();
  const ids = new Set<number>();
  const inputs = exported.input ?? 0;
  for (let i = 0; i < inputs; i++) {
    labels.add(`input-${i}`);
    // Input neurons carry the runtime id of their index.
    ids.add(i);
  }
  for (const neuron of exported.neurons) {
    if (typeof neuron.uuid === "string") labels.add(neuron.uuid);
    const id = (neuron as { id?: number }).id;
    if (typeof id === "number") ids.add(id);
  }

  const synapses = new Set<string>();
  for (const synapse of exported.synapses) {
    if (synapse.fromUUID && synapse.toUUID) {
      synapses.add(`${synapse.fromUUID}->${synapse.toUUID}`);
    }
  }
  return { labels, ids, synapses };
}

/** True when a memetic key names a neuron the creature still carries. */
function resolvesToNeuron(
  key: string,
  live: ReturnType<typeof liveStructure>,
): boolean {
  const asNumber = Number(key);
  if (Number.isFinite(asNumber) && `${asNumber}` === key) {
    return live.ids.has(asNumber);
  }
  return live.labels.has(key);
}

// deno-lint-ignore no-explicit-any
type Snapshot = any;

function walkSnapshot(
  snapshot: Snapshot,
  live: ReturnType<typeof liveStructure>,
  path: string,
  dangling: string[],
): void {
  const biases = snapshot?.biases;
  if (biases && typeof biases === "object") {
    for (const key of Object.keys(biases)) {
      if (!resolvesToNeuron(key, live)) {
        dangling.push(`${path}.biases["${key}"] names no live neuron`);
      }
    }
  }

  const weights = snapshot?.weights;
  if (Array.isArray(weights)) {
    for (const row of weights) {
      const from = row?.fromUUID;
      const to = row?.toUUID;
      if (typeof from === "string" && !live.labels.has(from)) {
        dangling.push(
          `${path}.weights fromUUID "${from}" names no live neuron`,
        );
      }
      if (typeof to === "string" && !live.labels.has(to)) {
        dangling.push(`${path}.weights toUUID "${to}" names no live neuron`);
      }
      if (
        typeof from === "string" && typeof to === "string" &&
        live.labels.has(from) && live.labels.has(to) &&
        !live.synapses.has(`${from}->${to}`)
      ) {
        dangling.push(`${path}.weights "${from}->${to}" names no live synapse`);
      }
    }
  } else if (weights && typeof weights === "object") {
    // Legacy map shape — accepted on import, so assert it too.
    for (const key of Object.keys(weights)) {
      if (!resolvesToNeuron(key, live)) {
        dangling.push(`${path}.weights["${key}"] names no live neuron`);
      }
      const entries = weights[key];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (
          typeof entry?.toId === "number" && !live.ids.has(entry.toId)
        ) {
          dangling.push(
            `${path}.weights toId ${entry.toId} names no live neuron`,
          );
        }
        if (
          typeof entry?.toUUID === "string" && !live.labels.has(entry.toUUID)
        ) {
          dangling.push(
            `${path}.weights toUUID "${entry.toUUID}" names no live neuron`,
          );
        }
      }
    }
  }

  if (Array.isArray(snapshot?.ancestry)) {
    snapshot.ancestry.forEach((ancestor: Snapshot, index: number) => {
      walkSnapshot(ancestor, live, `${path}.ancestry[${index}]`, dangling);
    });
  }
}

/**
 * Every memetic key — top level and in every `ancestry[]` snapshot — that no
 * longer resolves to structure the export carries. Empty is the invariant.
 */
export function danglingMemeticReferences(
  exported: CreatureExport,
): string[] {
  if (!exported.memetic) return [];
  const dangling: string[] = [];
  walkSnapshot(exported.memetic, liveStructure(exported), "memetic", dangling);
  return dangling;
}
