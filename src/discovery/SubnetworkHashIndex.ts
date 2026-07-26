/**
 * Engram-inspired hash-based subnetwork lookup index.
 *
 * Issue #2531: Augments the discovery `SuccessCache` / `FailureCache` with an
 * O(1) hash-based secondary lookup keyed on the local subnetwork wire-pattern
 * around a focal neuron. The intent is to short-circuit candidate generation
 * when the same local wire pattern has already been tried elsewhere in the
 * population, regardless of which creature it appears in.
 *
 * The hash is **UUID-anonymised**: it is derived from the focal neuron's
 * `(squashFn, in-degree, out-degree, weight bucket)` and the same tuple for
 * each 1-hop neighbour. UUIDs are deliberately NOT included so the same
 * pattern in two different creatures (with different neuron UUIDs) collides
 * into the same hash bucket.
 *
 * Per `AGENTS.md`, the hash inputs use the canonical wire format only — no
 * runtime integer ids ever appear in the hash payload.
 */

import { crypto as stdCrypto } from "@std/crypto";
import type { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import { exportJSON } from "@creature/CreatureSerialization.ts";
import type { DiscoveryCandidate } from "@discovery/DiscoveryCandidates.ts";
import { extractExponent } from "@discovery/FailureCacheKey.ts";

/** Default maximum entries kept in the in-memory index (module-private). */
const DEFAULT_SUBNETWORK_INDEX_SIZE = 50_000;

interface InternalEntry<T> {
  value: T;
  generation: number;
}

/**
 * Bounded LRU index keyed by subnetwork hash.
 *
 * - When `maxEntries` is 0 the index is disabled (all operations are no-ops).
 * - Eviction never removes entries inserted within the current generation.
 * - `advanceGeneration()` should be called once per evolution generation by
 *   the surrounding loop so historical entries can be aged out.
 */
export class SubnetworkHashIndex<T> {
  private readonly maxEntries: number;
  private currentGen = 0;
  // Map iteration follows insertion order, so we get cheap LRU by re-inserting
  // on access. Each bucket stores the entries that hashed to the same key.
  private readonly buckets = new Map<string, InternalEntry<T>[]>();
  private totalEntries = 0;

  constructor(maxEntries: number = DEFAULT_SUBNETWORK_INDEX_SIZE) {
    this.maxEntries = Math.max(0, Math.floor(maxEntries));
  }

  /** True when the index is configured to store entries. */
  isEnabled(): boolean {
    return this.maxEntries > 0;
  }

  /** Step the generation counter; previous-generation entries become evictable. */
  advanceGeneration(): void {
    this.currentGen++;
  }

  /** Current generation counter (exposed for diagnostics/tests). */
  get generation(): number {
    return this.currentGen;
  }

  /** Total number of entries currently held across all buckets. */
  get count(): number {
    return this.totalEntries;
  }

  /** Insert a value under the given hash key. Bumps LRU position. */
  insert(hash: string, value: T): void {
    if (!this.isEnabled()) return;
    let bucket = this.buckets.get(hash);
    if (bucket === undefined) {
      bucket = [];
    } else {
      // Re-insert to bump the bucket to the most-recent position.
      this.buckets.delete(hash);
    }
    bucket.push({ value, generation: this.currentGen });
    this.buckets.set(hash, bucket);
    this.totalEntries++;
    this.evictIfNeeded();
  }

  /** Look up entries previously indexed under `hash`. Bumps LRU position. */
  lookup(hash: string): T[] {
    const bucket = this.buckets.get(hash);
    if (bucket === undefined) return [];
    // Re-insert so a cache hit refreshes recency.
    this.buckets.delete(hash);
    this.buckets.set(hash, bucket);
    return bucket.map((entry) => entry.value);
  }

  /** Drop every entry. */
  clear(): void {
    this.buckets.clear();
    this.totalEntries = 0;
  }

  private evictIfNeeded(): void {
    if (this.totalEntries <= this.maxEntries) return;

    // Iterate from oldest bucket forward; remove non-current-generation entries
    // until we are back within capacity. Entries inserted in the current
    // generation are always preserved (issue #2531 acceptance criterion).
    for (const [hash, bucket] of this.buckets) {
      if (this.totalEntries <= this.maxEntries) return;

      const survivors: InternalEntry<T>[] = [];
      let removed = 0;
      for (const entry of bucket) {
        if (this.totalEntries - removed <= this.maxEntries) {
          survivors.push(entry);
          continue;
        }
        if (entry.generation === this.currentGen) {
          // Never evict current-generation entries, even if it leaves us
          // temporarily over capacity.
          survivors.push(entry);
          continue;
        }
        removed++;
      }
      this.totalEntries -= removed;

      if (survivors.length === 0) {
        this.buckets.delete(hash);
      } else if (survivors.length !== bucket.length) {
        this.buckets.set(hash, survivors);
      }
    }
  }
}

/**
 * In/out degree and incident weight lists for one neuron, keyed by wire UUID.
 */
export interface SubnetworkDegrees {
  inDegree: number;
  outDegree: number;
  inWeights: number[];
  outWeights: number[];
}

/**
 * Topology-invariant adjacency for a single creature export.
 *
 * Built once with a single pass over `exported.synapses` (plus one pass over
 * `exported.neurons`), it lets `computeSubnetworkHash` resolve every focal /
 * neighbour lookup in O(1) instead of rescanning the whole synapse list per
 * neuron. Hoisting this out of a per-neuron loop turns the old
 * O(neurons × synapses) cost into O(neurons + synapses) (Issue #3475).
 */
export interface SubnetworkAdjacency {
  neuronByUuid: Map<string, NeuronExport>;
  degreesByUuid: Map<string, SubnetworkDegrees>;
  neighboursByUuid: Map<string, Set<string>>;
}

/** Shared read-only fallbacks for neurons with no incident synapses. */
const EMPTY_DEGREES: SubnetworkDegrees = {
  inDegree: 0,
  outDegree: 0,
  inWeights: [],
  outWeights: [],
};
const EMPTY_NEIGHBOURS: ReadonlySet<string> = new Set<string>();

/**
 * Precomputes {@link SubnetworkAdjacency} for `exported` in a single synapse
 * pass. Pass the result into {@link computeSubnetworkHash} to hash many focal
 * neurons of the same creature without repeating the O(synapses) scan.
 */
export function buildSubnetworkAdjacency(
  exported: CreatureExport,
): SubnetworkAdjacency {
  const neuronByUuid = new Map<string, NeuronExport>();
  for (const n of exported.neurons) {
    if (n.uuid) neuronByUuid.set(n.uuid, n);
  }

  const degreesByUuid = new Map<string, SubnetworkDegrees>();
  const neighboursByUuid = new Map<string, Set<string>>();

  const degreesFor = (uuid: string): SubnetworkDegrees => {
    let d = degreesByUuid.get(uuid);
    if (!d) {
      d = { inDegree: 0, outDegree: 0, inWeights: [], outWeights: [] };
      degreesByUuid.set(uuid, d);
    }
    return d;
  };
  const neighboursFor = (uuid: string): Set<string> => {
    let s = neighboursByUuid.get(uuid);
    if (!s) {
      s = new Set<string>();
      neighboursByUuid.set(uuid, s);
    }
    return s;
  };

  for (const s of exported.synapses) {
    const { fromUUID, toUUID, weight } = s;
    if (toUUID) {
      const d = degreesFor(toUUID);
      d.inDegree++;
      d.inWeights.push(weight);
      if (fromUUID) neighboursFor(toUUID).add(fromUUID);
    }
    if (fromUUID) {
      const d = degreesFor(fromUUID);
      d.outDegree++;
      d.outWeights.push(weight);
      if (toUUID) neighboursFor(fromUUID).add(toUUID);
    }
  }

  return { neuronByUuid, degreesByUuid, neighboursByUuid };
}

/**
 * Computes a UUID-anonymised hash describing the local 1-hop wire pattern
 * around `focalUuid` in the supplied creature export.
 *
 * Returns `undefined` if the focal UUID does not appear in the creature.
 *
 * The hash inputs are:
 * - The focal neuron's `(squash, bias-bucket, in-degree, out-degree)`.
 * - The bucketed weights of every synapse incident on the focal neuron.
 * - For each 1-hop neighbour, the same tuple (with neighbour `(squash,
 *   bias-bucket, in-degree, out-degree)`).
 *
 * Neighbour tuples are sorted before hashing so the result is independent of
 * iteration order. UUIDs are intentionally excluded — the index keys on the
 * structural pattern, not on identity.
 *
 * Pass a precomputed {@link SubnetworkAdjacency} (via
 * {@link buildSubnetworkAdjacency}) to avoid rebuilding the neuron map and
 * rescanning synapses when hashing many focal neurons of the same creature.
 */
export function computeSubnetworkHash(
  source: Creature | CreatureExport,
  focalUuid: string,
  adjacency?: SubnetworkAdjacency,
): string | undefined {
  const exported: CreatureExport = isCreatureExport(source)
    ? source
    : exportJSON(source);

  const adj = adjacency ?? buildSubnetworkAdjacency(exported);

  const focal = adj.neuronByUuid.get(focalUuid);
  if (!focal) return undefined;

  const focalDegrees = adj.degreesByUuid.get(focalUuid) ?? EMPTY_DEGREES;
  const focalTuple = neuronTuple(
    focal,
    focalDegrees.inDegree,
    focalDegrees.outDegree,
  );

  const neighbourTuples: string[] = [];
  for (const uuid of adj.neighboursByUuid.get(focalUuid) ?? EMPTY_NEIGHBOURS) {
    const degrees = adj.degreesByUuid.get(uuid) ?? EMPTY_DEGREES;
    const neighbour = adj.neuronByUuid.get(uuid);
    if (neighbour) {
      neighbourTuples.push(
        neuronTuple(neighbour, degrees.inDegree, degrees.outDegree),
      );
    } else {
      // Input neurons (referenced by `input-N` UUIDs) have no NeuronExport
      // entry in the exported JSON. Encode them with a fixed marker so two
      // input-only neighbours collide regardless of their input index.
      neighbourTuples.push(`INPUT:i${degrees.inDegree}:o${degrees.outDegree}`);
    }
  }
  neighbourTuples.sort();

  const incomingBuckets = focalDegrees.inWeights.map(formatBucket).sort();
  const outgoingBuckets = focalDegrees.outWeights.map(formatBucket).sort();

  const payload = [
    `F:${focalTuple}`,
    `IW:${incomingBuckets.join(",")}`,
    `OW:${outgoingBuckets.join(",")}`,
    `N:${neighbourTuples.join("|")}`,
  ].join("||");

  return shortHash(payload);
}

function isCreatureExport(source: unknown): source is CreatureExport {
  if (source === null || typeof source !== "object") return false;
  const candidate = source as { synapses?: unknown[]; neurons?: unknown[] };
  if (!Array.isArray(candidate.synapses) || candidate.synapses.length === 0) {
    // Empty creatures are rare; fall through to the keyed-shape check below.
    return Array.isArray(candidate.neurons) &&
      candidate.neurons.every((n) =>
        n !== null && typeof n === "object" &&
        ("uuid" in (n as Record<string, unknown>) ||
          "type" in (n as Record<string, unknown>))
      );
  }
  // CreatureExport synapses use `fromUUID`/`toUUID`; runtime Creature synapses
  // use integer `from`/`to`. The presence of either UUID field on the first
  // synapse is a reliable discriminator.
  const first = candidate.synapses[0] as Record<string, unknown>;
  return "fromUUID" in first || "toUUID" in first;
}

function neuronTuple(
  neuron: NeuronExport,
  inDegree: number,
  outDegree: number,
): string {
  const squash = neuron.squash ?? "?";
  const bias = formatBucket(neuron.bias ?? 0);
  return `${squash}:i${inDegree}:o${outDegree}:b${bias}`;
}

function formatBucket(value: number): string {
  if (value === 0) return "z";
  const sign = value < 0 ? "-" : "+";
  const exp = extractExponent(value);
  return `${sign}e${exp}`;
}

function shortHash(input: string): string {
  const buf = stdCrypto.subtle.digestSync(
    "SHA-1",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Shared singleton wiring for SuccessCache / FailureCache / SupplementFromCache.
// ---------------------------------------------------------------------------

/**
 * Shape of an indexed cache reference. Keeps the index payload small while
 * still letting the lookup site re-verify the exact wire pattern (per the
 * "no false positives" acceptance criterion).
 */
export interface IndexedCacheReference {
  /** `success` or `failure` — which underlying file-backed cache holds the entry. */
  source: "success" | "failure";
  /** Sub-directory name (the change type). */
  changeType: string;
  /** The deterministic cache key (filename stem) of the underlying entry. */
  cacheKey: string;
}

let sharedIndex = new SubnetworkHashIndex<IndexedCacheReference>(
  DEFAULT_SUBNETWORK_INDEX_SIZE,
);

/** Returns the in-process shared subnetwork hash index. */
export function getSharedSubnetworkIndex(): SubnetworkHashIndex<
  IndexedCacheReference
> {
  return sharedIndex;
}

/**
 * Resize / re-configure the shared subnetwork hash index. Callers that source
 * configuration from `NeatOptions.subnetworkIndexSize` should invoke this
 * during start-up. Passing `0` disables the index entirely.
 */
export function configureSharedSubnetworkIndex(maxEntries: number): void {
  sharedIndex = new SubnetworkHashIndex<IndexedCacheReference>(maxEntries);
}

/**
 * Extracts the "focal" wire UUID for a discovery candidate — the neuron
 * whose local 1-hop subnetwork best characterises the change. Returns
 * `undefined` when no stable focal UUID can be determined (in which case the
 * index is skipped — the file-backed cache still works as before).
 */
export function extractFocalUuid(
  candidate: DiscoveryCandidate,
): string | undefined {
  const change = candidate.change;
  switch (change.type) {
    case "add-synapses": {
      return change.synapseCandidate?.toNeuronUuid ??
        change.synapseCandidate?.fromNeuronUuid ??
        change.synapseDetails?.toNeuronUuid;
    }
    case "add-neurons": {
      return change.neuronCandidate?.toNeuronUuid ??
        change.neuronDetails?.toNeuronUuid;
    }
    case "change-squash": {
      return change.squashCandidate?.neuronUuid;
    }
    case "remove-low-impact": {
      return change.removalCandidate?.neuronUuid;
    }
    case "remove-neuron": {
      return change.harmfulNeuronCandidate?.neuronUuid;
    }
    case "remove-synapse": {
      return change.synapseDetails?.toNeuronUuid ??
        change.harmfulSynapseCandidate?.toNeuronUuid;
    }
    default:
      // Combo / coordinated / cache-informed-removal candidates touch many
      // neurons; skip indexing them rather than risk indexing the wrong focal
      // point. They keep working through the file-backed cache.
      return undefined;
  }
}

/**
 * Convenience helper used by the SuccessCache / FailureCache write paths.
 *
 * Computes the focal UUID and the subnetwork hash for the supplied candidate
 * against the supplied base creature, then inserts the reference into the
 * shared index. Best-effort — any failure is swallowed so cache writes never
 * fail because of indexing.
 */
export function indexCandidateForCache(
  baseCreature: Creature | undefined,
  candidate: DiscoveryCandidate,
  reference: IndexedCacheReference,
): void {
  const idx = getSharedSubnetworkIndex();
  if (!idx.isEnabled() || !baseCreature) return;
  try {
    const focal = extractFocalUuid(candidate);
    if (!focal) return;
    const hash = computeSubnetworkHash(baseCreature, focal);
    if (!hash) return;
    idx.insert(hash, reference);
  } catch {
    // Indexing is opportunistic; never let a failure here surface to the
    // caller. The file-backed cache remains the source of truth.
  }
}
