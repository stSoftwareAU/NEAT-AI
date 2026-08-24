/**
 * CreatureTopology.ts - Neuron/synapse management and connection queries.
 *
 * Extracted from Creature.ts (Issue #1409) to keep the Creature class
 * under 500 lines and each module focused on a single responsibility.
 */

import { assert } from "@std/assert";
import type { Creature } from "@creature";
import type { Synapse } from "@architecture/Synapse.ts";
import {
  compareSynapses,
  isRoleReadingTarget,
  nonIfSecondRoleMessage,
  SYNAPSE_ROLE_COUNT,
  type SynapseRole,
  synapseRoleRank,
} from "@architecture/SynapseKey.ts";
import { TopologyError } from "@errors/TopologyError.ts";

/**
 * Internal state for topology caches and indices.
 * Stored on the Creature instance and passed to topology functions.
 */
export interface TopologyCaches {
  cacheTo: (Synapse[] | undefined)[];
  cacheFrom: (Synapse[] | undefined)[];
  cacheSelf: (Synapse[] | undefined)[];
  synapsesIndexedByTo: Synapse[] | null;
  connectionSet: Set<number> | null;
  availableConnectionsCache: [number, number][] | null;
  /** Issue #1958: Cached set of hidden neuron integer IDs */
  hiddenNeuronIds: Set<number> | null;
  /**
   * Stable wire-format keys for hidden neurons (typically `neuron.uuid`).
   * Used for genetic compatibility — runtime `id` alone is not a stable gene identity.
   */
  hiddenNeuronWireKeys: Set<string> | null;
  inwardCacheMissCount: number;
}

/**
 * Threshold for switching from linear scan to building the secondary index.
 * Issue #1010: Performance optimisation for large creatures.
 */
const INWARD_INDEX_BUILD_THRESHOLD = 3;

/**
 * Minimum number of synapses to trigger proactive index prebuilding.
 * Issue #1097: Performance - Prebuild inward synapse index after breed/mutation batch.
 */
const PREBUILD_SYNAPSE_THRESHOLD = 1000;

/**
 * Get a self-connection for the neuron at the given index.
 */
