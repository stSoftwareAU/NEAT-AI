/**
 * Replays `test/fixtures/depth/` against `computeLayerAssignments`.
 *
 * Issue #3972 — a per-depth gradient profile is only comparable across engines
 * if the engines agree on what "depth" means first. This corpus is the
 * executable definition NEAT-AI-core and NEAT-AI-Backpropagation port against;
 * this runner is the TypeScript half, so any drift in the reference
 * implementation fails on the offending case name rather than silently
 * invalidating a measured profile.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { computeLayerAssignments } from "@propagate/LayerAssignment.ts";
import { longestSerialChain } from "@propagate/SerialChains.ts";

interface TopologyCase {
  name: string;
  notes: string;
  creature: CreatureExport;
  expect: { depth: Record<string, number>; maxDepth: number };
}

/** Depth per neuron, keyed the way the corpus keys it. */
function depthByUuid(creature: Creature): Record<string, number> {
  const depth: Record<string, number> = {};
  for (const [level, indexes] of computeLayerAssignments(creature)) {
    for (const index of indexes) {
      const neuron = creature.neurons[index];
      const key = neuron.type === "input" ? `input-${index}` : neuron.uuid!;
      depth[key] = level;
    }
  }
  return depth;
}

Deno.test("DepthBucketConformance - topology cases match computeLayerAssignments", async () => {
  const corpus: { cases: TopologyCase[] } = JSON.parse(
    await Deno.readTextFile("test/fixtures/depth/topology.json"),
  );
  assertEquals(corpus.cases.length > 0, true, "corpus must not be empty");

  for (const testCase of corpus.cases) {
    const creature = Creature.fromJSON(testCase.creature);
    const layers = computeLayerAssignments(creature);

    assertEquals(
      depthByUuid(creature),
      testCase.expect.depth,
      `case ${testCase.name}: per-neuron depth drifted`,
    );
    assertEquals(
      Math.max(...layers.keys()),
      testCase.expect.maxDepth,
      `case ${testCase.name}: maxDepth drifted`,
    );
  }
});

Deno.test("DepthBucketConformance - the GRQ creature bucket profile is frozen", async () => {
  const corpus = JSON.parse(
    await Deno.readTextFile("test/fixtures/depth/grq-tail.json"),
  );
  const creature = Creature.fromJSON(
    JSON.parse(await Deno.readTextFile(corpus.creatureFile)),
  );

  const layers = computeLayerAssignments(creature);
  const maxDepth = Math.max(...layers.keys());
  assertEquals(maxDepth, corpus.expect.maxDepth);
  assertEquals(creature.neurons.length, corpus.expect.neurons);
  assertEquals(creature.synapses.length, corpus.expect.synapses);

  const histogram: Record<string, number> = {};
  for (let d = 0; d <= maxDepth; d++) {
    histogram[String(d)] = (layers.get(d) ?? []).length;
  }
  assertEquals(histogram, corpus.expect.histogram);

  const chain = longestSerialChain(creature)!;
  assertEquals(chain.startDepth, corpus.expect.serialChain.startDepth);
  assertEquals(chain.endDepth, corpus.expect.serialChain.endDepth);
  assertEquals(
    chain.members.map((member) => ({
      uuid: creature.neurons[member.index].uuid,
      depth: member.depth,
      squash: member.squash,
      fanIn: member.fanIn,
      fanOut: member.fanOut,
    })),
    corpus.expect.serialChain.members,
  );
});
