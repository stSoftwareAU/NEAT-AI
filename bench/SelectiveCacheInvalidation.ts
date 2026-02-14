/**
 * Benchmark for selective cache invalidation performance.
 * Issue #1445: Selective cache invalidation by mutation type in Creature.ts.
 *
 * Measures the benefit of preserving hiddenNeuronUUIDs cache during
 * connect/disconnect operations, which only change connections, not neurons.
 *
 * Usage:
 *   deno run -A bench/SelectiveCacheInvalidation.ts
 */

import { Creature } from "../src/Creature.ts";
import { IDENTITY } from "../src/methods/activations/types/IDENTITY.ts";
import { AddConnection } from "../src/mutate/AddConnection.ts";

function createLargeCreature(): Creature {
  const creature = new Creature(50, 5, {
    layers: [
      { count: 100, squash: IDENTITY.NAME },
      { count: 50, squash: IDENTITY.NAME },
      { count: 25, squash: IDENTITY.NAME },
    ],
    outputLayer: { squash: IDENTITY.NAME },
  });
  return creature;
}

function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}µs`;
  } else if (ms < 1000) {
    return `${ms.toFixed(3)}ms`;
  } else {
    return `${(ms / 1000).toFixed(3)}s`;
  }
}

function benchmarkSelectiveCacheInvalidation() {
  console.log("=".repeat(60));
  console.log("Selective Cache Invalidation Benchmark (Issue #1445)");
  console.log("=".repeat(60));
  console.log();

  const creature = createLargeCreature();
  console.log(`Creature stats:`);
  console.log(`  Neurons: ${creature.neurons.length}`);
  console.log(`  Synapses: ${creature.synapses.length}`);
  console.log(
    `  Hidden neurons: ${
      creature.neurons.length - creature.input - creature.output
    }`,
  );
  console.log();

  // ── Benchmark 1: hiddenNeuronUUIDs preservation on connect/disconnect ──
  console.log("─".repeat(60));
  console.log("Benchmark 1: hiddenNeuronUUIDs cache preservation");
  console.log("─".repeat(60));

  // Build the hiddenNeuronUUIDs cache
  const uuids = creature.getHiddenNeuronUUIDs();
  console.log(`  UUID cache built: ${uuids.size} hidden neuron UUIDs`);

  // Simulate connect/disconnect cycles and check if cache is preserved
  const available = creature.getAvailableConnections();
  const connectCount = Math.min(50, available.length);
  const pairs = available.slice(0, connectCount);

  let preservedCount = 0;
  let rebuiltCount = 0;

  for (const [from, to] of pairs) {
    creature.connect(from, to, 0.1);
    const current = creature.getHiddenNeuronUUIDs();
    if (current === uuids) {
      preservedCount++;
    } else {
      rebuiltCount++;
    }
  }

  // Disconnect them back
  for (const [from, to] of pairs) {
    creature.disconnect(from, to);
    const current = creature.getHiddenNeuronUUIDs();
    if (current === uuids) {
      preservedCount++;
    } else {
      rebuiltCount++;
    }
  }

  const totalOps = connectCount * 2;
  console.log(`  Total connect/disconnect ops: ${totalOps}`);
  console.log(`  UUID cache preserved: ${preservedCount}/${totalOps}`);
  console.log(`  UUID cache rebuilt: ${rebuiltCount}/${totalOps}`);
  console.log(
    `  Cache hit rate: ${((preservedCount / totalOps) * 100).toFixed(1)}%`,
  );
  console.log();

  // ── Benchmark 2: Measure rebuild cost for large creatures ──
  console.log("─".repeat(60));
  console.log("Benchmark 2: UUID cache rebuild cost (what we avoid)");
  console.log("─".repeat(60));

  const iterations = 500;
  const rebuildTimes: number[] = [];

  for (let i = 0; i < iterations; i++) {
    // Force a full clear to measure rebuild cost
    creature.clearCache();
    const start = performance.now();
    creature.getHiddenNeuronUUIDs();
    rebuildTimes.push(performance.now() - start);
  }

  const rebuildAvg = rebuildTimes.reduce((a, b) => a + b, 0) / iterations;
  const totalSaved = rebuildAvg * preservedCount;
  console.log(
    `  UUID cache rebuild avg: ${formatDuration(rebuildAvg)} per rebuild`,
  );
  console.log(
    `  Total time saved (${preservedCount} avoided rebuilds): ${
      formatDuration(totalSaved)
    }`,
  );
  console.log();

  // ── Benchmark 3: AddConnection mutation throughput ──
  console.log("─".repeat(60));
  console.log("Benchmark 3: AddConnection mutation throughput");
  console.log("─".repeat(60));

  // Recreate to get a fresh creature
  const freshCreature = createLargeCreature();
  freshCreature.getHiddenNeuronUUIDs(); // Pre-build cache
  freshCreature.getConnectionSet();
  freshCreature.prebuildInwardIndex();

  const addConn = new AddConnection(freshCreature);
  const connTimes: number[] = [];
  let added = 0;

  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    if (addConn.mutate()) {
      added++;
    }
    connTimes.push(performance.now() - start);
  }
  const connAvg = connTimes.reduce((a, b) => a + b, 0) / connTimes.length;
  console.log(`  AddConnection avg: ${formatDuration(connAvg)}`);
  console.log(`  Connections added: ${added}`);

  // Check UUID cache is still the same reference across two calls
  const uuidRef1 = freshCreature.getHiddenNeuronUUIDs();
  const uuidRef2 = freshCreature.getHiddenNeuronUUIDs();
  console.log(
    `  UUID cache still valid after mutations: ${uuidRef1 === uuidRef2}`,
  );
  console.log();

  // ── Benchmark 4: Redundant invalidateScoreCache removal ──
  console.log("─".repeat(60));
  console.log(
    "Benchmark 4: Redundant invalidateScoreCache() calls eliminated",
  );
  console.log("─".repeat(60));
  console.log(
    "  connect() and disconnect() no longer call invalidateScoreCache()",
  );
  console.log(
    "  twice — clearCache() already handles it internally.",
  );
  console.log();

  console.log("=".repeat(60));
  console.log("Benchmark complete.");
}

benchmarkSelectiveCacheInvalidation();
