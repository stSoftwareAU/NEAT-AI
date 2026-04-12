/**
 * Benchmark for duplicate exportJSON elimination (Issue #2257).
 *
 * Measures whether avoiding exportJSON inside getTopologyHash produces a
 * meaningful speedup in the fitness evaluation path. The old code called
 * exportJSON() to build the full creature JSON then extracted topology
 * fields; the new code reads topology data directly from internal arrays.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/ExportJsonTopologyReuse.ts
 */
import { Creature } from "@creature";
import { generate as generateV5Sync } from "@architecture/SyncV5.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

const TE = new TextEncoder();
const TOPOLOGY_NAMESPACE = "a1b2c3d4-e5f6-47a8-9b0c-d1e2f3a4b5c6";

// Create creatures of varying sizes
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
 * Reference: old getTopologyHash implementation that uses exportJSON()
 * internally. This is the pre-Issue #2257 code path.
 */
function oldGetTopologyHash(creature: Creature): string {
  const holdDebug = creature.DEBUG;
  try {
    creature.DEBUG = false;
    const json = creature.exportJSON();

    const topologyNeurons = json.neurons.map((n) => ({
      uuid: n.uuid,
      type: n.type,
      squash: n.squash || "",
    }));

    topologyNeurons.sort((a, b) => (a.uuid ?? "").localeCompare(b.uuid ?? ""));

    const topologySynapses = json.synapses.map((s) => ({
      fromUUID: s.fromUUID,
      toUUID: s.toUUID,
    }));

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
  } finally {
    creature.DEBUG = holdDebug;
  }
}

// ============================================
// A/B: old vs new getTopologyHash (isolated)
// ============================================

Deno.bench({
  name: "OLD getTopologyHash via exportJSON (small)",
  group: "hash-small",
  baseline: true,
  fn() {
    oldGetTopologyHash(smallCreature);
  },
});

Deno.bench({
  name: "NEW getTopologyHash direct (small)",
  group: "hash-small",
  fn() {
    smallCreature.topologyHash = undefined;
    CreatureUtil.getTopologyHash(smallCreature);
  },
});

Deno.bench({
  name: "OLD getTopologyHash via exportJSON (medium)",
  group: "hash-medium",
  baseline: true,
  fn() {
    oldGetTopologyHash(mediumCreature);
  },
});

Deno.bench({
  name: "NEW getTopologyHash direct (medium)",
  group: "hash-medium",
  fn() {
    mediumCreature.topologyHash = undefined;
    CreatureUtil.getTopologyHash(mediumCreature);
  },
});

Deno.bench({
  name: "OLD getTopologyHash via exportJSON (large)",
  group: "hash-large",
  baseline: true,
  fn() {
    oldGetTopologyHash(largeCreature);
  },
});

Deno.bench({
  name: "NEW getTopologyHash direct (large)",
  group: "hash-large",
  fn() {
    largeCreature.topologyHash = undefined;
    CreatureUtil.getTopologyHash(largeCreature);
  },
});

// ============================================
// Full fitness path: topology hash + evaluate exportJSON
// ============================================

Deno.bench({
  name: "OLD: hash(exportJSON) + evaluate exportJSON (small)",
  group: "fitness-small",
  baseline: true,
  fn() {
    oldGetTopologyHash(smallCreature);
    smallCreature.exportJSON();
  },
});

Deno.bench({
  name: "NEW: hash(direct) + evaluate exportJSON (small)",
  group: "fitness-small",
  fn() {
    smallCreature.topologyHash = undefined;
    CreatureUtil.getTopologyHash(smallCreature);
    smallCreature.exportJSON();
  },
});

Deno.bench({
  name: "OLD: hash(exportJSON) + evaluate exportJSON (medium)",
  group: "fitness-medium",
  baseline: true,
  fn() {
    oldGetTopologyHash(mediumCreature);
    mediumCreature.exportJSON();
  },
});

Deno.bench({
  name: "NEW: hash(direct) + evaluate exportJSON (medium)",
  group: "fitness-medium",
  fn() {
    mediumCreature.topologyHash = undefined;
    CreatureUtil.getTopologyHash(mediumCreature);
    mediumCreature.exportJSON();
  },
});

Deno.bench({
  name: "OLD: hash(exportJSON) + evaluate exportJSON (large)",
  group: "fitness-large",
  baseline: true,
  fn() {
    oldGetTopologyHash(largeCreature);
    largeCreature.exportJSON();
  },
});

Deno.bench({
  name: "NEW: hash(direct) + evaluate exportJSON (large)",
  group: "fitness-large",
  fn() {
    largeCreature.topologyHash = undefined;
    CreatureUtil.getTopologyHash(largeCreature);
    largeCreature.exportJSON();
  },
});

// ============================================
// Reference: single exportJSON cost (to quantify potential savings)
// ============================================

Deno.bench({
  name: "single exportJSON (small)",
  group: "exportjson-unit-cost",
  fn() {
    smallCreature.exportJSON();
  },
});

Deno.bench({
  name: "single exportJSON (medium)",
  group: "exportjson-unit-cost",
  fn() {
    mediumCreature.exportJSON();
  },
});

Deno.bench({
  name: "single exportJSON (large)",
  group: "exportjson-unit-cost",
  baseline: true,
  fn() {
    largeCreature.exportJSON();
  },
});
