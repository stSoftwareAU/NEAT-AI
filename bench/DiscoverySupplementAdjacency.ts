/**
 * Benchmark for hoisting topology-invariant adjacency out of the discovery
 * cache-supplement hash loop (Issue #3475).
 *
 * `collectHashIndexHits` (SupplementFromCache) hashes every hidden / output
 * neuron of the base creature. Before #3475 each `computeSubnetworkHash` call
 * rebuilt a `neuronByUuid` map and rescanned the whole synapse list for the
 * focal neuron and every 1-hop neighbour — O(neurons × synapses) per supplement
 * call. #3475 precomputes a single {@link buildSubnetworkAdjacency} pass and
 * reuses it for every focal neuron, so each hash is O(1) lookups.
 *
 * This benchmark compares the two shapes on a production-scale creature
 * (~1,500 neurons / ~20,000 synapses):
 *   - `per-neuron adjacency`  — rebuild adjacency for every focal neuron (old).
 *   - `shared adjacency`      — build adjacency once, reuse it (new).
 *
 * Run with:
 *   deno bench --allow-all bench/DiscoverySupplementAdjacency.ts
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import {
  buildSubnetworkAdjacency,
  computeSubnetworkHash,
} from "@discovery/SubnetworkHashIndex.ts";

const INPUTS = 20;
const HIDDEN = 1_480;
const OUTPUTS = 20;
const TARGET_SYNAPSES = 20_000;

/**
 * Builds a synthetic production-scale creature export. Deterministic — a small
 * linear-congruential generator keeps the wiring reproducible without touching
 * `Math.random()`.
 */
function buildLargeExport(): CreatureExport {
  const neurons: NeuronExport[] = [];
  const hiddenUuids: string[] = [];
  for (let i = 0; i < HIDDEN; i++) {
    const uuid = `hidden-${i}`;
    hiddenUuids.push(uuid);
    neurons.push({
      type: "hidden",
      uuid,
      squash: i % 3 === 0 ? "TANH" : i % 3 === 1 ? "IDENTITY" : "LOGISTIC",
      bias: (i % 7) / 7,
    });
  }
  const outputUuids: string[] = [];
  for (let o = 0; o < OUTPUTS; o++) {
    const uuid = `output-${o}`;
    outputUuids.push(uuid);
    neurons.push({ type: "output", uuid, squash: "IDENTITY", bias: 0 });
  }

  const synapses: SynapseExport[] = [];
  let seed = 0x2545f491;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };

  // Wire every hidden neuron from an input and to an output (keeps the graph
  // connected), then add random forward hidden→hidden edges up to the target.
  for (let i = 0; i < HIDDEN; i++) {
    synapses.push({
      fromUUID: `input-${i % INPUTS}`,
      toUUID: hiddenUuids[i],
      weight: ((next() % 200) - 100) / 100,
    });
    synapses.push({
      fromUUID: hiddenUuids[i],
      toUUID: outputUuids[i % OUTPUTS],
      weight: ((next() % 200) - 100) / 100,
    });
  }
  while (synapses.length < TARGET_SYNAPSES) {
    const a = next() % HIDDEN;
    const b = next() % HIDDEN;
    if (a >= b) continue; // forward-only: lower index → higher index
    synapses.push({
      fromUUID: hiddenUuids[a],
      toUUID: hiddenUuids[b],
      weight: ((next() % 200) - 100) / 100,
    });
  }

  return {
    input: INPUTS,
    output: OUTPUTS,
    neurons,
    synapses,
  } as CreatureExport;
}

const exported = buildLargeExport();

/** Old shape: rebuild adjacency for every focal neuron. */
function collectHitsPerNeuronAdjacency(exp: CreatureExport): Set<string> {
  const hashes = new Set<string>();
  for (const neuron of exp.neurons) {
    const uuid = neuron.uuid;
    if (!uuid) continue;
    if (neuron.type !== "hidden" && neuron.type !== "output") continue;
    const adjacency = buildSubnetworkAdjacency(exp);
    const hash = computeSubnetworkHash(exp, uuid, adjacency);
    if (hash) hashes.add(hash);
  }
  return hashes;
}

/** New shape: build adjacency once, reuse it for every focal neuron. */
function collectHitsSharedAdjacency(exp: CreatureExport): Set<string> {
  const hashes = new Set<string>();
  const adjacency = buildSubnetworkAdjacency(exp);
  for (const neuron of exp.neurons) {
    const uuid = neuron.uuid;
    if (!uuid) continue;
    if (neuron.type !== "hidden" && neuron.type !== "output") continue;
    const hash = computeSubnetworkHash(exp, uuid, adjacency);
    if (hash) hashes.add(hash);
  }
  return hashes;
}

Deno.bench("collectHashIndexHits - per-neuron adjacency (before #3475)", () => {
  collectHitsPerNeuronAdjacency(exported);
});

Deno.bench("collectHashIndexHits - shared adjacency (after #3475)", () => {
  collectHitsSharedAdjacency(exported);
});

/*
 * Both shapes produce an identical set of hashes (the fix is a pure hoist, not a
 * behaviour change) — verified by test/discovery/SubnetworkHashIndex.ts. The
 * only difference is where the invariant adjacency is built: once per focal
 * neuron (before) vs once per creature (after).
 */
