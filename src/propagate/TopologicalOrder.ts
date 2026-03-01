/**
 * TopologicalOrder.ts - Compute reverse topological order for backpropagation.
 *
 * Issue #1641 - Pre-computes a reverse topological order of neurons so that
 * each neuron is visited exactly once during backpropagation, eliminating
 * the combinatorial explosion of revisits in the recursive traversal.
 *
 * Uses Kahn's algorithm on the forward connection graph. The reverse of
 * the topological order gives us output neurons first, input neurons last,
 * which is the correct processing order for backward propagation.
 *
 * Recurrent connections (cycles) are handled gracefully: neurons in cycles
 * are appended at the end of the order.
 */

import type { Creature } from "../Creature.ts";

/**
 * Compute reverse topological order of non-input neurons.
 *
 * Returns an array of neuron indices ordered so that output neurons appear
 * first and hidden neurons appear after all their downstream consumers.
 * Input and constant neurons are excluded since they don't participate in
 * backpropagation error distribution.
 *
 * For recurrent networks with cycles, neurons that remain in cycles after
 * the topological sort are appended at the end of the order.
 */
export function computeReverseTopologicalOrder(
  creature: Creature,
): number[] {
  const neuronCount = creature.neurons.length;
  const inputCount = creature.input;

  // Count outgoing forward edges for each non-input neuron.
  // In the reverse graph (for backprop ordering), these become incoming edges.
  const outDegree = new Int32Array(neuronCount);

  for (const synapse of creature.synapses) {
    if (synapse.from === synapse.to) continue; // Skip self-loops
    if (synapse.from >= inputCount) {
      outDegree[synapse.from]++;
    }
  }

  // Start with neurons that have no outgoing forward edges (typically output
  // neurons, but also any hidden neuron that feeds nothing).
  const queue: number[] = [];
  for (let i = inputCount; i < neuronCount; i++) {
    if (outDegree[i] === 0) {
      queue.push(i);
    }
  }

  const result: number[] = [];
  const visited = new Uint8Array(neuronCount);
  let head = 0;

  while (head < queue.length) {
    const idx = queue[head++];
    if (visited[idx]) continue;
    visited[idx] = 1;
    result.push(idx);

    // For each inward connection to this neuron, decrement the source's
    // out-degree. When a source's out-degree reaches zero, all its
    // downstream consumers have been processed and it can be enqueued.
    const inward = creature.inwardConnections(idx);
    for (let i = 0; i < inward.length; i++) {
      const synapse = inward[i];
      const from = synapse.from;
      if (from === synapse.to) continue; // Skip self-loops
      if (from < inputCount) continue; // Skip input neurons
      if (visited[from]) continue;

      outDegree[from]--;
      if (outDegree[from] <= 0) {
        queue.push(from);
      }
    }
  }

  // Handle remaining neurons in cycles (recurrent connections).
  for (let i = inputCount; i < neuronCount; i++) {
    if (!visited[i]) {
      result.push(i);
    }
  }

  return result;
}
