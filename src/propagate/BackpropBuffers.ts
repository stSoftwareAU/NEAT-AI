/**
 * Issue #1379 - Pre-allocated reusable buffers for backward pass.
 *
 * The backward pass in Neuron.propagate() allocates 8 temporary arrays per
 * neuron per training sample. For a network with 800 neurons this creates
 * ~6400 short-lived arrays per sample, putting pressure on the GC.
 *
 * This class provides a stack-based pool of buffer sets that are reused across
 * neurons. Because propagate() is recursive (neuron A's propagate calls
 * neuron B's propagate), multiple buffer sets may be active simultaneously.
 * The stack grows on demand to accommodate the recursion depth.
 */

/** A single set of scratch buffers for one propagate() invocation. */
export interface BackpropBufferSet {
  /** Cached upstream activations (JS number array for mixed reads). */
  fromActivationCache: number[];
  /** Cached synapse weights. */
  fromWeightCache: number[];
  /** Cached weight * activation products. */
  fromValueCache: number[];
  /** Safe zone factors extracted from fused WASM result. */
  safeZoneFactorCache: number[];
  /** Upstream squash type indices for WASM. */
  fusedSquashTypes: Uint8Array;
  /** Upstream pre-squash hint values for WASM. */
  fusedHintValues: Float32Array;
  /** Upstream activations for WASM. */
  fusedActivations: Float32Array;
  /** Synapse weights for WASM. */
  fusedWeights: Float32Array;
  /** Current allocated capacity. */
  capacity: number;
}

/**
 * Stack-based pool of reusable backward pass buffer sets.
 *
 * Usage:
 *   const buf = buffers.acquire(listLength);
 *   // ... use buf.fromActivationCache[0..listLength-1] etc. ...
 *   buffers.release(buf);
 *
 * Buffers are not zeroed on acquire — callers must write before reading,
 * which is already the case in the existing propagate() code.
 */
export class BackpropBuffers {
  private pool: BackpropBufferSet[] = [];

  /**
   * @param initialCapacity - Initial buffer capacity (typically the maximum
   *   inward connection count across all neurons in the creature).
   */
  constructor(private initialCapacity: number = 0) {}

  /**
   * Acquire a buffer set with at least `minLength` capacity.
   * If the pool has a suitable set it is reused; otherwise a new one is
   * allocated (or an existing one is grown).
   */
  acquire(minLength: number): BackpropBufferSet {
    const buf = this.pool.pop();
    if (buf !== undefined) {
      if (buf.capacity >= minLength) {
        return buf;
      }
      // Grow the existing set to accommodate the larger length.
      return this.grow(buf, minLength);
    }
    // No pooled buffer — allocate a fresh set.
    const cap = Math.max(minLength, this.initialCapacity);
    return this.allocate(cap);
  }

  /** Return a buffer set to the pool for reuse. */
  release(buf: BackpropBufferSet): void {
    this.pool.push(buf);
  }

  private allocate(capacity: number): BackpropBufferSet {
    return {
      fromActivationCache: new Array<number>(capacity),
      fromWeightCache: new Array<number>(capacity),
      fromValueCache: new Array<number>(capacity),
      safeZoneFactorCache: new Array<number>(capacity),
      fusedSquashTypes: new Uint8Array(capacity),
      fusedHintValues: new Float32Array(capacity),
      fusedActivations: new Float32Array(capacity),
      fusedWeights: new Float32Array(capacity),
      capacity,
    };
  }

  private grow(buf: BackpropBufferSet, newCapacity: number): BackpropBufferSet {
    buf.fromActivationCache = new Array<number>(newCapacity);
    buf.fromWeightCache = new Array<number>(newCapacity);
    buf.fromValueCache = new Array<number>(newCapacity);
    buf.safeZoneFactorCache = new Array<number>(newCapacity);
    buf.fusedSquashTypes = new Uint8Array(newCapacity);
    buf.fusedHintValues = new Float32Array(newCapacity);
    buf.fusedActivations = new Float32Array(newCapacity);
    buf.fusedWeights = new Float32Array(newCapacity);
    buf.capacity = newCapacity;
    return buf;
  }
}
