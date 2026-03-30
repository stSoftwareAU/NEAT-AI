/**
 * Canonicalises the computational slice to: all constants (stable relative order),
 * then all hiddens (stable relative order), before outputs. Required by
 * {@link creatureValidate} (`NEURON_ORDER`) and tooling that assumes layer blocks.
 */

import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";

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
