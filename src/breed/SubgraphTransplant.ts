/**
 * Subgraph transplantation breeding strategy for horizontal gene transfer
 * between species (Issue #2177).
 *
 * Inspired by horizontal gene transfer in prokaryotes and subtree crossover
 * in genetic programming, this module extracts small, self-contained subgraphs
 * (2–5 connected hidden neurons) from a donor creature and transplants them
 * into a recipient creature.
 *
 * Algorithm:
 * 1. Identify donor subgraphs — small clusters of connected hidden neurons
 * 2. Score subgraphs by modularity (internal vs external connections)
 * 3. Select the best subgraph and transplant it into the mother's topology
 * 4. Connect boundary neurons using shared input indices and small random weights
 * 5. Validate the result with creatureValidate
 */

import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";

/** Minimum number of neurons in a transplantable subgraph. */
const MIN_SUBGRAPH_SIZE = 2;
/** Maximum number of neurons in a transplantable subgraph. */
const MAX_SUBGRAPH_SIZE = 5;

/**
 * A self-contained subgraph extracted from a donor creature.
 */
export interface Subgraph {
  /** UUIDs of the hidden neurons in this subgraph. */
  neuronUuids: string[];
  /** Synapses that connect neurons within the subgraph. */
  internalSynapses: SynapseExport[];
  /** UUIDs of neurons that feed into the subgraph from outside (inputs or other hidden). */
  inputBoundaryUuids: string[];
  /** UUIDs of neurons that the subgraph feeds into (outputs or other hidden). */
  outputBoundaryUuids: string[];
  /** Modularity score: ratio of internal to total connections. Higher is better. */
  modularity: number;
}

/**
 * Extracts candidate subgraphs from a donor creature's exported JSON.
 *
 * Identifies clusters of 2–5 connected hidden neurons and scores them by
 * modularity (ratio of internal connections to total connections involving
 * the cluster's neurons).
 */
export function extractSubgraphs(donorExport: CreatureExport): Subgraph[] {
  const hiddenNeurons = donorExport.neurons.filter(
    (n) => n.type === "hidden" && typeof n.uuid === "string",
  );

  if (hiddenNeurons.length < MIN_SUBGRAPH_SIZE) {
    return [];
  }

  const hiddenUuidSet = new Set(
    hiddenNeurons.map((n) => n.uuid as string),
  );

  // Build adjacency: for each hidden neuron, which other hidden neurons
  // does it connect to (forward direction)?
  const forwardAdj = new Map<string, Set<string>>();
  const backwardAdj = new Map<string, Set<string>>();
  for (const uuid of hiddenUuidSet) {
    forwardAdj.set(uuid, new Set());
    backwardAdj.set(uuid, new Set());
  }

  for (const syn of donorExport.synapses) {
    const from = syn.fromUUID;
    const to = syn.toUUID;
    if (from && to && hiddenUuidSet.has(from) && hiddenUuidSet.has(to)) {
      forwardAdj.get(from)!.add(to);
      backwardAdj.get(to)!.add(from);
    }
  }

  // Generate candidate subgraphs using BFS from each hidden neuron
  const subgraphs: Subgraph[] = [];
  const seenSignatures = new Set<string>();

  for (const startNeuron of hiddenNeurons) {
    const startUuid = startNeuron.uuid as string;
    const cluster = [startUuid];
    const clusterSet = new Set(cluster);

    // BFS to grow the cluster
    const queue = [startUuid];
    while (queue.length > 0 && cluster.length < MAX_SUBGRAPH_SIZE) {
      const current = queue.shift()!;

      // Add forward neighbours
      for (const neighbour of forwardAdj.get(current) ?? []) {
        if (!clusterSet.has(neighbour) && cluster.length < MAX_SUBGRAPH_SIZE) {
          cluster.push(neighbour);
          clusterSet.add(neighbour);
          queue.push(neighbour);
        }
      }

      // Add backward neighbours
      for (const neighbour of backwardAdj.get(current) ?? []) {
        if (!clusterSet.has(neighbour) && cluster.length < MAX_SUBGRAPH_SIZE) {
          cluster.push(neighbour);
          clusterSet.add(neighbour);
          queue.push(neighbour);
        }
      }
    }

    if (cluster.length < MIN_SUBGRAPH_SIZE) continue;

    // Try subgraphs of different sizes from this cluster
    for (
      let size = MIN_SUBGRAPH_SIZE;
      size <= Math.min(cluster.length, MAX_SUBGRAPH_SIZE);
      size++
    ) {
      const subCluster = cluster.slice(0, size);
      const signature = [...subCluster].sort().join(",");
      if (seenSignatures.has(signature)) continue;
      seenSignatures.add(signature);

      const subClusterSet = new Set(subCluster);
      const subgraph = scoreSubgraph(
        subCluster,
        subClusterSet,
        donorExport.synapses,
      );
      if (subgraph) {
        subgraphs.push(subgraph);
      }
    }
  }

  // Sort by modularity (higher is better)
  subgraphs.sort((a, b) => b.modularity - a.modularity);

  return subgraphs;
}

