/**
 * Benchmark for the load-side memetic prune in `loadFrom` (Issue #4062).
 *
 * Context: `Creature.fromJSON` now prunes any `memetic` row or bias key that
 * names structure the file does not carry. The prune works on a private copy
 * of the memetic, so this benchmark measures what that adds to a load on a
 * production-scale creature (~2000 synapses): a memetic carrying ~200 weight
 * rows, with a 3-deep ancestry (the DEFAULT_ANCESTRY_DEPTH cap), against the
 * same creature with no memetic at all (the control).
 *
 * Every row in the memetic names a real synapse, so the prune removes nothing:
 * the numbers are the cost of the common, clean path.
 *
 * Run with:
 *   deno bench -A bench/LoadFromMemeticPrune.ts
 */
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

/** Weight rows carried by each memetic snapshot. */
const MEMETIC_ROWS = 200;

type WireRow = { fromUUID: string; toUUID: string; weight: number };
type WireSnapshot = {
  generation: number;
  score: number;
  biases: Record<string, number>;
  weights: WireRow[];
  ancestry?: WireSnapshot[];
};

// A production-scale creature: 40 inputs, 40 hidden, 10 outputs, 2000 synapses.
const creature = new Creature(40, 10, { layers: [{ count: 40 }] });
const plainJSON: CreatureExport = creature.exportJSON();

const hiddenUuids = plainJSON.neurons
  .filter((n) => n.type === "hidden" && typeof n.uuid === "string")
  .map((n) => n.uuid as string);

/** Rows naming real synapses of this creature, with weights scaled by `scale`. */
function rowsFor(scale: number): WireRow[] {
  return plainJSON.synapses.slice(0, MEMETIC_ROWS).map((s) => ({
    fromUUID: s.fromUUID as string,
    toUUID: s.toUUID as string,
    weight: s.weight * scale,
  }));
}

/** One memetic snapshot with a bias for each hidden neuron. */
function snapshot(
  generation: number,
  score: number,
  scale: number,
  ancestry?: WireSnapshot[],
): WireSnapshot {
  const biases: Record<string, number> = {};
  for (const uuid of hiddenUuids) biases[uuid] = 0.01 * scale;
  return {
    generation,
    score,
    biases,
    weights: rowsFor(scale),
    ancestry,
  };
}

// Root plus three ancestors, nested: root.ancestry[0].ancestry[0].ancestry[0].
const memeticSnapshot = snapshot(4, -0.2, 1.0, [
  snapshot(3, -0.3, 0.9, [
    snapshot(2, -0.4, 0.8, [
      snapshot(1, -0.5, 0.7),
    ]),
  ]),
]);

const withMemeticJSON = {
  ...plainJSON,
  memetic: memeticSnapshot,
} as unknown as CreatureExport;

console.log("=== loadFrom memetic prune Benchmark (Issue #4062) ===");
console.log(
  `Creature: ${creature.neurons.length} neurons, ${creature.synapses.length} synapses`,
);
console.log(
  `Memetic: ${MEMETIC_ROWS} weight rows at the root, 3 ancestors deep (${MEMETIC_ROWS} rows each)\n`,
);

Deno.bench({
  name: "2000 synapses - fromJSON without memetic (control)",
  group: "loadFrom memetic prune",
  baseline: true,
  fn() {
    Creature.fromJSON(plainJSON, false);
  },
});

Deno.bench({
  name: "2000 synapses - fromJSON with 200-row memetic and 3-deep ancestry",
  group: "loadFrom memetic prune",
  fn() {
    Creature.fromJSON(withMemeticJSON, false);
  },
});
