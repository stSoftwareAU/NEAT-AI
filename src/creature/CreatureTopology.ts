/**
 * CreatureTopology.ts - Neuron/synapse management and connection queries.
 *
 * Extracted from Creature.ts (Issue #1409) to keep the Creature class
 * under 500 lines and each module focused on a single responsibility.
 */

import type { Creature } from "../Creature.ts";
import type { Synapse } from "../architecture/Synapse.ts";

/**
 * Internal state for topology caches and indices.
 * Stored on the Creature instance and passed to topology functions.
 */
export interface TopologyCaches {
  cacheTo: Map<number, Synapse[]>;
  cacheFrom: Map<number, Synapse[]>;
  cacheSelf: Map<number, Synapse[]>;
  synapsesIndexedByTo: Synapse[] | null;
  connectionSet: Set<string> | null;
  availableConnectionsCache: [number, number][] | null;
  hiddenNeuronUUIDs: Set<string> | null;
  inwardCacheMissCount: number;
}

/**
 * Threshold for switching from linear scan to building the secondary index.
 * Issue #1010: Performance optimisation for large creatures.
 */
export const INWARD_INDEX_BUILD_THRESHOLD = 3;

/**
 * Minimum number of synapses to trigger proactive index prebuilding.
 * Issue #1097: Performance - Prebuild inward synapse index after breed/mutation batch.
 */
export const PREBUILD_SYNAPSE_THRESHOLD = 1000;

/**
 * Get a self-connection for the neuron at the given index.
 */
export function selfConnection(
  creature: Creature,
  caches: TopologyCaches,
  indx: number,
): Synapse | null {
  let results = caches.cacheSelf.get(indx);
  if (results === undefined) {
    results = [];
    const tmpList = creature.synapses;
    for (let i = tmpList.length; i--;) {
      const c = tmpList[i];
      if (c.to === indx && c.from === indx) {
        results.push(c);
      }
    }
    caches.cacheSelf.set(indx, results);
  }
  return results.length > 0 ? results[0] : null;
}

/**
 * Get the inward connections (afferent) for the neuron at the given index.
 * Uses a secondary index sorted by `to` field for O(log n) binary search lookup.
 * Issue #1010: Performance optimisation for large creatures.
 */
export function inwardConnections(
  creature: Creature,
  caches: TopologyCaches,
  toIndx: number,
): Synapse[] {
  let results = caches.cacheTo.get(toIndx);
  if (results === undefined) {
    results = lookupInwardConnections(creature, caches, toIndx);
    caches.cacheTo.set(toIndx, results);
  }
  return results;
}

/**
 * Builds the secondary index of synapses sorted by `to` field.
 * Issue #1010: Performance optimisation for large creatures.
 */
function buildSynapsesIndexedByTo(creature: Creature): Synapse[] {
  return creature.synapses.slice().sort((a, b) => {
    if (a.to !== b.to) return a.to - b.to;
    return a.from - b.from;
  });
}

/**
 * Binary search for the start index in the secondary (to-sorted) index.
 * Issue #1010: Performance optimisation for large creatures.
 */
function binarySearchForToStartIndex(
  index: Synapse[],
  toIndx: number,
): number {
  let low = 0;
  let high = index.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midValue = index[mid];

    if (midValue.to < toIndx) {
      low = mid + 1;
    } else if (midValue.to > toIndx) {
      high = mid - 1;
    } else {
      result = mid;
      high = mid - 1;
    }
  }

  return result;
}

/**
 * Looks up inward connections using binary search on the secondary index.
 * Falls back to linear scan if index is not built.
 * Automatically builds the index after a few cache misses.
 * Issue #1010: Performance optimisation for large creatures.
 */