/**
 * Scores a candidate subgraph by its modularity and extracts boundary info.
 */
function scoreSubgraph(
  neuronUuids: string[],
  neuronSet: Set<string>,
  synapses: SynapseExport[],
): Subgraph | null {
  const internalSynapses: SynapseExport[] = [];
  const inputBoundarySet = new Set<string>();
  const outputBoundarySet = new Set<string>();
  let externalConnectionCount = 0;

  for (const syn of synapses) {
    const from = syn.fromUUID;
    const to = syn.toUUID;
    if (!from || !to) continue;

    const fromInside = neuronSet.has(from);
    const toInside = neuronSet.has(to);

    if (fromInside && toInside) {
      // Internal connection
      internalSynapses.push(syn);
    } else if (!fromInside && toInside) {
      // Inbound from outside -> boundary input
      inputBoundarySet.add(from);
      externalConnectionCount++;
    } else if (fromInside && !toInside) {
      // Outbound to outside -> boundary output
      outputBoundarySet.add(to);
      externalConnectionCount++;
    }
  }

  // Must have at least one internal connection
  if (internalSynapses.length === 0) return null;

  // Must have both input and output boundaries to be transplantable
  if (inputBoundarySet.size === 0 || outputBoundarySet.size === 0) return null;

  const totalConnections = internalSynapses.length + externalConnectionCount;
  const modularity = totalConnections > 0
    ? internalSynapses.length / totalConnections
    : 0;

  return {
    neuronUuids,
    internalSynapses,
    inputBoundaryUuids: [...inputBoundarySet],
    outputBoundaryUuids: [...outputBoundarySet],
    modularity,
  };
}

/**
 * Performs subgraph transplantation: extracts a subgraph from the father
 * (donor) and transplants it into the mother (recipient).
 *
 * @param mother - The recipient creature (topology base)
 * @param father - The donor creature (subgraph source)
 * @returns A new offspring creature, or undefined if transplantation fails
 */
