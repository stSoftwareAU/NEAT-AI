/**
 * NeuronId.ts — Runtime integer handles for in-memory graph and WASM paths.
 *
 * Issue #1958: Integer `id` avoids string hashing in hot loops. See AGENTS.md
 * ("Neuron identity: wire UUID vs runtime integer `id`"): stable lineage and
 * all public exports use wire UUIDs; use integers here only where benchmarks
 * justify the extra complexity.
 *
 * ID scheme:
 * - Input neurons: id = inputIndex (0, 1, 2, ...)
 * - Output neurons: id = -(outputIndex + 1) (-1, -2, -3, ...)
 * - Hidden/constant neurons: monotonically increasing from a global counter
 *   (from 1 000 000) to avoid collision with input ids
 */

/**
 * Global monotonically increasing counter for hidden/constant neuron IDs.
 * Starts at 1,000,000 to avoid collision with input neuron IDs (which use
 * their array index as their ID).
 */
let _nextId = 1_000_000;

/**
 * Generates the next unique integer ID for a hidden or constant neuron.
 *
 * @returns A unique positive integer ID
 */
export function nextNeuronId(): number {
  return _nextId++;
}

/**
 * Ensures the global counter is above the given ID.
 * Call this when loading neurons from serialised data to prevent
 * future ID collisions.
 *
 * @param id - The neuron ID that was loaded
 */
export function ensureIdAbove(id: number): void {
  if (id >= _nextId) {
    _nextId = id + 1;
  }
}

/**
 * Allocates an integer id for a new hidden or constant on the given creature.
 *
 * Chooses max(largest structural id on this graph, process counter) + 1, so
 * the new id is unique on the creature and stays consistent with
 * {@link nextNeuronId} for later inserts. Wire identity remains UUID-based;
 * this is only the in-memory handle (Issue #1958).
 */
export function allocateStructuralNeuronIdForCreature(creature: {
  neurons: readonly { id: number }[];
}): number {
  const MIN_HIDDEN = 1_000_000;
  let maxOnCreature = MIN_HIDDEN - 1;
  for (const n of creature.neurons) {
    if (n.id >= MIN_HIDDEN && n.id > maxOnCreature) {
      maxOnCreature = n.id;
    }
  }
  const fromCreature = Math.max(maxOnCreature + 1, MIN_HIDDEN);
  const id = Math.max(fromCreature, _nextId);
  _nextId = id + 1;
  return id;
}

/**
 * Resets the hidden-neuron ID counter to its initial value (1_000_000).
 *
 * Used by the test preload so parallel workers do not inherit a monotonic
 * counter advanced by other test files in the same isolate.
 */
export function resetHiddenNeuronIdCounterForTesting(): void {
  _nextId = 1_000_000;
}

/**
 * Returns the integer ID for an input neuron at the given index.
 *
 * @param inputIndex - The position of the input neuron (0-based)
 * @returns The input neuron's integer ID (same as its index)
 */
export function inputNeuronId(inputIndex: number): number {
  return inputIndex;
}

/**
 * Returns the integer ID for an output neuron at the given output index.
 *
 * @param outputIndex - The position of the output neuron (0-based)
 * @returns The output neuron's integer ID (negative: -1, -2, -3, ...)
 */
export function outputNeuronId(outputIndex: number): number {
  return -(outputIndex + 1);
}

/**
 * Checks whether the given neuron ID belongs to an output neuron.
 *
 * @param id - The neuron ID to check
 * @returns true if the ID represents an output neuron
 */
export function isOutputNeuronId(id: number): boolean {
  return id < 0;
}

/**
 * Extracts the output index from an output neuron ID.
 *
 * @param id - An output neuron ID (must be negative)
 * @returns The output index (0-based)
 */
export function outputIndexFromId(id: number): number {
  return -(id + 1);
}
