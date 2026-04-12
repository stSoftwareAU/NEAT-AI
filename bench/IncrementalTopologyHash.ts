/**
 * Benchmark for incremental topology hash after connection-only changes (Issue #2258).
 *
 * Measures whether caching neuron topology data across connection-only
 * structural changes (add/remove synapse) produces a meaningful speedup
 * versus recomputing the full topology hash from scratch each time.
 *
 * The optimisation:
 * - Uses string keys instead of object allocation + JSON.stringify
 * - Uses array-based UUID lookup instead of Map
 * - Caches the neuron topology key and UUID lookup array across
 *   connection-only changes (neurons don't change, only synapses do)
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/IncrementalTopologyHash.ts
 */
import { Creature } from "@creature";
import { generate as generateV5Sync } from "@architecture/SyncV5.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { neuronUuid } from "@neuron/NeuronSerialization.ts";

const TE = new TextEncoder();
const TOPOLOGY_NAMESPACE = "a1b2c3d4-e5f6-47a8-9b0c-d1e2f3a4b5c6";

// Create creatures of varying sizes to measure scaling behaviour.
const smallCreature = new Creature(5, 3, {
  layers: [{ count: 10 }, { count: 5 }],
});
creatureValidate(smallCreature);

const mediumCreature = new Creature(20, 10, {
  layers: [{ count: 50 }, { count: 30 }],
});
creatureValidate(mediumCreature);

const largeCreature = new Creature(50, 20, {
  layers: [
    { count: 200 },
    { count: 150 },
    { count: 100 },
  ],
});
creatureValidate(largeCreature);

console.log(
  `Small creature: ${smallCreature.neurons.length} neurons, ${smallCreature.synapses.length} synapses`,
);
console.log(
  `Medium creature: ${mediumCreature.neurons.length} neurons, ${mediumCreature.synapses.length} synapses`,
);
console.log(
  `Large creature: ${largeCreature.neurons.length} neurons, ${largeCreature.synapses.length} synapses`,
);

/**
 * Reference: pre-Issue #2258 getTopologyHash implementation.
 * Uses Map-based UUID lookup, object allocation, and JSON.stringify.
 */
function oldGetTopologyHash(creature: Creature): string {
  const neurons = creature.neurons;
  const synapses = creature.synapses;
  const neuronsLength = neurons.length;
  const synapsesLength = synapses.length;
  const inputCount = creature.input;

  const uuidMap = new Map<number, string>();
  for (let i = 0; i < neuronsLength; i++) {
    const neuron = neurons[i];
    if (neuron.type === "input") {
      uuidMap.set(i, `input-${i}`);
    } else {
      uuidMap.set(i, neuronUuid(neuron));
    }
  }

  const topologyNeurons = new Array<
    { uuid: string; type: string; squash: string }
  >(neuronsLength - inputCount);
  for (let i = inputCount; i < neuronsLength; i++) {
    const neuron = neurons[i];
    topologyNeurons[i - inputCount] = {
      uuid: uuidMap.get(i)!,
      type: neuron.type,
      squash: neuron.squash || "",
    };
  }
  topologyNeurons.sort((a, b) => (a.uuid ?? "").localeCompare(b.uuid ?? ""));

  const topologySynapses = new Array<
    { fromUUID: string | undefined; toUUID: string | undefined }
  >(synapsesLength);
  for (let i = 0; i < synapsesLength; i++) {
    const synapse = synapses[i];
    topologySynapses[i] = {
      fromUUID: uuidMap.get(synapse.from),
      toUUID: uuidMap.get(synapse.to),
    };
  }
  topologySynapses.sort((a, b) => {
    const fc = (a.fromUUID ?? "").localeCompare(b.fromUUID ?? "");
    if (fc !== 0) return fc;
    return (a.toUUID ?? "").localeCompare(b.toUUID ?? "");
  });

  const topologyData = {
    neurons: topologyNeurons,
    synapses: topologySynapses,
  };

  const txt = JSON.stringify(topologyData);
  const utf8 = TE.encode(txt);
  return generateV5Sync(TOPOLOGY_NAMESPACE, utf8);
}

