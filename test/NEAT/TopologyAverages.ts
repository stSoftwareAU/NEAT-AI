/**
 * Tests for the per-generation topology-average telemetry (Issue #3402).
 */

import { assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { computeTopologyAverages } from "@neat/TopologyAverages.ts";

/**
 * Build a creature with `hidden` hidden neurons and one output, each wired from
 * `input-0`. Neuron count is `hidden + output` (this project's `neurons` array
 * excludes the input placeholders when constructed from a UUID-only export, so
 * the assertions below use the resulting `creature.neurons.length`).
 */
function makeCreature(hidden: number): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  for (let i = 0; i < hidden; i++) {
    neurons.push({
      type: "hidden",
      uuid: `hidden-${i}`,
      squash: "TANH",
      bias: 0,
    });
    synapses.push({ fromUUID: "input-0", toUUID: `hidden-${i}`, weight: 0.5 });
    synapses.push({ fromUUID: `hidden-${i}`, toUUID: "output-0", weight: 0.5 });
  }
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });
  synapses.push({ fromUUID: "input-0", toUUID: "output-0", weight: 0.5 });

  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons,
    synapses,
  };
  return Creature.fromJSON(json);
}

Deno.test("computeTopologyAverages: single creature returns its own counts", () => {
  const creature = makeCreature(2);
  const averages = computeTopologyAverages([creature]);
  assertEquals(averages.averageNeurons, creature.neurons.length);
  assertEquals(averages.averageSynapses, creature.synapses.length);
});

Deno.test("computeTopologyAverages: averages across a population", () => {
  const small = makeCreature(1);
  const large = makeCreature(3);
  const averages = computeTopologyAverages([small, large]);

  const expectedNeurons = (small.neurons.length + large.neurons.length) / 2;
  const expectedSynapses = (small.synapses.length + large.synapses.length) / 2;
  assertEquals(averages.averageNeurons, expectedNeurons);
  assertEquals(averages.averageSynapses, expectedSynapses);
});

Deno.test("computeTopologyAverages: empty population yields zeroes, not NaN", () => {
  const averages = computeTopologyAverages([]);
  assertEquals(averages, { averageNeurons: 0, averageSynapses: 0 });
});

Deno.test("computeTopologyAverages: larger topology raises both averages", () => {
  const before = computeTopologyAverages([makeCreature(1)]);
  const after = computeTopologyAverages([makeCreature(5)]);
  // Both counts must strictly increase with topology size — this is the signal
  // the GRQ-19 memprofile line was missing (Issue #3402).
  assertEquals(after.averageNeurons > before.averageNeurons, true);
  assertEquals(after.averageSynapses > before.averageSynapses, true);
});
