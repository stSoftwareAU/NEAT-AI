/**
 * Detailed benchmark breaking down calculatePathsToOutput into map building vs BFS.
 * Issue #1294: Path-to-output caching for sparse training.
 *
 * Usage:
 *   deno run -A bench/sparse/PathToOutputCacheDetailed.ts
 */

import { Creature } from "../../src/Creature.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { chooseNeurons } from "../../src/propagate/sparse/ChooseNeurons.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { SynapseExport } from "../../src/architecture/SynapseInterfaces.ts";

function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}µs`;
  } else if (ms < 1000) {
    return `${ms.toFixed(3)}ms`;
  } else {
    return `${(ms / 1000).toFixed(3)}s`;
  }
}

/** Build outgoing synapse map - this is the part we want to cache */
function buildOutgoingSynapsesMap(
  creature: CreatureExport,
): Map<string, SynapseExport[]> {
  const outgoingSynapsesMap = new Map<string, SynapseExport[]>();
  creature.synapses.forEach((synapse) => {
    if (!outgoingSynapsesMap.has(synapse.fromUUID)) {
      outgoingSynapsesMap.set(synapse.fromUUID, []);
    }
    outgoingSynapsesMap.get(synapse.fromUUID)!.push(synapse);
  });
  return outgoingSynapsesMap;
}

/** BFS using pre-built map - uses queue.shift() (current implementation) */
function bfsWithShift(
  selectedNeurons: Readonly<Set<string>>,
  outgoingSynapsesMap: Map<string, SynapseExport[]>,
): Set<string> {
  const pathNeurons = new Set<string>(selectedNeurons);
  const queue = Array.from(selectedNeurons);

  while (queue.length > 0) {
    const currentNeuronUUID = queue.shift()!;
    const outgoingSynapses = outgoingSynapsesMap.get(currentNeuronUUID) || [];

    for (const synapse of outgoingSynapses) {
      const toUUID = synapse.toUUID;
      if (!pathNeurons.has(toUUID)) {
        pathNeurons.add(toUUID);
        queue.push(toUUID);
      }
    }
  }
  return pathNeurons;
}

/** BFS using pre-built map - uses index pointer (optimised) */
function bfsWithIndexPointer(
  selectedNeurons: Readonly<Set<string>>,
  outgoingSynapsesMap: Map<string, SynapseExport[]>,
): Set<string> {
  const pathNeurons = new Set<string>(selectedNeurons);
  const queue = Array.from(selectedNeurons);
  let front = 0;

  while (front < queue.length) {
    const currentNeuronUUID = queue[front++];
    const outgoingSynapses = outgoingSynapsesMap.get(currentNeuronUUID) || [];

    for (const synapse of outgoingSynapses) {
      const toUUID = synapse.toUUID;
      if (!pathNeurons.has(toUUID)) {
        pathNeurons.add(toUUID);
        queue.push(toUUID);
      }
    }
  }
  return pathNeurons;
}

function runBenchmark() {
  console.log("=".repeat(70));
  console.log("Detailed Path-to-Output Benchmark (Issue #1294)");
  console.log("=".repeat(70));

  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  );

  const creatureExport = creature.exportJSON();
  console.log(`Neurons: ${creatureExport.neurons.length}`);
  console.log(`Synapses: ${creatureExport.synapses.length}`);

  const config = createBackPropagationConfig({ sparseRatio: 0.05 });
  const selectedNeurons = chooseNeurons(creatureExport, config);
  console.log(`Selected neurons: ${selectedNeurons.size}`);

  const iterations = 1000;

  // Benchmark: Map building only
  console.log(`\n--- Map Building (${iterations} iterations) ---`);
  for (let i = 0; i < 20; i++) buildOutgoingSynapsesMap(creatureExport);

  let mapStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    buildOutgoingSynapsesMap(creatureExport);
  }
  let mapEnd = performance.now();
  const mapAvg = (mapEnd - mapStart) / iterations;
  console.log(`Average: ${formatDuration(mapAvg)}`);

  // Benchmark: BFS with shift (current approach)
  const preBuiltMap = buildOutgoingSynapsesMap(creatureExport);

  console.log(`\n--- BFS with shift (${iterations} iterations) ---`);
  for (let i = 0; i < 20; i++) bfsWithShift(selectedNeurons, preBuiltMap);

  mapStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    bfsWithShift(selectedNeurons, preBuiltMap);
  }
  mapEnd = performance.now();
  const bfsShiftAvg = (mapEnd - mapStart) / iterations;
  console.log(`Average: ${formatDuration(bfsShiftAvg)}`);

  // Benchmark: BFS with index pointer (optimised)
  console.log(`\n--- BFS with index pointer (${iterations} iterations) ---`);
  for (let i = 0; i < 20; i++) {
    bfsWithIndexPointer(selectedNeurons, preBuiltMap);
  }

  mapStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    bfsWithIndexPointer(selectedNeurons, preBuiltMap);
  }
  mapEnd = performance.now();
  const bfsIndexAvg = (mapEnd - mapStart) / iterations;
  console.log(`Average: ${formatDuration(bfsIndexAvg)}`);

  // Verify both BFS produce same results
  const result1 = bfsWithShift(selectedNeurons, preBuiltMap);
  const result2 = bfsWithIndexPointer(selectedNeurons, preBuiltMap);
  if (result1.size !== result2.size) {
    throw new Error(
      `Results differ: shift=${result1.size}, index=${result2.size}`,
    );
  }

  console.log(`\n--- Summary ---`);
  console.log(
    `Map building: ${formatDuration(mapAvg)} (${
      (mapAvg / (mapAvg + bfsShiftAvg) * 100).toFixed(1)
    }% of total)`,
  );
  console.log(
    `BFS (shift): ${formatDuration(bfsShiftAvg)} (${
      (bfsShiftAvg / (mapAvg + bfsShiftAvg) * 100).toFixed(1)
    }% of total)`,
  );
  console.log(`BFS (index pointer): ${formatDuration(bfsIndexAvg)}`);
  console.log(`Total without cache: ${formatDuration(mapAvg + bfsShiftAvg)}`);
  console.log(
    `Total with cache + index pointer: ${formatDuration(bfsIndexAvg)}`,
  );
  console.log(
    `Savings: ${formatDuration(mapAvg + bfsShiftAvg - bfsIndexAvg)} (${
      ((mapAvg + bfsShiftAvg - bfsIndexAvg) / (mapAvg + bfsShiftAvg) * 100)
        .toFixed(1)
    }%)`,
  );

  console.log("\nJSON Summary:");
  console.log(JSON.stringify(
    {
      benchmark: "PathToOutputCacheDetailed",
      issue: 1294,
      mapBuildAvgMs: mapAvg,
      bfsShiftAvgMs: bfsShiftAvg,
      bfsIndexPointerAvgMs: bfsIndexAvg,
      totalWithoutCacheMs: mapAvg + bfsShiftAvg,
      totalWithCacheMs: bfsIndexAvg,
      savingsPercent: (mapAvg + bfsShiftAvg - bfsIndexAvg) /
        (mapAvg + bfsShiftAvg) * 100,
    },
    null,
    2,
  ));
}

runBenchmark();
