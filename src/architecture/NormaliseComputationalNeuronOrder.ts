/**
 * Canonicalises the computational slice to: all constants (stable relative order),
 * then all hiddens (stable relative order), before outputs. Required by
 * {@link creatureValidate} (`NEURON_ORDER`) and tooling that assumes layer blocks.
 */

import { assert } from "@std/assert";
import type { CreatureExport } from "./CreatureInterfaces.ts";
import type { Creature } from "../Creature.ts";

/**
 * Moves one neuron to a target index, remapping synapse endpoints and
 * `neuron.index`. Used when repair paths flip hidden→constant in place.
 */
export function moveNeuronToIndex(
  creature: Creature,
  from: number,
  to: number,
): void {
  if (from === to) return;
  const neurons = creature.neurons;
  const n = neurons.length;
  const order = Array.from({ length: n }, (_, i) => i);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const oldToNew = new Array<number>(n);
  for (let ni = 0; ni < n; ni++) {
    oldToNew[order[ni]!] = ni;
  }
  for (const s of creature.synapses) {
    s.from = oldToNew[s.from]!;
    s.to = oldToNew[s.to]!;
  }
  creature.synapses.sort((a, b) =>
    a.from !== b.from ? a.from - b.from : a.to - b.to
  );
  creature.neurons = order.map((oi) => neurons[oi]!);
  creature.neurons.forEach((neuron, i) => {
    neuron.index = i;
  });
  creature.clearCache();
}

/**
 * After a hidden neuron becomes a constant in place, move it into the constant
 * prefix (before any hidden) so breeding/mutation paths stay valid without
 * calling {@link Creature.fix}.
 */
export function moveConstantNeuronIntoPrefix(
  creature: Creature,
  idx: number,
): void {
  const n = creature.neurons[idx];
  if (n === undefined || n.type !== "constant") return;
  const { input, output, neurons } = creature;
  const start = input;
  const end = neurons.length - output;
  if (idx < start || idx >= end) return;
  let insertAt = start;
  while (insertAt < end && neurons[insertAt]!.type === "constant") {
    insertAt++;
  }
  if (idx < insertAt) return;
  moveNeuronToIndex(creature, idx, insertAt);
}

/**
 * Reorders {@link CreatureExport.neurons} so computational entries are
 * constants then hiddens, outputs unchanged. Synapses use ids — order only
 * affects `loadFrom` index assignment.
 */
export function normaliseComputationalNeuronOrderInExport(
  exportJSON: CreatureExport,
): void {
  const out = exportJSON.output;
  const list = exportJSON.neurons;
  if (list.length <= out) return;
  const compLen = list.length - out;
  const outBlock = list.slice(-out);
  const comp = list.slice(0, compLen);

  let seenHidden = false;
  let needs = false;
  for (const neuron of comp) {
    if (neuron.type === "hidden") seenHidden = true;
    else if (neuron.type === "constant" && seenHidden) {
      needs = true;
      break;
    }
  }
  if (!needs) return;

  const constants = comp.filter((x) => x.type === "constant");
  const hiddens = comp.filter((x) => x.type === "hidden");
  assert(
    constants.length + hiddens.length === comp.length,
    "Export computational slice must be only constant and hidden neurons",
  );
  exportJSON.neurons = [...constants, ...hiddens, ...outBlock];
}

export function normaliseComputationalNeuronOrder(creature: Creature): void {
  const { input, output, neurons } = creature;
  const start = input;
  const end = neurons.length - output;
  if (end <= start) return;

  let seenHidden = false;
  let needsReorder = false;
  for (let i = start; i < end; i++) {
    const t = neurons[i].type;
    if (t === "hidden") seenHidden = true;
    else if (t === "constant" && seenHidden) {
      needsReorder = true;
      break;
    }
  }
  if (!needsReorder) return;

  const slice = neurons.slice(start, end);
  const constants = slice.filter((n) => n.type === "constant");
  const hiddens = slice.filter((n) => n.type === "hidden");
  assert(
    constants.length + hiddens.length === slice.length,
    "Computational slice must contain only constant and hidden neurons",
  );

  const newComp = [...constants, ...hiddens];
  const oldToNew = new Map<number, number>();
  for (let ni = 0; ni < newComp.length; ni++) {
    oldToNew.set(newComp[ni].index, start + ni);
  }

  const mapIdx = (i: number): number => {
    if (i < start || i >= end) return i;
    const mapped = oldToNew.get(i);
    assert(mapped !== undefined, `Missing remap for computational index ${i}`);
    return mapped;
  };

  for (const s of creature.synapses) {
    s.from = mapIdx(s.from);
    s.to = mapIdx(s.to);
  }
  creature.synapses.sort((a, b) =>
    a.from !== b.from ? a.from - b.from : a.to - b.to
  );

  creature.neurons = [
    ...neurons.slice(0, start),
    ...newComp,
    ...neurons.slice(end),
  ];
  creature.neurons.forEach((n, i) => {
    n.index = i;
  });
  creature.clearCache();
}