export function subgraphTransplant(
  mother: Creature,
  father: Creature,
): Creature | undefined {
  const rng = getRandomNumberGenerator();
  const fatherExport = father.exportJSON();
  const motherExport = mother.exportJSON();

  // 1. Find candidate subgraphs in the donor
  const subgraphs = extractSubgraphs(fatherExport);
  if (subgraphs.length === 0) return undefined;

  // Select a subgraph — prefer higher modularity but add some randomness
  const selectedIndex = Math.min(
    Math.floor(rng.random() * Math.min(subgraphs.length, 3)),
    subgraphs.length - 1,
  );
  const subgraph = subgraphs[selectedIndex];

  // 2. Build the offspring from the mother's topology
  const offspringNeurons: NeuronExport[] = motherExport.neurons.map((n) => ({
    ...n,
  }));
  const offspringSynapses: SynapseExport[] = motherExport.synapses.map((
    s,
  ) => ({ ...s }));

  // 3. Map old subgraph UUIDs to new UUIDs for the transplanted neurons
  const uuidMap = new Map<string, string>();
  for (const oldUuid of subgraph.neuronUuids) {
    uuidMap.set(oldUuid, crypto.randomUUID());
  }

  // Find donor neuron data for transplanted neurons
  const donorNeuronMap = new Map<string, NeuronExport>();
  for (const n of fatherExport.neurons) {
    if (n.uuid && subgraph.neuronUuids.includes(n.uuid)) {
      donorNeuronMap.set(n.uuid, n);
    }
  }

  // Determine insertion position: find the last hidden neuron position in
  // the offspring before output neurons
  let insertIndex = offspringNeurons.length;
  for (let i = offspringNeurons.length - 1; i >= 0; i--) {
    if (offspringNeurons[i].type === "output") {
      insertIndex = i;
    } else {
      break;
    }
  }

  // 4. Add transplanted neurons (with new UUIDs and transplant tags)
  const transplantedNeurons: NeuronExport[] = [];
  for (const oldUuid of subgraph.neuronUuids) {
    const donorNeuron = donorNeuronMap.get(oldUuid);
    if (!donorNeuron) continue;

    const newUuid = uuidMap.get(oldUuid)!;
    const newNeuron: NeuronExport = {
      type: "hidden",
      uuid: newUuid,
      squash: donorNeuron.squash,
      bias: donorNeuron.bias,
    };
    addTag(newNeuron, "approach", "transplant");
    transplantedNeurons.push(newNeuron);
  }

  // Insert transplanted neurons before output neurons
  offspringNeurons.splice(insertIndex, 0, ...transplantedNeurons);

  // 5. Add internal subgraph synapses (with remapped UUIDs)
  for (const syn of subgraph.internalSynapses) {
    const fromUUID = syn.fromUUID ? uuidMap.get(syn.fromUUID) : undefined;
    const toUUID = syn.toUUID ? uuidMap.get(syn.toUUID) : undefined;
    if (fromUUID && toUUID) {
      offspringSynapses.push({
        fromUUID,
        toUUID,
        weight: syn.weight,
        type: syn.type,
      });
    }
  }

  // 6. Connect boundary inputs: link mother's input neurons to the
  // transplanted subgraph's entry points
  // Find the first neuron in the subgraph (topologically) — the one that
  // receives external input
  const subgraphEntryUuids = findSubgraphEntries(subgraph, fatherExport);
  const subgraphExitUuids = findSubgraphExits(subgraph, fatherExport);

  // Connect inputs to subgraph entries
  for (const entryOldUuid of subgraphEntryUuids) {
    const entryNewUuid = uuidMap.get(entryOldUuid);
    if (!entryNewUuid) continue;

    // Find what inputs fed this neuron in the father
    for (const syn of fatherExport.synapses) {
      if (syn.toUUID !== entryOldUuid || !syn.fromUUID) continue;

      // If the source is an input neuron (input-N), connect it directly
      if (syn.fromUUID.startsWith("input-")) {
        offspringSynapses.push({
          fromUUID: syn.fromUUID,
          toUUID: entryNewUuid,
          weight: syn.weight * (0.3 + rng.random() * 0.4),
        });
      }
    }
  }

  // 7. Connect subgraph exits to mother's output-feeding neurons
  // Find a hidden neuron in the mother that connects to output, or directly
  // connect to output neurons
  const motherOutputFeedingUuids = findOutputFeedingNeurons(motherExport);

  for (const exitOldUuid of subgraphExitUuids) {
    const exitNewUuid = uuidMap.get(exitOldUuid);
    if (!exitNewUuid) continue;

    if (motherOutputFeedingUuids.length > 0) {
      // Connect to a random output-feeding neuron in the mother
      // Use output neurons directly since they come after hidden neurons
      const targetUuid = motherOutputFeedingUuids[
        Math.floor(rng.random() * motherOutputFeedingUuids.length)
      ];
      offspringSynapses.push({
        fromUUID: exitNewUuid,
        toUUID: targetUuid,
        weight: boundaryRandomWeight(rng) * 0.5,
      });
    }
  }

  // 8. Build and validate the offspring
  const offspringJson: CreatureExport = {
    input: motherExport.input,
    output: motherExport.output,
    neurons: offspringNeurons,
    synapses: offspringSynapses,
    forwardOnly: motherExport.forwardOnly,
  };

  let offspring: Creature;
  try {
    offspring = Creature.fromJSON(offspringJson);
    offspring.fix();
  } catch {
    return undefined;
  }

  // Validate the offspring
  try {
    if (mother.forwardOnly) {
      creatureValidate(offspring, { forwardOnly: true });
    } else {
      creatureValidate(offspring);
    }
  } catch {
    return undefined;
  }

  // Reject clones
  delete offspring.uuid;
  const childUUID = CreatureUtil.makeUUID(offspring);
  if (!childUUID) return undefined;

  CreatureUtil.makeUUID(mother);
  CreatureUtil.makeUUID(father);
  if (childUUID === mother.uuid || childUUID === father.uuid) {
    return undefined;
  }

  return offspring;
}

