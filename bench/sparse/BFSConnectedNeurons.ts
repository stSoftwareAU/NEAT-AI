/**
 * Benchmark to compare Array.shift() (O(n)) vs index pointer (O(1)) in BFS.
 *
 * Issue #1030: Replace Array.shift() with deque in BFS sparse evaluation
 *
 * The getConnectedNeurons function uses BFS to find neurons connected by
 * a specified number of steps. Array.shift() is O(n) because it must
 * reindex all remaining elements, making the overall BFS O(n^2).
 * Using an index pointer instead makes each dequeue O(1), reducing
 * overall complexity to O(n).
 *
 * Benchmark results (Apple M4 Pro):
 *
 * | benchmark                             | time/iter (avg) |   iter/s |
 * | ------------------------------------- | --------------- | -------- |
 * | BFS with Array.shift() - O(n) dequeue |        642.8 µs |    1,556 |
 * | BFS with index pointer - O(1) dequeue |        562.5 µs |    1,778 |
 *
 * Result: ~14% performance improvement with index pointer approach
 */

/**
 * Original implementation using Array.shift() - O(n) per dequeue
 */
function getConnectedNeuronsShift(
  neuronUUID: string,
  synapseMap: Map<string, Set<string>>,
  steps: number,
): Set<string> {
  const connectedNeurons = new Set<string>();
  const queue = [{ neuronUUID, depth: 0 }];

  while (queue.length > 0) {
    const { neuronUUID: current, depth } = queue.shift()!;

    if (depth >= steps) continue;

    const neighbours = synapseMap.get(current) || new Set();
    for (const neighbour of neighbours) {
      if (!connectedNeurons.has(neighbour)) {
        connectedNeurons.add(neighbour);
        queue.push({ neuronUUID: neighbour, depth: depth + 1 });
      }
    }
  }

  return connectedNeurons;
}

/**
 * Optimised implementation using index pointer - O(1) per dequeue
 */
function getConnectedNeuronsIndexPointer(
  neuronUUID: string,
  synapseMap: Map<string, Set<string>>,
  steps: number,
): Set<string> {
  const connectedNeurons = new Set<string>();
  const queue = [{ neuronUUID, depth: 0 }];
  let front = 0;

  while (front < queue.length) {
    const { neuronUUID: current, depth } = queue[front++];

    if (depth >= steps) continue;

    const neighbours = synapseMap.get(current) || new Set();
    for (const neighbour of neighbours) {
      if (!connectedNeurons.has(neighbour)) {
        connectedNeurons.add(neighbour);
        queue.push({ neuronUUID: neighbour, depth: depth + 1 });
      }
    }
  }

  return connectedNeurons;
}

/**
 * Build a large synthetic graph for benchmarking.
 * Creates a graph with many neurons and connections to stress-test the BFS.
 */
function buildLargeSynapseMap(
  neuronCount: number,
  connectionsPerNeuron: number,
): Map<string, Set<string>> {
  const synapseMap = new Map<string, Set<string>>();

  for (let i = 0; i < neuronCount; i++) {
    const neuronUUID = `neuron-${i}`;
    const connections = new Set<string>();

    for (let j = 0; j < connectionsPerNeuron; j++) {
      const targetIndex = (i + j + 1) % neuronCount;
      connections.add(`neuron-${targetIndex}`);
    }

    synapseMap.set(neuronUUID, connections);
  }

  return synapseMap;
}

// Create test data with a reasonably large graph
// Larger values stress-test the O(n) vs O(1) difference more clearly
const NEURON_COUNT = 5000;
const CONNECTIONS_PER_NEURON = 15;
const BFS_DEPTH = 4;

const largeGraph = buildLargeSynapseMap(NEURON_COUNT, CONNECTIONS_PER_NEURON);
const startNeurons = Array.from({ length: 100 }, (_, i) => `neuron-${i * 10}`);

Deno.bench("BFS with Array.shift() - O(n) dequeue", () => {
  for (const startNeuron of startNeurons) {
    getConnectedNeuronsShift(startNeuron, largeGraph, BFS_DEPTH);
  }
});

Deno.bench("BFS with index pointer - O(1) dequeue", () => {
  for (const startNeuron of startNeurons) {
    getConnectedNeuronsIndexPointer(startNeuron, largeGraph, BFS_DEPTH);
  }
});

// Verify both implementations produce the same results
const testResult1 = getConnectedNeuronsShift(
  "neuron-0",
  largeGraph,
  BFS_DEPTH,
);
const testResult2 = getConnectedNeuronsIndexPointer(
  "neuron-0",
  largeGraph,
  BFS_DEPTH,
);

if (testResult1.size !== testResult2.size) {
  throw new Error(
    `Results differ: shift=${testResult1.size}, indexPointer=${testResult2.size}`,
  );
}

for (const neuron of testResult1) {
  if (!testResult2.has(neuron)) {
    throw new Error(`Neuron ${neuron} missing from index pointer result`);
  }
}

console.log(
  `Verification passed: Both implementations return ${testResult1.size} connected neurons`,
);
