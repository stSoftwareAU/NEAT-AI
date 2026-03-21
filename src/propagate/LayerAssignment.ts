/**
 * LayerAssignment.ts - Compute neuron layer/level assignments from topology.
 *
 * Issue #1920 - Assigns each neuron to a layer representing its depth from
 * the input neurons (longest path from any input to that neuron).
 *
 * - Input and constant neurons are layer 0
 * - Hidden neurons are assigned layers based on longest path from inputs
 * - Output neurons are always placed in the final layer
 * - Recurrent connections (back-edges) and self-loops are ignored
 */

import type { Creature } from "../Creature.ts";

/**
 * Compute layer assignments for all neurons in a creature.
 *
 * Uses a modified BFS/topological approach to compute the longest path from
 * any input neuron to each hidden neuron. Output neurons are forced into the
 * final layer regardless of their actual depth.
 *
 * @param creature The creature whose topology to analyse
 * @returns A map of layer number to neuron indices in that layer
 */
export function computeLayerAssignments(
  creature: Creature,
): Map<number, number[]> {
  const neuronCount = creature.neurons.length;
  const inputCount = creature.input;
  const outputStart = neuronCount - creature.output;

  // Depth of each neuron (longest path from any input).
  const depth = new Int32Array(neuronCount);
  // -1 means unvisited for non-input neurons.
  depth.fill(-1);

  // Input and constant neurons are layer 0.
  for (let i = 0; i < neuronCount; i++) {
    const neuron = creature.neurons[i];
    if (neuron.type === "input" || neuron.type === "constant") {
      depth[i] = 0;
    }
  }

  // Build adjacency list of forward edges (from → to[]).
  // Kahn's algorithm naturally ignores back-edges in recurrent topologies.
  const forwardEdges: number[][] = new Array(neuronCount);
  for (let i = 0; i < neuronCount; i++) {
    forwardEdges[i] = [];
  }

  // Compute in-degree for Kahn's algorithm (excluding self-loops and
  // edges from output neurons, which shouldn't feed forward).
  const inDegree = new Int32Array(neuronCount);

  for (const synapse of creature.synapses) {
    if (synapse.from === synapse.to) continue; // Ignore self-loops
    // Skip edges originating from output neurons (they don't feed forward)
    if (synapse.from >= outputStart) continue;

    forwardEdges[synapse.from].push(synapse.to);
    inDegree[synapse.to]++;
  }

  // Kahn's algorithm to process neurons in topological order.
  // This naturally handles cycles by leaving cycle neurons unprocessed.
  const queue: number[] = [];

  // Seed with all neurons that have zero in-degree (inputs, constants,
  // and any disconnected neurons).
  for (let i = 0; i < neuronCount; i++) {
    if (depth[i] === 0) {
      // Input/constant neurons — already seeded
      queue.push(i);
    } else if (inDegree[i] === 0 && i < outputStart) {
      // Disconnected hidden neuron with no incoming edges
      depth[i] = 1;
      queue.push(i);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const currentDepth = depth[idx];

    for (const toIdx of forwardEdges[idx]) {
      const newDepth = currentDepth + 1;
      if (newDepth > depth[toIdx]) {
        depth[toIdx] = newDepth;
      }

      inDegree[toIdx]--;
      if (inDegree[toIdx] <= 0) {
        queue.push(toIdx);
      }
    }
  }

  // Handle neurons that were in cycles (still have inDegree > 0).
  // For cycle neurons, assign depth based on the maximum depth of their
  // already-resolved incoming neighbours, plus one. This breaks the cycle
  // by only considering edges from neurons that Kahn's algorithm resolved.
  for (let i = 0; i < neuronCount; i++) {
    if (depth[i] >= 0) continue; // Already assigned
    if (i >= outputStart) continue; // Output neurons handled later

    let maxIncomingDepth = 0;
    const inward = creature.inwardConnections(i);
    for (const synapse of inward) {
      if (synapse.from === synapse.to) continue;
      if (depth[synapse.from] >= 0) {
        maxIncomingDepth = Math.max(maxIncomingDepth, depth[synapse.from]);
      }
    }
    depth[i] = maxIncomingDepth + 1;
  }

  // Any hidden neuron still at -1 is truly unreachable — assign layer 1
  for (let i = inputCount; i < outputStart; i++) {
    if (depth[i] < 0) {
      depth[i] = 1;
    }
  }

  // Find the maximum hidden neuron depth to place outputs one layer beyond.
  let maxHiddenDepth = 0;
  for (let i = inputCount; i < outputStart; i++) {
    if (depth[i] > maxHiddenDepth) {
      maxHiddenDepth = depth[i];
    }
  }

  // Output neurons are placed in the final layer.
  const outputLayer = maxHiddenDepth + 1;
  for (let i = outputStart; i < neuronCount; i++) {
    depth[i] = outputLayer;
  }

  // Build the layer map.
  const layers = new Map<number, number[]>();
  for (let i = 0; i < neuronCount; i++) {
    const layer = depth[i];
    const existing = layers.get(layer);
    if (existing) {
      existing.push(i);
    } else {
      layers.set(layer, [i]);
    }
  }

  return layers;
}