// ============================================
// A/B: old (pre-#2258) vs new implementation — full recompute from scratch
// ============================================

Deno.bench({
  name: "OLD full recompute (small)",
  group: "full-recompute-small",
  baseline: true,
  fn() {
    oldGetTopologyHash(smallCreature);
  },
});

Deno.bench({
  name: "NEW full recompute (small)",
  group: "full-recompute-small",
  fn() {
    smallCreature.topologyHash = undefined;
    smallCreature._cachedNeuronTopologyKey = undefined;
    smallCreature._cachedUuidLookup = undefined;
    CreatureUtil.getTopologyHash(smallCreature);
  },
});

Deno.bench({
  name: "OLD full recompute (medium)",
  group: "full-recompute-medium",
  baseline: true,
  fn() {
    oldGetTopologyHash(mediumCreature);
  },
});

Deno.bench({
  name: "NEW full recompute (medium)",
  group: "full-recompute-medium",
  fn() {
    mediumCreature.topologyHash = undefined;
    mediumCreature._cachedNeuronTopologyKey = undefined;
    mediumCreature._cachedUuidLookup = undefined;
    CreatureUtil.getTopologyHash(mediumCreature);
  },
});

Deno.bench({
  name: "OLD full recompute (large)",
  group: "full-recompute-large",
  baseline: true,
  fn() {
    oldGetTopologyHash(largeCreature);
  },
});

Deno.bench({
  name: "NEW full recompute (large)",
  group: "full-recompute-large",
  fn() {
    largeCreature.topologyHash = undefined;
    largeCreature._cachedNeuronTopologyKey = undefined;
    largeCreature._cachedUuidLookup = undefined;
    CreatureUtil.getTopologyHash(largeCreature);
  },
});

// ============================================
// Incremental: connection-only change (neuron cache preserved)
// This simulates what happens after clearConnectionCaches().
// ============================================

// Prime neuron caches first.
smallCreature.topologyHash = undefined;
smallCreature._cachedNeuronTopologyKey = undefined;
smallCreature._cachedUuidLookup = undefined;
CreatureUtil.getTopologyHash(smallCreature);

mediumCreature.topologyHash = undefined;
mediumCreature._cachedNeuronTopologyKey = undefined;
mediumCreature._cachedUuidLookup = undefined;
CreatureUtil.getTopologyHash(mediumCreature);

largeCreature.topologyHash = undefined;
largeCreature._cachedNeuronTopologyKey = undefined;
largeCreature._cachedUuidLookup = undefined;
CreatureUtil.getTopologyHash(largeCreature);

Deno.bench({
  name: "OLD full recompute after conn change (small)",
  group: "conn-change-small",
  baseline: true,
  fn() {
    oldGetTopologyHash(smallCreature);
  },
});

Deno.bench({
  name: "NEW incremental after conn change (small)",
  group: "conn-change-small",
  fn() {
    // Simulate clearConnectionCaches: clears topologyHash but preserves neuron caches.
    smallCreature.topologyHash = undefined;
    CreatureUtil.getTopologyHash(smallCreature);
  },
});

Deno.bench({
  name: "OLD full recompute after conn change (medium)",
  group: "conn-change-medium",
  baseline: true,
  fn() {
    oldGetTopologyHash(mediumCreature);
  },
});

Deno.bench({
  name: "NEW incremental after conn change (medium)",
  group: "conn-change-medium",
  fn() {
    mediumCreature.topologyHash = undefined;
    CreatureUtil.getTopologyHash(mediumCreature);
  },
});

Deno.bench({
  name: "OLD full recompute after conn change (large)",
  group: "conn-change-large",
  baseline: true,
  fn() {
    oldGetTopologyHash(largeCreature);
  },
});

Deno.bench({
  name: "NEW incremental after conn change (large)",
  group: "conn-change-large",
  fn() {
    largeCreature.topologyHash = undefined;
    CreatureUtil.getTopologyHash(largeCreature);
  },
});
