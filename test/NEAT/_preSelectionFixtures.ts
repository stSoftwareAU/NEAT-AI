/**
 * Shared fixtures for the offspring pre-selection suites (Issue #3932).
 *
 * Every suite needs the same thing: candidate creatures that are structurally
 * distinct, so the surrogate's descriptor can tell them apart, and each
 * carrying a UUID so a screen rank can be looked up again.
 *
 * Not a test file itself — it declares no `Deno.test`.
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

/**
 * `count` structurally distinct forward-only creatures.
 *
 * Creature `i` carries `offset + i + 1` hidden neurons chained into the
 * output, so the descriptor's neuron, synapse and depth slots all separate
 * them. A creature's UUID is a hash of its structure, so two batches built at
 * the same offset are the *same* creatures as far as anything keyed on UUID is
 * concerned — pass a different offset for a batch that must be distinct.
 *
 * @param count - How many creatures to build.
 * @param offset - Hidden neurons added to every creature in the batch.
 * @returns The creatures, each with a UUID assigned.
 */
export function buildCandidates(count: number, offset = 0): Creature[] {
  const creatures: Creature[] = [];
  for (let i = 0; i < count; i++) {
    const neurons: CreatureExport["neurons"] = [];
    const synapses: CreatureExport["synapses"] = [];
    const hidden = offset + i + 1;
    for (let h = 0; h < hidden; h++) {
      neurons.push({
        type: "hidden",
        uuid: `hidden-${h}`,
        squash: "TANH",
        bias: 0.1 * (h + 1),
      });
      synapses.push({
        fromUUID: h === 0 ? "input-0" : `hidden-${h - 1}`,
        toUUID: `hidden-${h}`,
        weight: 0.25 + 0.05 * h,
      });
    }
    neurons.push({
      type: "output",
      uuid: "output-0",
      squash: "IDENTITY",
      bias: 0.1,
    });
    synapses.push({
      fromUUID: `hidden-${hidden - 1}`,
      toUUID: "output-0",
      weight: 0.8,
    });
    const creature = Creature.fromJSON({
      neurons,
      synapses,
      input: 2,
      output: 1,
      forwardOnly: true,
    });
    CreatureUtil.makeUUID(creature);
    creatures.push(creature);
  }
  return creatures;
}