export function selfConnection(
  creature: Creature,
  caches: TopologyCaches,
  indx: number,
): Synapse | null {
  let results = caches.cacheSelf[indx];
  if (results === undefined) {
    results = [];
    const tmpList = creature.synapses;
    for (let i = tmpList.length; i--;) {
      const c = tmpList[i];
      if (c.to === indx && c.from === indx) {
        results.push(c);
      }
    }
    caches.cacheSelf[indx] = results;
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
  let results = caches.cacheTo[toIndx];
  if (results === undefined) {
    results = lookupInwardConnections(creature, caches, toIndx);
    caches.cacheTo[toIndx] = results;
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
    if (a.from !== b.from) return a.from - b.from;
    // Issue #3873: the role completes the key, so two roles from one source
    // land in a stable order rather than whichever the sort happened to pick.
    return synapseRoleRank(a.type) - synapseRoleRank(b.type);
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
    if (cacheTo[indx] === undefined) {
      cacheTo[indx] = [];
    }
  }

  const index = caches.synapsesIndexedByTo;
  for (let i = 0, len = index.length; i < len; i++) {
    const synapse = index[i];
    const to = synapse.to;
    const tmpResults = cacheTo[to];
    if (tmpResults) {
      tmpResults.push(synapse);
    }
  }
}

/**
 * Numeric key for one synapse identity `(from, to, type)`.
 *
 * Issue #3873: the role occupies the low {@link SYNAPSE_ROLE_COUNT} slots so the
 * four keys of one ordered pair are contiguous, which is what lets
 * {@link hasConnection} answer a pair-level question with four O(1) probes.
 */
export function connectionKey(
  neuronCount: number,
  from: number,
  to: number,
  type?: SynapseRole,
): number {
  return (from * neuronCount + to) * SYNAPSE_ROLE_COUNT + synapseRoleRank(type);
}

/**
 * Builds and returns a Set of existing connections as numeric keys.
 * Encodes (from, to, type) via {@link connectionKey} for O(1) lookup
 * without string allocation.
 * Issue #1036: Performance optimisation for ADD_CONNECTION mutation.
 * Issue #1659: Replaced string keys with numeric keys.
 * Issue #3873: The role is part of the key — an ordered pair may appear once
 * per role, and only into an `IF` target.
 */
export function getConnectionSet(
  creature: Creature,
  caches: TopologyCaches,
): Set<number> {
  if (caches.connectionSet === null) {
    const neuronCount = creature.neurons.length;
    caches.connectionSet = new Set<number>();
    for (let i = 0, len = creature.synapses.length; i < len; i++) {
      const synapse = creature.synapses[i];
      caches.connectionSet.add(
        connectionKey(neuronCount, synapse.from, synapse.to, synapse.type),
      );
    }
  }
  return caches.connectionSet;
}

/**
 * Checks if a connection exists between two neurons in O(1) time.
 *
 * With `type` given the question is the exact `(from, to, type)` triple; with it
 * omitted the question is whether the ordered pair carries *any* role
 * (Issue #3873).
 *
 * Issue #1036: Performance optimisation for ADD_CONNECTION mutation.
 * Issue #1659: Uses numeric key encoding.
 */
export function hasConnection(
  creature: Creature,
  caches: TopologyCaches,
  from: number,
  to: number,
  type?: SynapseRole,
): boolean {
  const neuronCount = creature.neurons.length;
  const set = getConnectionSet(creature, caches);
  if (type !== undefined) {
    return set.has(connectionKey(neuronCount, from, to, type));
  }
  const base = (from * neuronCount + to) * SYNAPSE_ROLE_COUNT;
  for (let rank = 0; rank < SYNAPSE_ROLE_COUNT; rank++) {
    if (set.has(base + rank)) return true;
  }
  return false;
}

/**
 * Builds and returns a cached Set of hidden neuron integer IDs.
 * Enables O(1) lookup for genetic compatibility checks.
 * Issue #1032: Performance optimisation for genetic compatibility checks.
 * Issue #1958: Uses integer neuron IDs instead of UUID strings.
 */
export function getHiddenNeuronIds(
  creature: Creature,
  caches: TopologyCaches,
): Set<number> {
  if (caches.hiddenNeuronIds === null) {
    caches.hiddenNeuronIds = new Set<number>();
    for (let i = creature.input, len = creature.neurons.length; i < len; i++) {
      const neuron = creature.neurons[i];
      if (neuron.type === "hidden") {
        caches.hiddenNeuronIds.add(neuron.id);
      }
    }
  }
  return caches.hiddenNeuronIds;
}

/**
 * Stable keys for hidden neurons for breeding compatibility (wire `uuid` strings).
 * Issue #1958: Integer `id` is for runtime speed; gene identity follows `uuid`.
 */
export function getHiddenNeuronWireKeys(
  creature: Creature,
  caches: TopologyCaches,
): Set<string> {
  if (caches.hiddenNeuronWireKeys === null) {
    caches.hiddenNeuronWireKeys = new Set<string>();
    for (let i = creature.input, len = creature.neurons.length; i < len; i++) {
      const neuron = creature.neurons[i];
      if (neuron.type === "hidden") {
        const key = neuron.uuid ?? String(neuron.id);
        caches.hiddenNeuronWireKeys.add(key);
      }
    }
  }
  return caches.hiddenNeuronWireKeys;
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
  _caches: TopologyCaches,
): [number, number][] {
  const neurons = creature.neurons;
  const neuronCount = neurons.length;
  const inputCount = creature.input;

  // Issue #3873: a slot is taken when the ordered pair carries any role, so
  // this walk keys by the pair. Building that set here costs one pass over the
  // synapses and keeps the O(n²) candidate loop at a single probe each.
  const pairSet = new Set<number>();
  for (let i = 0, len = creature.synapses.length; i < len; i++) {
    const synapse = creature.synapses[i];
    pairSet.add(synapse.from * neuronCount + synapse.to);
  }

  const available: [number, number][] = [];
  for (let fromIndx = 0; fromIndx < neuronCount; fromIndx++) {
    const startTo = Math.max(fromIndx + 1, inputCount);
    for (let toIndx = startTo; toIndx < neuronCount; toIndx++) {
      const neuronTo = neurons[toIndx];
      if (neuronTo.type === "constant") continue;
      const key = fromIndx * neuronCount + toIndx;
      if (!pairSet.has(key)) {
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
  let results = caches.cacheFrom[fromIndx];
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

    caches.cacheFrom[fromIndx] = results;
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
 *
 * With `type` given the match is the exact `(from, to, type)` triple. With it
 * omitted the ordered pair is the whole key — which identifies at most one
 * synapse everywhere except an `IF` target, where the first role in canonical
 * order is returned; {@link getSynapses} is the call that sees all of them
 * (Issue #3873).
 */
export function getSynapse(
  creature: Creature,
  caches: TopologyCaches,
  from: number,
  to: number,
  type?: SynapseRole,
): Synapse | null {
  const outward = outwardConnections(creature, caches, from);

  let match: Synapse | null = null;
  for (let indx = outward.length; indx--;) {
    const c = outward[indx];
    if (c.to === to) {
      if (type !== undefined) {
        if (c.type === type) return c;
      } else {
        // Walking backwards, so the last pair match seen is the lowest-ranked
        // role — the first in canonical order.
        match = c;
      }
    } else if (c.to < to) {
      break;
    }
  }

  return match;
}

/**
 * Every synapse from `from` to `to`, in canonical `(from, to, type)` order.
 *
 * At most one outside an `IF` target; up to four (one per role) into one
 * (Issue #3873).
 */
export function getSynapses(
  creature: Creature,
  caches: TopologyCaches,
  from: number,
  to: number,
): Synapse[] {
  const outward = outwardConnections(creature, caches, from);
  const matches: Synapse[] = [];
  for (let indx = 0; indx < outward.length; indx++) {
    const c = outward[indx];
    if (c.to === to) matches.push(c);
    else if (c.to > to) break;
  }
  return matches;
}

/**
 * Binary search for a synapse by `(from, to)` and, when given, `type`.
 *
 * Synapses are sorted by `from`, then `to`, then role rank (Issue #3873). With
 * `type` omitted the index returned is the **first** synapse of the pair in
 * that order, so a caller that must see every role should use
 * {@link getSynapses}.
 *
 * Issue #1101: Performance optimisation for disconnect operations.
 */
export function binarySearchSynapse(
  creature: Creature,
  from: number,
  to: number,
  type?: SynapseRole,
): number {
  const synapses = creature.synapses;
  let low = 0;
  let high = synapses.length - 1;
  let firstOfPair = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const syn = synapses[mid];

    if (syn.from < from) {
      low = mid + 1;
    } else if (syn.from > from) {
      high = mid - 1;
    } else if (syn.to < to) {
      low = mid + 1;
    } else if (syn.to > to) {
      high = mid - 1;
    } else if (type === undefined) {
      // Keep narrowing left so the answer is the pair's first synapse, which
      // is stable regardless of which role the probe happened to land on.
      firstOfPair = mid;
      high = mid - 1;
    } else {
      const rank = synapseRoleRank(syn.type);
      const wanted = synapseRoleRank(type);
      if (rank < wanted) low = mid + 1;
      else if (rank > wanted) high = mid - 1;
      else return mid;
    }
  }

  return firstOfPair;
}

/**
 * Find the insertion point for a synapse to maintain sorted order.
 * Uses binary search for O(log n) efficiency.
 * Issue #1102: Helper method for connectBatch.
 * Issue #3873: Ordered by the `(from, to, type)` triple.
 */
export function findInsertionPoint(
  creature: Creature,
  from: number,
  to: number,
  type?: SynapseRole,
): number {
  const synapses = creature.synapses;
  const key = { from, to, type };
  let low = 0;
  let high = synapses.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compareSynapses(synapses[mid], key) < 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * The synapse a new `(from, to, type)` would collide with, or `null` when the
 * slot is free (Issue #3873).
 *
 * Into an `IF` target that is the same role, since the kernel sums each role
 * separately. Into every other squash it is *any* role, because they all land
 * in one sum — so the pair is the whole key there.
 */
export function occupyingSynapse(
  creature: Creature,
  caches: TopologyCaches,
  from: number,
  to: number,
  type?: SynapseRole,
): Synapse | null {
  return isRoleReadingTarget(creature.neurons, to)
    ? getSynapse(creature, caches, from, to, type)
    : getSynapse(creature, caches, from, to);
}

/**
 * Refuse a synapse the `(from, to, type)` key has no room for, and answer where
 * it belongs when it does (Issue #3873).
 *
 * One binary search settles both questions: the roles of an ordered pair are
 * contiguous in canonical order, so the neighbours of the insertion point are
 * the whole of the pair's occupied slots.
 *
 * @returns The index the new synapse must be spliced in at.
 * @throws {@link TopologyError} when the target cannot read roles apart and the
 *   pair is already taken.
 */
export function assertSynapseSlotFree(
  creature: Creature,
  from: number,
  to: number,
  type?: SynapseRole,
): number {
  const location = findInsertionPoint(creature, from, to, type);
  const synapses = creature.synapses;

  const after = synapses[location];
  if (after?.from === from && after.to === to && after.type === type) {
    assert(false, "Connection already exists");
  }

  const sibling = (after?.from === from && after.to === to)
    ? after
    : location > 0 &&
        synapses[location - 1].from === from && synapses[location - 1].to === to
    ? synapses[location - 1]
    : null;

  if (sibling && !isRoleReadingTarget(creature.neurons, to)) {
    throw new TopologyError(
      nonIfSecondRoleMessage(
        from,
        to,
        sibling.type,
        type,
        creature.neurons[to]?.squash,
      ),
      "INVALID_CONNECTION",
    );
  }

  return location;
}

/**
 * Check if a neuron is in focus.
 *
 * Issue #1443: Uses iterative BFS to build the complete focus closure
 * as a Set<number> on first call, then O(1) lookup for subsequent calls.
 * The closure includes all neurons downstream of focus neurons (reachable
 * via outward connections) plus neurons with self-connections.
 */
export function inFocus(
  creature: Creature,
  caches: TopologyCaches,
  focusClosure: Set<number> | null,
  cacheFocusList: number[] | undefined,
  index: number,
  focusList?: number[],
): {
  result: boolean;
  updatedFocusClosure: Set<number> | null;
  updatedCacheFocusList: number[] | undefined;
} {
  if (!focusList || focusList.length === 0) {
    return {
      result: true,
      updatedFocusClosure: focusClosure,
      updatedCacheFocusList: cacheFocusList,
    };
  }

  // Issue #1100: Check if the focus list matches the cached focus list.
  let currentCacheFocusList = cacheFocusList;
  let currentClosure = focusClosure;
  if (!isFocusListMatch(currentCacheFocusList, focusList)) {
    currentClosure = null;
    currentCacheFocusList = [...focusList];
  }

  // Build the closure if not yet computed for this focus list.
  if (currentClosure === null) {
    currentClosure = buildFocusClosure(creature, caches, focusList);
  }

  return {
    result: currentClosure.has(index),
    updatedFocusClosure: currentClosure,
    updatedCacheFocusList: currentCacheFocusList,
  };
}

/**
 * Builds the complete focus closure using iterative BFS.
 *
 * Issue #1443: Replaces recursive DFS with iterative BFS.
 * Starting from focus neurons, walks downstream via outward connections
 * to find all reachable neurons. Also includes neurons with self-connections,
 * matching the original recursive behaviour.
 */
function buildFocusClosure(
  creature: Creature,
  caches: TopologyCaches,
  focusList: number[],
): Set<number> {
  const closure = new Set<number>();
  const queue: number[] = [];

  // Seed the BFS with focus neurons.
  for (const focusIdx of focusList) {
    if (!closure.has(focusIdx)) {
      closure.add(focusIdx);
      queue.push(focusIdx);
    }
  }

  // Add neurons with self-connections (matches original recursive behaviour
  // where self-connected neurons are always considered in focus).
  for (const synapse of creature.synapses) {
    if (synapse.from === synapse.to && !closure.has(synapse.from)) {
      closure.add(synapse.from);
      queue.push(synapse.from);
    }
  }

  // BFS: walk downstream via outward connections.
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const outward = outwardConnections(creature, caches, current);
    for (const connection of outward) {
      const target = connection.to;
      if (!closure.has(target)) {
        closure.add(target);
        queue.push(target);
      }
    }
  }

  return closure;
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
