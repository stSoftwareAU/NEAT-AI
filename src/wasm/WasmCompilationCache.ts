/**
 * WASM Compilation Cache
 *
 * Issue #1301 - Performance: WASM creature compilation caching
 * Issue #1539 - Perf: O(1) LRU eviction and buffer pooling
 *
 * Caches compiled binary templates for creatures with identical topologies,
 * avoiding redundant buffer allocation and structure building for structurally
 * similar creatures.
 *
 * Key features:
 * - Topology-based caching of binary templates (ignores weights and biases)
 * - O(1) LRU eviction via doubly-linked list + Map (#1539)
 * - Buffer pooling to avoid .slice() on every cache hit (#1539)
 * - Cache invalidation on structural mutations
 * - Statistics tracking for cache hit/miss rates
 *
 * Architecture note:
 * The WASM binary format includes weights/biases inline, so we cannot directly
 * share compiled modules across creatures with different weights. However, we
 * cache the buffer template structure (size, offsets) and reuse it to avoid
 * redundant structure analysis for creatures with the same topology.
 */

import type { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { getSquashType } from "@wasm/SquashType.ts";
import type { CompiledCreatureData } from "@wasm/CompileToWasm.ts";
import { WasmCreatureActivation } from "@wasm/WasmActivation.ts";
import { isWasmActivationAvailable } from "@wasm/WasmModuleLoader.ts";

/**
 * Synapse type enum for WASM - must match Rust SynapseType
 */
enum SynapseTypeCode {
  Standard = 0,
  Condition = 1,
  Negative = 2,
  Positive = 3,
}

/**
 * Map synapse type string to SynapseTypeCode
 */
function getSynapseTypeCode(
  synapseType: "positive" | "negative" | "condition" | undefined,
): SynapseTypeCode {
  switch (synapseType) {
    case "condition":
      return SynapseTypeCode.Condition;
    case "negative":
      return SynapseTypeCode.Negative;
    case "positive":
      return SynapseTypeCode.Positive;
    default:
      return SynapseTypeCode.Standard;
  }
}

/**
 * Information about where weights and biases are located in the binary buffer.
 * Used to quickly update weights without rebuilding the entire structure.
 */
interface NeuronInfo {
  /** Offset of the bias value in the binary buffer */
  biasOffset: number;
  /** Offsets of synapse weights in the binary buffer (in sorted order) */
  weightOffsets: number[];
}

/**
 * Cached topology template for fast compilation.
 * Contains all structural information needed to build the binary, except weights.
 */
interface TopologyTemplate {
  /** Total size of the binary buffer */
  bufferSize: number;
  /** Number of neurons */
  numNeurons: number;
  /** Number of input neurons */
  numInputs: number;
  /** Number of output neurons */
  numOutputs: number;
  /** Total number of synapses */
  numSynapses: number;
  /** Per-neuron structural information */
  neurons: NeuronInfo[];
  /** Pre-built buffer with structural data (squash types, from indices, etc.) */
  templateBuffer: Uint8Array;
  /** Pool of reusable work buffers for this topology (#1539) */
  bufferPool: Uint8Array[];
}

/**
 * Maximum number of pooled work buffers per topology entry.
 * Keeps memory bounded while still reducing allocations.
 */
const MAX_POOLED_BUFFERS = 4;

/**
 * A node in the doubly-linked LRU list.
 * Issue #1539: Enables O(1) eviction instead of O(n) linear scan.
 */
interface LruNode {
  readonly key: string;
  template: TopologyTemplate;
  prev: LruNode | null;
  next: LruNode | null;
}

/**
 * Statistics for cache performance monitoring.
 */
export interface WasmCacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Current number of entries in the cache */
  size: number;
  /** Total number of evictions */
  evictions: number;
  /** Total bytes of cached template data */
  totalBytes: number;
}

/**
 * Default maximum number of entries in the cache.
 * Chosen to balance memory usage with hit rate for typical populations.
 */
const DEFAULT_MAX_CACHE_SIZE = 100;