function lookupInwardConnections(
  creature: Creature,
  caches: TopologyCaches,
  toIndx: number,
): Synapse[] {
  if (caches.synapsesIndexedByTo !== null) {
    const index = caches.synapsesIndexedByTo;
    const startIndex = binarySearchForToStartIndex(index, toIndx);

    if (startIndex === -1) return [];

    const results: Synapse[] = [];
    for (let i = startIndex; i < index.length; i++) {
      const synapse = index[i];
      if (synapse.to === toIndx) {
        results.push(synapse);
      } else {
        break;
      }
    }
    return results;
  }

  caches.inwardCacheMissCount++;
  if (caches.inwardCacheMissCount >= INWARD_INDEX_BUILD_THRESHOLD) {
    caches.synapsesIndexedByTo = buildSynapsesIndexedByTo(creature);
    return lookupInwardConnections(creature, caches, toIndx);
  }

  const results: Synapse[] = [];
  for (let i = 0, len = creature.synapses.length; i < len; i++) {
    const synapse = creature.synapses[i];
    if (synapse.to === toIndx) {
      results.push(synapse);
    }
  }
  return results;
}

/**
 * Pre-builds the secondary index for inward connections.
 * Issue #1010: Performance optimisation for large creatures.
 */
export function prebuildInwardIndex(
  creature: Creature,
  caches: TopologyCaches,
): void {
  if (caches.synapsesIndexedByTo === null) {
    caches.synapsesIndexedByTo = buildSynapsesIndexedByTo(creature);
  }
}

/** Checks if the inward synapse index has been built. */
export function isInwardIndexBuilt(caches: TopologyCaches): boolean {
  return caches.synapsesIndexedByTo !== null;
}

/**
 * Conditionally prebuilds the inward index for large creatures.
 * Issue #1097: Performance - Prebuild inward synapse index after breed/mutation batch.
 */
export function prebuildInwardIndexIfLarge(
  creature: Creature,
  caches: TopologyCaches,
): void {
  if (creature.synapses.length >= PREBUILD_SYNAPSE_THRESHOLD) {
    prebuildInwardIndex(creature, caches);
  }
}

/**
 * Bulk loads all inward connections into the cache.
 * Issue #1010: Performance optimisation for large creatures.
 */
export function bulkLoadInwardConnections(
  creature: Creature,
  caches: TopologyCaches,
): void {
  if (caches.synapsesIndexedByTo === null) {
    caches.synapsesIndexedByTo = buildSynapsesIndexedByTo(creature);
  }

  const cacheTo = caches.cacheTo;
  for (let indx = 0, len = creature.neurons.length; indx < len; indx++) {
    if (!cacheTo.has(indx)) {
      cacheTo.set(indx, []);
    }
  }

  const index = caches.synapsesIndexedByTo;
  for (let i = 0, len = index.length; i < len; i++) {
    const synapse = index[i];
    const to = synapse.to;
    const tmpResults = cacheTo.get(to);
    if (tmpResults) {
      tmpResults.push(synapse);
    }
  }
}

/**
 * Builds and returns a Set of existing connections as "from-to" strings.
 * Enables O(1) lookup for connection existence checks.
 * Issue #1036: Performance optimisation for ADD_CONNECTION mutation.
 */
export function getConnectionSet(
  creature: Creature,
  caches: TopologyCaches,
): Set<string> {
  if (caches.connectionSet === null) {
    caches.connectionSet = new Set<string>();
    for (let i = 0, len = creature.synapses.length; i < len; i++) {
      const synapse = creature.synapses[i];
      caches.connectionSet.add(`${synapse.from}-${synapse.to}`);
    }
  }
  return caches.connectionSet;
}

/**
 * Checks if a connection exists between two neurons in O(1) time.
 * Issue #1036: Performance optimisation for ADD_CONNECTION mutation.
 */
export function hasConnection(
  creature: Creature,
  caches: TopologyCaches,
  from: number,
  to: number,
): boolean {
  return getConnectionSet(creature, caches).has(`${from}-${to}`);
}

/**
 * Builds and returns a cached Set of hidden neuron UUIDs.
 * Enables O(1) lookup for genetic compatibility checks.
 * Issue #1032: Performance optimisation for genetic compatibility checks.
 */
