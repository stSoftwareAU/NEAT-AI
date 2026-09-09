/**
 * @module
 *
 * Finds the **serial chains** in a creature's topology — maximal runs of
 * consecutive depth levels that hold exactly one neuron each, where the neuron
 * at depth `d` feeds the neuron at depth `d + 1`.
 *
 * Issue #3972: a serial chain is the structure that makes gradient loss
 * unrecoverable. Anywhere else in the network a neuron has depth-parallel
 * siblings, so a saturated activation on one route still leaves the others
 * carrying signal. Inside a serial chain there is no second route: a single
 * zero derivative anywhere along it zeroes the gradient for every member
 * upstream of it, for that sample. Depth comes from
 * {@link computeLayerAssignments}, so the chains reported here are bucketed the
 * same way {@link probeGradientDepth} buckets its measurements.
 *
 * The chain condition is deliberately about *depth occupancy*, not fan-out. A
 * member may have fan-out greater than one — the GRQ creature has members that
 * also short-circuit to the output — and still be the only neuron at its
 * depth, which is what removes the depth-parallel alternative.
 */

import type { Creature } from "@creature";
import { computeLayerAssignments } from "@propagate/LayerAssignment.ts";

/** One member of a serial chain. */
export interface SerialChainMember {
  /** Index into `creature.neurons`. */
  index: number;
  /** Longest path from an input, as {@link computeLayerAssignments} sees it. */
  depth: number;
  /** The neuron's squash name, or `undefined` for a constant neuron. */
  squash?: string;
  /** Number of inward synapses. */
  fanIn: number;
  /** Number of outward synapses. */
  fanOut: number;
}

/** A maximal run of single-occupancy, directly connected depth levels. */
export interface SerialChain {
  /** Depth of the first member. */
  startDepth: number;
  /** Depth of the last member. */
  endDepth: number;
  /** Members ordered shallowest to deepest; length is at least two. */
  members: SerialChainMember[];
}

function describe(creature: Creature, index: number, depth: number) {
  const neuron = creature.neurons[index];
  return {
    index,
    depth,
    squash: neuron.squash,
    fanIn: creature.inwardConnections(index).length,
    fanOut: creature.outwardConnections(index).length,
  };
}

/**
 * Find every serial chain in the creature, ordered by increasing start depth.
 *
 * A chain needs at least two members — a lone single-occupancy depth level is
 * not a chain, because the gradient still has a choice of route on both sides
 * of it.
 *
 * @param creature The creature whose topology to analyse.
 * @returns The chains found; empty when the topology has no single-file run.
 */
export function findSerialChains(creature: Creature): SerialChain[] {
  const layers = computeLayerAssignments(creature);
  const maxDepth = Math.max(...layers.keys());

  // The single occupant of each depth, or -1 when the depth is shared/empty.
  // Depth 0 is never a member: it holds the inputs and constants, which have
  // nothing upstream of them for a lost gradient to matter to.
  const soleOccupant = new Int32Array(maxDepth + 1).fill(-1);
  for (const [depth, indexes] of layers) {
    if (depth > 0 && indexes.length === 1) {
      soleOccupant[depth] = indexes[0];
    }
  }

  const chains: SerialChain[] = [];
  let current: SerialChainMember[] = [];

  for (let depth = 2; depth <= maxDepth; depth++) {
    const here = soleOccupant[depth];
    const previous = soleOccupant[depth - 1];
    const linked = here >= 0 && previous >= 0 &&
      creature.getSynapses(previous, here).length > 0;

    if (!linked) {
      if (current.length >= 2) {
        chains.push({
          startDepth: current[0].depth,
          endDepth: current[current.length - 1].depth,
          members: current,
        });
      }
      current = [];
      continue;
    }

    if (current.length === 0) {
      current.push(describe(creature, previous, depth - 1));
    }
    current.push(describe(creature, here, depth));
  }

  if (current.length >= 2) {
    chains.push({
      startDepth: current[0].depth,
      endDepth: current[current.length - 1].depth,
      members: current,
    });
  }

  return chains;
}

/**
 * The longest chain found by {@link findSerialChains}, or `undefined` when the
 * creature has none. Ties are broken by the deeper chain, which is the one the
 * gradient has to survive the most hops to reach.
 */
export function longestSerialChain(
  creature: Creature,
): SerialChain | undefined {
  let best: SerialChain | undefined;
  for (const chain of findSerialChains(creature)) {
    const length = chain.members.length;
    if (
      best === undefined ||
      length > best.members.length ||
      (length === best.members.length && chain.endDepth > best.endDepth)
    ) {
      best = chain;
    }
  }
  return best;
}

/**
 * The hidden members of a chain, shallowest first, stopping at the first
 * non-hidden member.
 *
 * {@link findSerialChains} includes the output neuron when a chain ends there,
 * but an output is not part of the *run* — it is the neuron the run feeds. The
 * skip operator (#3973) and the depth-aware squash bias (#3974) both measure a
 * run this way, so the definition lives here and neither keeps a copy.
 *
 * @param creature The creature the chain belongs to.
 * @param chain The chain to trim.
 * @returns Neuron indices of the hidden members, shallowest first.
 */
export function hiddenRunMembers(
  creature: Creature,
  chain: SerialChain,
): number[] {
  const run: number[] = [];
  for (const member of chain.members) {
    if (creature.neurons[member.index].type !== "hidden") break;
    run.push(member.index);
  }
  return run;
}

/**
 * Length of the hidden serial run the neuron at `neuronIndex` belongs to.
 *
 * Issue #3974: `ModSquash`'s depth-aware bias needs one fact about the neuron
 * it is about to re-squash — how long the single-file run it sits in is —
 * counted the way {@link hiddenRunMembers} counts it, so `deepChainMinLength`
 * and #3973's `skipMinRunLength` mean the same thing by "a run of four".
 *
 * @param creature The creature whose topology to analyse.
 * @param neuronIndex Index into `creature.neurons`.
 * @returns The hidden-member count of the run containing that neuron, or `0`
 *   when the neuron is not in one — an output neuron included, because the run
 *   feeds it rather than containing it.
 */
export function hiddenRunLengthAt(
  creature: Creature,
  neuronIndex: number,
): number {
  for (const chain of findSerialChains(creature)) {
    const run = hiddenRunMembers(creature, chain);
    if (run.includes(neuronIndex)) return run.length;
  }
  return 0;
}
