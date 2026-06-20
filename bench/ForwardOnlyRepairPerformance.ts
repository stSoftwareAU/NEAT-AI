/**
 * Benchmark for the forward-only Offspring repair lookup (Issue #3090).
 *
 * The forward-only repair routines resolve, for each orphaned offspring neuron,
 * a parent neuron by its wire label. The previous implementation
 * (`findParentNeuronIndexByWireLabel`) rescanned the entire parent neuron array
 * — recomputing a wire label per entry — on every call, giving
 * `O(n_orphan × n_parent)` per parent. The replacement precomputes a
 * `wire label -> parent index` map once per parent (`buildParentWireLabelIndex`)
 * and resolves each lookup in O(1), giving `O(n_parent + n_orphan)`.
 *
 * End-to-end `Offspring.breed` is dominated by the WASM compile probe, so the
 * repair cost is not separately observable there (see `BreedPerformance.ts`,
 * which confirms no regression). This benchmark isolates the exact operation
 * that changed — resolving M labels against an N-neuron parent — using the real
 * `neuronWireLabelForDiagnostics` labelling, so the O(n²) → O(n) win is visible.
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/ForwardOnlyRepairPerformance.ts
 */
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { neuronWireLabelForDiagnostics } from "@neuron/NeuronSerialization.ts";

/** Build an N-hidden-neuron forward-only parent with distinct wire labels. */
function buildParent(n: number): Creature {
  const neurons: CreatureExport["neurons"] = [];
  for (let i = 0; i < n; i++) {
    neurons.push({
      type: "hidden",
      uuid: `h-${i}`,
      squash: "IDENTITY",
      bias: 0.01 * (i % 7),
    });
  }
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  const synapses: CreatureExport["synapses"] = [];
  synapses.push({ fromUUID: "input-0", toUUID: "h-0", weight: 0.3 });
  for (let i = 0; i < n - 1; i++) {
    synapses.push({ fromUUID: `h-${i}`, toUUID: `h-${i + 1}`, weight: 0.4 });
  }
  synapses.push({ fromUUID: `h-${n - 1}`, toUUID: "output-0", weight: 0.5 });

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: 2,
    output: 1,
    forwardOnly: true,
  });
  creature.validate({ forwardOnly: true });
  return creature;
}

/** Old behaviour: linear scan recomputing a wire label per entry, per call. */
function scanForLabel(parent: Creature, label: string): number | undefined {
  for (let i = 0; i < parent.neurons.length; i++) {
    if (neuronWireLabelForDiagnostics(parent.neurons[i], i) === label) return i;
  }
  return undefined;
}

/** New behaviour: precompute a wire-label -> index map once, then O(1) lookups. */
function buildLabelIndex(parent: Creature): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < parent.neurons.length; i++) {
    const label = neuronWireLabelForDiagnostics(parent.neurons[i], i);
    if (!map.has(label)) map.set(label, i);
  }
  return map;
}

// Resolve M labels (one per orphaned neuron) against both parents — the shape
// the repair routines exercise on the default forward-only breeding path.
const sizes = [100, 200, 400, 800];
for (const n of sizes) {
  const mother = buildParent(n);
  const father = buildParent(n);
  // Each hidden/output neuron is a candidate orphan needing a parent lookup.
  const labels: string[] = [];
  for (let i = 0; i < mother.neurons.length; i++) {
    labels.push(neuronWireLabelForDiagnostics(mother.neurons[i], i));
  }

  Deno.bench({
    name: `linear scan-per-call (N=${n}, M=${labels.length})`,
    group: `repair lookup N=${n}`,
    baseline: true,
    fn() {
      let acc = 0;
      for (const label of labels) {
        for (const parent of [mother, father]) {
          const idx = scanForLabel(parent, label);
          if (idx !== undefined) acc += idx;
        }
      }
      if (acc < 0) throw new Error("unreachable");
    },
  });

  Deno.bench({
    name: `precomputed map (N=${n}, M=${labels.length})`,
    group: `repair lookup N=${n}`,
    fn() {
      let acc = 0;
      const parentMaps = [mother, father].map(buildLabelIndex);
      for (const label of labels) {
        for (const map of parentMaps) {
          const idx = map.get(label);
          if (idx !== undefined) acc += idx;
        }
      }
      if (acc < 0) throw new Error("unreachable");
    },
  });
}