export function getHiddenNeuronUUIDs(
  creature: Creature,
  caches: TopologyCaches,
): Set<string> {
  if (caches.hiddenNeuronUUIDs === null) {
    caches.hiddenNeuronUUIDs = new Set<string>();
    for (let i = creature.input, len = creature.neurons.length; i < len; i++) {
      const neuron = creature.neurons[i];
      if (neuron.type === "hidden") {
        caches.hiddenNeuronUUIDs.add(neuron.uuid);
      }
    }
  }
  return caches.hiddenNeuronUUIDs;
}

/**
 * Returns a list of available forward-only connection slots (from, to pairs).
 * Issue #1036, #1098: Performance optimisation for ADD_CONNECTION mutation.
 */
export function getAvailableConnections(
  creature: Creature,
  caches: TopologyCaches,
  focusList?: number[],
  inFocusFn?: (index: number, focusList?: number[]) => boolean,
): [number, number][] {
  if (caches.availableConnectionsCache === null) {
    caches.availableConnectionsCache = computeAvailableConnections(
      creature,
      caches,
    );
  }

  if (!focusList || focusList.length === 0) {
    return caches.availableConnectionsCache;
  }

  return caches.availableConnectionsCache.filter(([from, to]) => {
    return (inFocusFn?.(from, focusList) ?? true) ||
      (inFocusFn?.(to, focusList) ?? true);
  });
}

/**
 * Computes all available forward-only connection slots.
 * Issue #1098: Extracted to support caching.
 */
function computeAvailableConnections(
  creature: Creature,
  caches: TopologyCaches,
): [number, number][] {
  const connSet = getConnectionSet(creature, caches);
  const available: [number, number][] = [];
  const neurons = creature.neurons;
  const neuronCount = neurons.length;
  const inputCount = creature.input;

  for (let fromIndx = 0; fromIndx < neuronCount; fromIndx++) {
    const startTo = Math.max(fromIndx + 1, inputCount);
    for (let toIndx = startTo; toIndx < neuronCount; toIndx++) {
      const neuronTo = neurons[toIndx];
      if (neuronTo.type === "constant") continue;
      const key = `${fromIndx}-${toIndx}`;
      if (!connSet.has(key)) {
        available.push([fromIndx, toIndx]);
      }
    }
  }
  return available;
}

/** Checks if the available connections cache has been built. */
export function isAvailableConnectionsCacheBuilt(
  caches: TopologyCaches,
): boolean {
  return caches.availableConnectionsCache !== null;
}

/**
 * Get the outward connections (efferent) for the neuron at the given index.
 */
export function outwardConnections(
  creature: Creature,
  caches: TopologyCaches,
  fromIndx: number,
): Synapse[] {
  let results = caches.cacheFrom.get(fromIndx);
  if (results === undefined) {
    const startIndex = binarySearchForStartIndex(creature, fromIndx);

    if (startIndex !== -1) {
      results = [];
      for (let i = startIndex; i < creature.synapses.length; i++) {
        const tmp = creature.synapses[i];
        if (tmp.from === fromIndx) {
          results.push(tmp);
        } else {
          break;
        }
      }
    } else {
      results = [];
    }

    caches.cacheFrom.set(fromIndx, results);
  }
  return results;
}

/**
 * Binary search for the first synapse with matching 'from' index.
 */
function binarySearchForStartIndex(
  creature: Creature,
  fromIndx: number,
): number {
  let low = 0;
  let high = creature.synapses.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midValue = creature.synapses[mid];

    if (midValue.from < fromIndx) {
      low = mid + 1;
    } else if (midValue.from > fromIndx) {
      high = mid - 1;
    } else {
      result = mid;
      high = mid - 1;
    }
  }

  return result;
}

/**
 * Get a specific synapse between two neurons.
 */