/**
 * Finds subgraph entry neurons — those that receive connections from outside.
 */
function findSubgraphEntries(
  subgraph: Subgraph,
  _donorExport: CreatureExport,
): string[] {
  // Entry neurons are those in the subgraph that have input boundary connections
  const neuronSet = new Set(subgraph.neuronUuids);
  const hasInternalInbound = new Set<string>();

  for (const syn of subgraph.internalSynapses) {
    if (syn.toUUID && neuronSet.has(syn.toUUID)) {
      hasInternalInbound.add(syn.toUUID);
    }
  }

  // Entries are neurons that don't have internal inbound connections
  // (they receive input from outside the subgraph)
  const entries = subgraph.neuronUuids.filter(
    (uuid) => !hasInternalInbound.has(uuid),
  );

  // If all neurons have internal inbound, return the first one
  return entries.length > 0 ? entries : [subgraph.neuronUuids[0]];
}

/**
 * Finds subgraph exit neurons — those that send connections to outside.
 */
function findSubgraphExits(
  subgraph: Subgraph,
  _donorExport: CreatureExport,
): string[] {
  const neuronSet = new Set(subgraph.neuronUuids);
  const hasInternalOutbound = new Set<string>();

  for (const syn of subgraph.internalSynapses) {
    if (syn.fromUUID && neuronSet.has(syn.fromUUID)) {
      hasInternalOutbound.add(syn.fromUUID);
    }
  }

  // Exits are neurons that don't feed other neurons inside the subgraph
  const exits = subgraph.neuronUuids.filter(
    (uuid) => !hasInternalOutbound.has(uuid),
  );

  return exits.length > 0
    ? exits
    : [subgraph.neuronUuids[subgraph.neuronUuids.length - 1]];
}

/**
 * Finds output neuron UUIDs in the mother that can receive transplant connections.
 */
function findOutputFeedingNeurons(motherExport: CreatureExport): string[] {
  const outputUuids: string[] = [];
  for (const n of motherExport.neurons) {
    if (n.type === "output" && typeof n.uuid === "string") {
      outputUuids.push(n.uuid);
    }
  }
  return outputUuids;
}

/**
 * Generates a small random weight for boundary connections.
 */
function boundaryRandomWeight(
  rng: { random: () => number },
): number {
  const scale = 0.5;
  const rawWeight = rng.random() * scale - scale / 2;
  const plank = 0.000_000_1;
  const weightUnit = Math.max(
    Math.round(Math.abs(rawWeight / plank)),
    1,
  );
  return Math.sign(rawWeight || 1) * weightUnit * plank;
}
