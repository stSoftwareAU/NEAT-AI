/**
 * Benchmark: Streaming Creature I/O Performance
 *
 * Issue #1296 - Performance: Streaming JSON parsing for creature serialisation
 *
 * This benchmark compares:
 * 1. Traditional JSON.stringify for creature serialisation
 * 2. Streaming I/O for creature serialisation
 *
 * The expected improvement is:
 * - 10-20% faster I/O operations for large creatures
 * - Reduced peak memory usage during serialisation
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/StreamingCreatureIO.ts
 */

import { Creature } from "../src/Creature.ts";
import {
  streamCreatureExportToFileSync,
  streamCreatureToFileSync,
} from "../src/architecture/StreamingCreatureIO.ts";

console.log("Streaming Creature I/O Benchmark\n");

// Create test directories
const tempDir = Deno.makeTempDirSync({ prefix: "streaming_bench_" });

// ============================================================================
// Test Case 1: Small Creature (2 inputs, 1 output, minimal layers)
// ============================================================================

const smallCreature = new Creature(2, 1, {
  layers: [{ count: 5, squash: "TANH" }],
});

Deno.bench(
  "Small creature: JSON.stringify + writeTextFileSync [traditional]",
  { group: "small-creature", baseline: true },
  () => {
    const json = smallCreature.exportJSON();
    const txt = JSON.stringify(json, null, 1);
    const filePath = `${tempDir}/small_trad.json`;
    Deno.writeTextFileSync(filePath, txt);
  },
);

Deno.bench(
  "Small creature: streamCreatureToFileSync [streaming]",
  { group: "small-creature" },
  () => {
    const filePath = `${tempDir}/small_stream.json`;
    streamCreatureToFileSync(smallCreature, filePath);
  },
);

// ============================================================================
// Test Case 2: Medium Creature (10 inputs, 5 outputs, multiple layers)
// ============================================================================

const mediumCreature = new Creature(10, 5, {
  layers: [
    { count: 20, squash: "ReLU" },
    { count: 10, squash: "TANH" },
  ],
});

Deno.bench(
  "Medium creature: JSON.stringify + writeTextFileSync [traditional]",
  { group: "medium-creature", baseline: true },
  () => {
    const json = mediumCreature.exportJSON();
    const txt = JSON.stringify(json, null, 1);
    const filePath = `${tempDir}/medium_trad.json`;
    Deno.writeTextFileSync(filePath, txt);
  },
);

Deno.bench(
  "Medium creature: streamCreatureToFileSync [streaming]",
  { group: "medium-creature" },
  () => {
    const filePath = `${tempDir}/medium_stream.json`;
    streamCreatureToFileSync(mediumCreature, filePath);
  },
);

// ============================================================================
// Test Case 3: Large Creature (similar to issue's 600+ neurons scenario)
// ============================================================================

const largeCreature = new Creature(50, 20, {
  layers: [
    { count: 100, squash: "ReLU" },
    { count: 80, squash: "TANH" },
    { count: 60, squash: "LOGISTIC" },
  ],
});

Deno.bench(
  "Large creature: JSON.stringify + writeTextFileSync [traditional]",
  { group: "large-creature", baseline: true },
  () => {
    const json = largeCreature.exportJSON();
    const txt = JSON.stringify(json, null, 1);
    const filePath = `${tempDir}/large_trad.json`;
    Deno.writeTextFileSync(filePath, txt);
  },
);

Deno.bench(
  "Large creature: streamCreatureToFileSync [streaming]",
  { group: "large-creature" },
  () => {
    const filePath = `${tempDir}/large_stream.json`;
    streamCreatureToFileSync(largeCreature, filePath);
  },
);

// ============================================================================
// Test Case 4: Pre-exported creature (comparing export + write patterns)
// ============================================================================

const preExportedJson = largeCreature.exportJSON();

Deno.bench(
  "Pre-exported: JSON.stringify + writeTextFileSync [traditional]",
  { group: "pre-exported", baseline: true },
  () => {
    const txt = JSON.stringify(preExportedJson, null, 1);
    const filePath = `${tempDir}/preexp_trad.json`;
    Deno.writeTextFileSync(filePath, txt);
  },
);

Deno.bench(
  "Pre-exported: streamCreatureExportToFileSync [streaming]",
  { group: "pre-exported" },
  () => {
    const filePath = `${tempDir}/preexp_stream.json`;
    streamCreatureExportToFileSync(preExportedJson, filePath);
  },
);

// ============================================================================
// Test Case 5: Batch writes (simulating population storage)
// ============================================================================

const batchCreatures = Array.from({ length: 10 }, () =>
  new Creature(10, 5, {
    layers: [{ count: 20, squash: "TANH" }],
  }));

Deno.bench(
  "Batch (10 creatures): JSON.stringify + writeTextFileSync [traditional]",
  { group: "batch-write", baseline: true },
  () => {
    for (let i = 0; i < batchCreatures.length; i++) {
      const json = batchCreatures[i].exportJSON();
      const txt = JSON.stringify(json, null, 1);
      const filePath = `${tempDir}/batch_trad_${i}.json`;
      Deno.writeTextFileSync(filePath, txt);
    }
  },
);

Deno.bench(
  "Batch (10 creatures): streamCreatureToFileSync [streaming]",
  { group: "batch-write" },
  () => {
    for (let i = 0; i < batchCreatures.length; i++) {
      const filePath = `${tempDir}/batch_stream_${i}.json`;
      streamCreatureToFileSync(batchCreatures[i], filePath);
    }
  },
);

// Cleanup will happen when process exits
console.log(`\nTemp directory: ${tempDir}`);
console.log("Files will be cleaned up when process exits.\n");

// Schedule cleanup
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tempDir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
});