export function getSynapse(
  creature: Creature,
  caches: TopologyCaches,
  from: number,
  to: number,
): Synapse | null {
  const outward = outwardConnections(creature, caches, from);

  for (let indx = outward.length; indx--;) {
    const c = outward[indx];
    if (c.to === to) {
      return c;
    } else if (c.to < to) {
      break;
    }
  }

  return null;
}

/**
 * Binary search for a synapse by (from, to) indices.
 * Synapses are sorted first by `from`, then by `to` within the same `from`.
 * Issue #1101: Performance optimisation for disconnect operations.
 */
export function binarySearchSynapse(
  creature: Creature,
  from: number,
  to: number,
): number {
  const synapses = creature.synapses;
  let low = 0;
  let high = synapses.length - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const syn = synapses[mid];

    if (syn.from < from) {
      low = mid + 1;
    } else if (syn.from > from) {
      high = mid - 1;
    } else {
      if (syn.to < to) {
        low = mid + 1;
      } else if (syn.to > to) {
        high = mid - 1;
      } else {
        return mid;
      }
    }
  }

  return -1;
}

/**
 * Find the insertion point for a synapse to maintain sorted order.
 * Uses binary search for O(log n) efficiency.
 * Issue #1102: Helper method for connectBatch.
 */
export function findInsertionPoint(
  creature: Creature,
  from: number,
  to: number,
): number {
  const synapses = creature.synapses;
  let low = 0;
  let high = synapses.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    const syn = synapses[mid];

    if (syn.from < from || (syn.from === from && syn.to < to)) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * Check if a neuron is in focus.
 */
export function inFocus(
  creature: Creature,
  caches: TopologyCaches,
  cacheFocus: Map<number, boolean>,
  cacheFocusList: number[] | undefined,
  index: number,
  focusList?: number[],
  checked: Set<number> = new Set(),
): { result: boolean; updatedCacheFocusList: number[] | undefined } {
  if (!focusList || focusList.length === 0) {
    return { result: true, updatedCacheFocusList: cacheFocusList };
  }

  // Issue #1100: Check if the focus list matches the cached focus list.
  let currentCacheFocusList = cacheFocusList;
  if (!isFocusListMatch(currentCacheFocusList, focusList)) {
    cacheFocus.clear();
    currentCacheFocusList = [...focusList];
  }

  if (cacheFocus.has(index)) {
    return {
      result: cacheFocus.get(index) as boolean,
      updatedCacheFocusList: currentCacheFocusList,
    };
  }

  if (checked.has(index)) {
    cacheFocus.set(index, false);
    return { result: false, updatedCacheFocusList: currentCacheFocusList };
  }

  checked.add(index);

  for (let pos = 0; pos < focusList.length; pos++) {
    const focusIndex = focusList[pos];

    if (index === focusIndex) {
      cacheFocus.set(index, true);
      return { result: true, updatedCacheFocusList: currentCacheFocusList };
    }

    const toList = inwardConnections(creature, caches, index);

    for (let i = toList.length; i--;) {
      const checkIndx: number = toList[i].from;
      if (checkIndx === index) {
        cacheFocus.set(index, true);
        return { result: true, updatedCacheFocusList: currentCacheFocusList };
      }

      const sub = inFocus(
        creature,
        caches,
        cacheFocus,
        currentCacheFocusList,
        checkIndx,
        focusList,
        checked,
      );
      currentCacheFocusList = sub.updatedCacheFocusList;
      if (sub.result) {
        cacheFocus.set(index, true);
        return { result: true, updatedCacheFocusList: currentCacheFocusList };
      }
    }
  }

  cacheFocus.set(index, false);
  return { result: false, updatedCacheFocusList: currentCacheFocusList };
}

/**
 * Check if the given focus list matches the cached focus list.
 * Issue #1100: Used to detect when the focus cache should be invalidated.
 */
function isFocusListMatch(
  cached: number[] | undefined,
  focusList: number[],
): boolean {
  if (!cached) return false;
  if (cached.length !== focusList.length) return false;
  for (let i = 0; i < cached.length; i++) {
    if (cached[i] !== focusList[i]) return false;
  }
  return true;
}