/**
 * The WASM compilation cache singleton.
 *
 * Issue #1539: Uses a doubly-linked list + Map for O(1) LRU eviction,
 * and per-topology buffer pools to avoid .slice() allocations on cache hits.
 */
class WasmCompilationCacheImpl {
  /** Map from topology hash to LRU node for O(1) lookup */
  private nodeByKey: Map<string, LruNode> = new Map();

  /** Head of doubly-linked list (most recently used) */
  private head: LruNode | null = null;

  /** Tail of doubly-linked list (least recently used) */
  private tail: LruNode | null = null;

  /** Maximum number of entries in the cache */
  private maxSize: number = DEFAULT_MAX_CACHE_SIZE;

  /** Statistics for monitoring cache performance */
  private stats: WasmCacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
    evictions: 0,
    totalBytes: 0,
  };

  /** Remove a node from the doubly-linked list (O(1)). */
  private removeNode(node: LruNode): void {
    const prev = node.prev;
    const next = node.next;

    if (prev) {
      prev.next = next;
    } else {
      this.head = next;
    }

    if (next) {
      next.prev = prev;
    } else {
      this.tail = prev;
    }

    node.prev = null;
    node.next = null;
  }

  /** Move/insert a node to the head of the list (most recently used). */
  private moveToHead(node: LruNode): void {
    if (this.head === node) return;

    // Unlink from current position if already in the list.
    if (node.prev || node.next || this.tail === node) {
      this.removeNode(node);
    }

    // Insert at head.
    node.next = this.head;
    node.prev = null;
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  /** Evict the tail (least recently used) entry. O(1). */
  private evictTail(): void {
    if (!this.tail) return;

    const node = this.tail;
    this.removeNode(node);
    this.nodeByKey.delete(node.key);
    this.stats.totalBytes -= node.template.templateBuffer.length;
    this.stats.evictions++;
    this.stats.size = this.nodeByKey.size;
  }

  /**
   * Acquire a work buffer from the topology's pool, or copy the template.
   * Issue #1539: Avoids .slice() allocation when a pooled buffer is available.
   */
  private acquireBuffer(template: TopologyTemplate): Uint8Array {
    const pooled = template.bufferPool.pop();
    if (pooled) {
      // Copy structural data from template into the reusable buffer.
      pooled.set(template.templateBuffer);
      return pooled;
    }
    // No pooled buffer available — fall back to a fresh copy.
    return template.templateBuffer.slice();
  }

  /**
   * Return a work buffer to the topology's pool for reuse.
   * Issue #1539: The buffer will be reused by a future compileFromTemplate call.
   */
  returnBuffer(template: TopologyTemplate, buffer: Uint8Array): void {
    if (
      buffer.length === template.templateBuffer.length &&
      template.bufferPool.length < MAX_POOLED_BUFFERS
    ) {
      template.bufferPool.push(buffer);
    }
  }

  /**
   * Get or compile a WASM module for the given creature.
   *
   * If a template for the creature's topology exists in the cache, it will be
   * used to quickly build the binary with the creature's weights. Otherwise,
   * a new template will be built and cached.
   *
   * @param creature - The creature to compile or retrieve from cache
   * @returns The WASM activation wrapper, or null if compilation failed
   */
  getOrCompile(creature: Creature): WasmCreatureActivation | null {
    if (!isWasmActivationAvailable()) {
      return null;
    }

    // Get the topology hash for the creature
    const topologyHash = CreatureUtil.getTopologyHash(creature);

    // Check if we have a cached template
    const node = this.nodeByKey.get(topologyHash);
    if (node) {
      // Move to head (most recently used) — O(1)
      this.moveToHead(node);
      this.stats.hits++;

      // Use cached template to quickly compile with creature's weights
      const compiled = this.compileFromTemplate(creature, node.template);
      return WasmCreatureActivation.create(compiled);
    }

    // Cache miss - build template and compile
    this.stats.misses++;
    const template = this.buildTemplate(creature);

    // Evict entries if cache is full — O(1) per eviction
    while (this.nodeByKey.size >= this.maxSize) {
      this.evictTail();
    }

    // Add template to cache as new head node
    const newNode: LruNode = {
      key: topologyHash,
      template,
      prev: null,
      next: null,
    };
    this.nodeByKey.set(topologyHash, newNode);
    this.moveToHead(newNode);
    this.stats.size = this.nodeByKey.size;
    this.stats.totalBytes += template.templateBuffer.length;

    // Compile with creature's weights
    const compiled = this.compileFromTemplate(creature, template);
    return WasmCreatureActivation.create(compiled);
  }

  /**
   * Build a topology template from a creature.
   * This captures all structural information needed for compilation.
   */
  private buildTemplate(creature: Creature): TopologyTemplate {
    const numNeurons = creature.neurons.length;
    const numInputs = creature.input;
    const numOutputs = creature.output;

    // Calculate total size needed
    let totalSynapses = 0;
    for (let i = numInputs; i < numNeurons; i++) {
      const inwardList = creature.inwardConnections(i);
      totalSynapses += inwardList.length;
    }

    const headerSize = 8;
    const neuronsSize = (numNeurons - numInputs) * 12;
    const synapsesSize = totalSynapses * 12;
    const bufferSize = headerSize + neuronsSize + synapsesSize;

    // Create template buffer with structural data
    const templateBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(templateBuffer);
    const neurons: NeuronInfo[] = [];

    let offset = 0;

    // Write header
    view.setUint32(offset, numNeurons, true);
    offset += 4;
    view.setUint32(offset, numInputs, true);
    offset += 4;

    // Write each non-input neuron's structural data
    for (let i = numInputs; i < numNeurons; i++) {
      const neuron = creature.neurons[i];
      // Issue #1536: inwardConnections() returns results sorted by `from`,
      // so no .slice().sort() is needed.
      const inwardList = creature.inwardConnections(i);

      const neuronInfo: NeuronInfo = {
        biasOffset: offset,
        weightOffsets: [],
      };

      // Bias placeholder (will be filled in compileFromTemplate)
      view.setFloat64(offset, 0, true);
      offset += 8;

      // Write squash type
      const squashType = getSquashType(neuron.squash);
      view.setUint8(offset, squashType);
      offset += 1;

      // Write is_constant
      const isConstant = neuron.type === "constant" ? 1 : 0;
      view.setUint8(offset, isConstant);
      offset += 1;

      // Write num_synapses
      view.setUint16(offset, inwardList.length, true);
      offset += 2;

      // Write each synapse's structural data
      for (const synapse of inwardList) {
        // Write from_index
        view.setUint16(offset, synapse.from, true);
        offset += 2;

        // Write synapse_type
        const synapseTypeCode = getSynapseTypeCode(synapse.type);
        view.setUint8(offset, synapseTypeCode);
        offset += 1;

        // Write padding
        view.setUint8(offset, 0);
        offset += 1;

        // Weight placeholder (will be filled in compileFromTemplate)
        neuronInfo.weightOffsets.push(offset);
        view.setFloat64(offset, 0, true);
        offset += 8;
      }

      neurons.push(neuronInfo);
    }

    return {
      bufferSize,
      numNeurons,
      numInputs,
      numOutputs,
      numSynapses: totalSynapses,
      neurons,
      templateBuffer: new Uint8Array(templateBuffer),
      bufferPool: [],
    };
  }

  /**
   * Compile a creature using a cached template.
   * Issue #1539: Uses buffer pooling instead of .slice() on every call.
   */
  private compileFromTemplate(
    creature: Creature,
    template: TopologyTemplate,
  ): CompiledCreatureData {
    // Acquire a work buffer (pooled or fresh copy)
    const buffer = this.acquireBuffer(template);
    const view = new DataView(buffer.buffer);

    const numInputs = template.numInputs;

    // Update weights and biases for each neuron
    for (let i = 0; i < template.neurons.length; i++) {
      const neuronInfo = template.neurons[i];
      const neuronIdx = numInputs + i;
      const neuron = creature.neurons[neuronIdx];

      // Update bias
      view.setFloat64(neuronInfo.biasOffset, neuron.bias ?? 0, true);

      // Issue #1536: inwardConnections() returns results sorted by `from`,
      // so no .slice().sort() is needed.
      const inwardList = creature.inwardConnections(neuronIdx);

      for (let j = 0; j < inwardList.length; j++) {
        const weightOffset = neuronInfo.weightOffsets[j];
        view.setFloat64(weightOffset, inwardList[j].weight, true);
      }
    }

    return {
      data: buffer,
      numNeurons: template.numNeurons,
      numInputs: template.numInputs,
      numOutputs: template.numOutputs,
      numSynapses: template.numSynapses,
    };
  }

  /**
   * Invalidate the cache entry for a specific creature.
   *
   * Call this when a creature's topology changes (structural mutation).
   *
   * @param creature - The creature whose cache entry should be invalidated
   */
  invalidate(creature: Creature): void {
    // If the creature has a cached topology hash, use it
    const topologyHash = creature.topologyHash;
    if (topologyHash) {
      const node = this.nodeByKey.get(topologyHash);
      if (node) {
        this.stats.totalBytes -= node.template.templateBuffer.length;
        this.removeNode(node);
        this.nodeByKey.delete(topologyHash);
        this.stats.size = this.nodeByKey.size;
      }
      // Clear the creature's cached topology hash
      creature.topologyHash = undefined;
    }
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.nodeByKey.clear();
    this.head = null;
    this.tail = null;
    this.stats = {
      hits: 0,
      misses: 0,
      size: 0,
      evictions: 0,
      totalBytes: 0,
    };
  }

  /**
   * Get cache statistics.
   */
  getStats(): WasmCacheStats {
    return { ...this.stats };
  }

  /**
   * Set the maximum cache size.
   *
   * @param size - The new maximum cache size
   * @returns The previous maximum cache size
   */
  setMaxSize(size: number): number {
    const previous = this.maxSize;
    this.maxSize = Math.max(1, size);

    // Evict entries if current cache exceeds new max size
    while (this.nodeByKey.size > this.maxSize) {
      this.evictTail();
    }

    return previous;
  }

  /**
   * Get the current maximum cache size.
   */
  getMaxSize(): number {
    return this.maxSize;
  }
}

