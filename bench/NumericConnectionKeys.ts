/**
 * Benchmark: Replace string-keyed connectionSet with numeric keys (Issue #1659)
 *
 * Measures hasConnection() and getAvailableConnections() throughput on creatures
 * of varying size (50, 200, 500 neurons) to compare string vs numeric key
 * performance in the connectionSet.
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/NumericConnectionKeys.ts
 */
import { Creature } from "@creature";

// Build creatures of various sizes
function buildCreature(targetNeurons: number): Creature {
  // Start with a layered creature close to the target size
  const input = Math.max(5, Math.floor(targetNeurons * 0.1));
  const output = Math.max(2, Math.floor(targetNeurons * 0.05));
  const hidden = targetNeurons - input - output;

  if (hidden <= 0) {
    return new Creature(input, output);
  }

  // Distribute hidden neurons across layers
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

// Build test creatures
const creature50 = buildCreature(50);
const creature200 = buildCreature(200);
const creature500 = buildCreature(500);

console.log("=== Creature Sizes ===");
console.log(
  `~50: ${creature50.neurons.length} neurons, ${creature50.synapses.length} synapses`,
);
console.log(
  `~200: ${creature200.neurons.length} neurons, ${creature200.synapses.length} synapses`,
);
console.log(
  `~500: ${creature500.neurons.length} neurons, ${creature500.synapses.length} synapses`,
);

// --- hasConnection benchmarks ---

Deno.bench({
  name: "hasConnection (~50 neurons, 1000 lookups)",
  group: "hasConnection",
  baseline: true,
  fn() {
    const c = Creature.fromJSON(creature50.exportJSON());
    const neuronCount = c.neurons.length;
    // Perform 1000 lookups — mix of existing and non-existing
    for (let i = 0; i < 1000; i++) {
      const from = i % neuronCount;
      const to = (i * 7 + 3) % neuronCount;
      c.hasConnection(from, to);
    }
  },
});

Deno.bench({
  name: "hasConnection (~200 neurons, 1000 lookups)",
  group: "hasConnection",
  fn() {
    const c = Creature.fromJSON(creature200.exportJSON());
    const neuronCount = c.neurons.length;
    for (let i = 0; i < 1000; i++) {
      const from = i % neuronCount;
      const to = (i * 7 + 3) % neuronCount;
      c.hasConnection(from, to);
    }
  },
});

Deno.bench({
  name: "hasConnection (~500 neurons, 1000 lookups)",
  group: "hasConnection",
  fn() {
    const c = Creature.fromJSON(creature500.exportJSON());
    const neuronCount = c.neurons.length;
    for (let i = 0; i < 1000; i++) {
      const from = i % neuronCount;
      const to = (i * 7 + 3) % neuronCount;
      c.hasConnection(from, to);
    }
  },
});

// --- getAvailableConnections benchmarks ---

Deno.bench({
  name: "getAvailableConnections (~50 neurons, uncached)",
  group: "getAvailableConnections",
  baseline: true,
  fn() {
    const c = Creature.fromJSON(creature50.exportJSON());
    c.clearCache();
    c.getAvailableConnections();
  },
});

Deno.bench({
  name: "getAvailableConnections (~200 neurons, uncached)",
  group: "getAvailableConnections",
  fn() {
    const c = Creature.fromJSON(creature200.exportJSON());
    c.clearCache();
    c.getAvailableConnections();
  },
});

Deno.bench({
  name: "getAvailableConnections (~500 neurons, uncached)",
  group: "getAvailableConnections",
  fn() {
    const c = Creature.fromJSON(creature500.exportJSON());
    c.clearCache();
    c.getAvailableConnections();
  },
});

// --- connectionSet build benchmarks ---

Deno.bench({
  name: "connectionSet build (~50 neurons)",
  group: "connectionSet build",
  baseline: true,
  fn() {
    const c = Creature.fromJSON(creature50.exportJSON());
    c.clearCache();
    c.getConnectionSet();
  },
});

Deno.bench({
  name: "connectionSet build (~200 neurons)",
  group: "connectionSet build",
  fn() {
    const c = Creature.fromJSON(creature200.exportJSON());
    c.clearCache();
    c.getConnectionSet();
  },
});

Deno.bench({
  name: "connectionSet build (~500 neurons)",
  group: "connectionSet build",
  fn() {
    const c = Creature.fromJSON(creature500.exportJSON());
    c.clearCache();
    c.getConnectionSet();
  },
});
