/**
 * Benchmark: Cache SynapseState reference to avoid nested-Map double lookup
 * (Issue #3089).
 *
 * The per-step backprop path resolves a synapse's SynapseState through a
 * two-level Map (two hash lookups). connectionFor() memoises the reference on
 * the Synapse instance, returning it after a single generation comparison.
 *
 * This bench isolates the per-step state lookup that no existing bench covered
 * (NumericConnectionKeys measures the topology connectionSet, not this state
 * lookup). It compares:
 *   - connection(from, to)  — the original nested-Map double lookup
 *   - connectionFor(synapse) — the cached reference path (steady state)
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env bench/SynapseStateConnectionLookup.ts
 */
import { Creature } from "@creature";
import type { Synapse } from "@architecture/Synapse.ts";

function buildCreature(targetNeurons: number): Creature {
  const input = Math.max(5, Math.floor(targetNeurons * 0.1));
  const output = Math.max(2, Math.floor(targetNeurons * 0.05));
  const hidden = targetNeurons - input - output;

  if (hidden <= 0) {
    return new Creature(input, output);
  }

  const layerCount = Math.min(3, Math.ceil(hidden / 20));
  const perLayer = Math.floor(hidden / layerCount);
  const layers = [];
  for (let i = 0; i < layerCount; i++) {
    layers.push({
      count: i === layerCount - 1
        ? hidden - perLayer * (layerCount - 1)
        : perLayer,
    });
  }
  return new Creature(input, output, { layers });
}

const creature200 = buildCreature(200);
const creature500 = buildCreature(500);

console.log("=== Creature Sizes ===");
console.log(
  `~200: ${creature200.neurons.length} neurons, ${creature200.synapses.length} synapses`,
);
console.log(
  `~500: ${creature500.neurons.length} neurons, ${creature500.synapses.length} synapses`,
);

// Each backprop step touches each synapse's state multiple times (adjustedWeight
// alone resolves it 2-3x). Replay that multiplicity per synapse.
const TOUCHES_PER_SYNAPSE = 3;

function runConnection(creature: Creature): number {
  const state = creature.state;
  const synapses = creature.synapses;
  let acc = 0;
  for (let i = 0; i < synapses.length; i++) {
    const c = synapses[i];
    for (let t = 0; t < TOUCHES_PER_SYNAPSE; t++) {
      acc += state.connection(c.from, c.to).count;
    }
  }
  return acc;
}

function runConnectionFor(creature: Creature, synapses: Synapse[]): number {
  const state = creature.state;
  let acc = 0;
  for (let i = 0; i < synapses.length; i++) {
    const c = synapses[i];
    for (let t = 0; t < TOUCHES_PER_SYNAPSE; t++) {
      acc += state.connectionFor(c).count;
    }
  }
  return acc;
}

// Prime the connectionFor cache once so we measure the steady-state hit path,
// which is what the inner training loop sees across samples and epochs.
runConnectionFor(creature200, creature200.synapses);
runConnectionFor(creature500, creature500.synapses);

Deno.bench({
  name: "connection() nested-Map double lookup (~200 neurons)",
  group: "stateLookup-200",
  baseline: true,
  fn: () => {
    runConnection(creature200);
  },
});

Deno.bench({
  name: "connectionFor() cached reference (~200 neurons)",
  group: "stateLookup-200",
  fn: () => {
    runConnectionFor(creature200, creature200.synapses);
  },
});

Deno.bench({
  name: "connection() nested-Map double lookup (~500 neurons)",
  group: "stateLookup-500",
  baseline: true,
  fn: () => {
    runConnection(creature500);
  },
});

Deno.bench({
  name: "connectionFor() cached reference (~500 neurons)",
  group: "stateLookup-500",
  fn: () => {
    runConnectionFor(creature500, creature500.synapses);
  },
});