/**
 * Singleton instance of the WASM compilation cache.
 */
const wasmCompilationCache = new WasmCompilationCacheImpl();

/**
 * Get or compile a WASM module for the given creature.
 *
 * If a module for the creature's topology already exists in the cache,
 * a new activation with the creature's weights will be created using
 * the cached compilation. Otherwise, the creature will be compiled
 * and the result cached.
 *
 * @param creature - The creature to compile or retrieve from cache
 * @returns The WASM activation wrapper, or null if compilation failed
 */
export function getOrCompileWasmModule(
  creature: Creature,
): WasmCreatureActivation | null {
  return wasmCompilationCache.getOrCompile(creature);
}

/**
 * Invalidate the cache entry for a specific creature.
 *
 * Call this when a creature's topology changes (structural mutation).
 *
 * @param creature - The creature whose cache entry should be invalidated
 */
export function invalidateWasmCache(creature: Creature): void {
  wasmCompilationCache.invalidate(creature);
}

/**
 * Clear the entire WASM compilation cache.
 */
export function clearWasmCompilationCache(): void {
  wasmCompilationCache.clear();
}

/**
 * Get cache statistics.
 */
export function getWasmCompilationCacheStats(): WasmCacheStats {
  return wasmCompilationCache.getStats();
}

/**
 * Set the maximum cache size.
 *
 * @param size - The new maximum cache size
 * @returns The previous maximum cache size
 */
export function setWasmCompilationCacheSize(size: number): number {
  return wasmCompilationCache.setMaxSize(size);
}

/**
 * Get the current maximum cache size.
 */
export function getWasmCompilationCacheMaxSize(): number {
  return wasmCompilationCache.getMaxSize();
}
