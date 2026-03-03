/**
 * CompactSynapseStore.ts - Struct-of-arrays synapse storage (Issue #1662)
 *
 * Stores synapses as parallel typed arrays instead of an array of objects.
 * Enables cache-friendly sequential access for hot paths like backprop
 * weight reads and topology queries.
 *
 * The store maintains synapses sorted by (from, to) to match the existing
 * sort order of `creature.synapses`.
 */

/**
 * Struct-of-arrays synapse storage using parallel typed arrays.
 *
 * Each synapse occupies the same index across all three arrays.
 * The arrays may be larger than `count` to allow growth without reallocation.
 */
export class CompactSynapseStore {
  /** Source neuron indices */
  synapseFrom: Int32Array;
  /** Destination neuron indices */
  synapseTo: Int32Array;
  /** Connection weights */
  synapseWeight: Float64Array;
  /** Actual number of synapses (arrays may be larger) */
  count: number;

  constructor(capacity: number) {
    this.synapseFrom = new Int32Array(capacity);
    this.synapseTo = new Int32Array(capacity);
    this.synapseWeight = new Float64Array(capacity);
    this.count = 0;
  }

  /**
   * Populate from parallel arrays of from/to/weight values.
   * Assumes values are already sorted by (from, to).
   */
  static fromArrays(
    fromArr: number[],
    toArr: number[],
    weightArr: number[],
  ): CompactSynapseStore {
    const len = fromArr.length;
    const store = new CompactSynapseStore(len);
    store.count = len;
    for (let i = 0; i < len; i++) {
      store.synapseFrom[i] = fromArr[i];
      store.synapseTo[i] = toArr[i];
      store.synapseWeight[i] = weightArr[i];
    }
    return store;
  }

  /** Get the source neuron index for synapse at position i */
  getFrom(i: number): number {
    return this.synapseFrom[i];
  }

  /** Get the destination neuron index for synapse at position i */
  getTo(i: number): number {
    return this.synapseTo[i];
  }

  /** Get the weight for synapse at position i */
  getWeight(i: number): number {
    return this.synapseWeight[i];
  }

  /** Set the weight for synapse at position i */
  setWeight(i: number, weight: number): void {
    this.synapseWeight[i] = weight;
  }

  /**
   * Binary search for the first synapse with matching `from` index.
   * Returns -1 if not found.
   */
  binarySearchFrom(fromIndx: number): number {
    let low = 0;
    let high = this.count - 1;
    let result = -1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const midFrom = this.synapseFrom[mid];

      if (midFrom < fromIndx) {
        low = mid + 1;
      } else if (midFrom > fromIndx) {
        high = mid - 1;
      } else {
        result = mid;
        high = mid - 1;
      }
    }

    return result;
  }

  /**
   * Binary search for a synapse by (from, to) pair.
   * Returns the index or -1 if not found.
   */
  binarySearchFromTo(from: number, to: number): number {
    let low = 0;
    let high = this.count - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const midFrom = this.synapseFrom[mid];

      if (midFrom < from) {
        low = mid + 1;
      } else if (midFrom > from) {
        high = mid - 1;
      } else {
        const midTo = this.synapseTo[mid];
        if (midTo < to) {
          low = mid + 1;
        } else if (midTo > to) {
          high = mid - 1;
        } else {
          return mid;
        }
      }
    }

    return -1;
  }

  /**
   * Collect all synapse indices with matching `to` value.
   * Uses a linear scan (the store is sorted by `from`, not `to`).
   */
  findByTo(toIndx: number): number[] {
    const results: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.synapseTo[i] === toIndx) {
        results.push(i);
      }
    }
    return results;
  }

  /**
   * Collect all synapse indices with matching `from` value.
   * Uses binary search to find start, then linear scan forward.
   */
  findByFrom(fromIndx: number): number[] {
    const start = this.binarySearchFrom(fromIndx);
    if (start === -1) return [];

    const results: number[] = [];
    for (let i = start; i < this.count; i++) {
      if (this.synapseFrom[i] === fromIndx) {
        results.push(i);
      } else {
        break;
      }
    }
    return results;
  }

  /**
   * Sequential read of all weights (simulates backprop weight scan).
   */
  sumWeights(): number {
    let sum = 0;
    const w = this.synapseWeight;
    for (let i = 0; i < this.count; i++) {
      sum += w[i];
    }
    return sum;
  }
}
