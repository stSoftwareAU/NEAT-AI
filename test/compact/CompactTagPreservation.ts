import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { compactCreature } from "@compact/CompactCreature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { cleanupOrphanedNeurons } from "@compact/OrphanedNeuronCleanup.ts";
import { mergeParallelIdentityBridges } from "@compact/ParallelIdentityMerge.ts";
import { mergeParallelBridges } from "@compact/ParallelBridgeMerge.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";

/** Public export omits integer ids; tests that assert on fromId/toId normalise first. */
function exportNormalised(creature: Creature): CreatureExport {
  const e = creature.exportJSON();
  normaliseCreatureExport(e);
  return e;
}

/**
 * Issue #1972: Compact operations were losing tags on synapses and neurons.
 *
 * These tests verify that tags are preserved (or merged) when compact
 * operations create new synapses, remove neurons, or merge structures.
 */

Deno.test("compact: COMPLEMENT bypass preserves synapse tags on new synapses", () => {
  // Arrange: A COMPLEMENT neuron with tagged inbound and outbound synapses.
  // When bypassed, the new direct synapse should carry merged tags.
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "complement-0",
        squash: "COMPLEMENT",
        bias: 0,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "complement-0",
        weight: 0.5,
        tags: [{ name: "source", value: "training-data" }],
      },
      {
        fromUUID: "complement-0",
        toUUID: "output-0",
        weight: 0.8,
        tags: [{ name: "layer", value: "output-link" }],
      },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);

  // Act: COMPLEMENT bypass should remove complement-0 and create a direct synapse
  const compacted = compactCreature(creature, false);
  assert(compacted, "COMPLEMENT neuron should be bypassed");

  // Assert: The new direct synapse should have merged tags from both original synapses
  const exported = compacted.exportJSON();
  const directSynapse = exported.synapses.find(
    (s) => s.fromUUID === "input-0" && s.toUUID === "output-0",
  );
  assert(directSynapse, "Direct synapse should exist after bypass");
  assert(directSynapse.tags, "Tags should be preserved on bypassed synapse");
  assertEquals(directSynapse.tags.length, 2);

  const sourceTag = directSynapse.tags.find((t) => t.name === "source");
  assert(sourceTag, "Source tag from inbound synapse should be preserved");
  assertEquals(sourceTag.value, "training-data");

  const layerTag = directSynapse.tags.find((t) => t.name === "layer");
  assert(layerTag, "Layer tag from outbound synapse should be preserved");
  assertEquals(layerTag.value, "output-link");
});

Deno.test("compact: COMPLEMENT bypass merges tags when adding to existing synapse", () => {
  // Arrange: A COMPLEMENT neuron where bypass would add weight to an
  // already-existing direct synapse. Tags from the bypassed path should
  // be merged into the existing synapse.
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "complement-0",
        squash: "COMPLEMENT",
        bias: 0,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "complement-0",
        weight: 0.5,
        tags: [{ name: "path", value: "complement" }],
      },
      {
        fromUUID: "complement-0",
        toUUID: "output-0",
        weight: 0.8,
      },
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 0.3,
        tags: [{ name: "path", value: "direct" }],
      },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);

  // Act: COMPLEMENT bypass should fold weight into existing direct synapse
  const compacted = compactCreature(creature, false);
  assert(compacted, "COMPLEMENT neuron should be bypassed");

  // Assert: Existing synapse should have merged tags
  const exported = compacted.exportJSON();
  const directSynapse = exported.synapses.find(
    (s) => s.fromUUID === "input-0" && s.toUUID === "output-0",
  );
  assert(directSynapse, "Direct synapse should exist after bypass");
  assert(directSynapse.tags, "Tags should be merged on existing synapse");

  const directTag = directSynapse.tags.find(
    (t) => t.name === "path" && t.value === "direct",
  );
  assert(directTag, "Original direct tag should be preserved");

  const complementTag = directSynapse.tags.find(
    (t) => t.name === "path" && t.value === "complement",
  );
  assert(complementTag, "Complement path tag should be merged in");
});

Deno.test("compact: IDENTITY chain merge preserves synapse tags", () => {
  // Arrange: An IDENTITY chain where hidden-1 is merged (hidden-0 and
  // hidden-1 both IDENTITY, hidden-1 has 1 in + 1 out). The merge creates
  // a new synapse hidden-0->output-0, which should carry merged tags from
  // both hidden-0->hidden-1 (inConn) and hidden-1->output-0 (outConn).
  // Note: hidden-0 cannot be merged because its fromNeuron is an input
  // (not in neuronMap).
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        squash: "IDENTITY",
        bias: 0,
      },
      {
        type: "hidden",
        uuid: "hidden-1",
        squash: "IDENTITY",
        bias: 0,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 1.0,
      },
      {
        fromUUID: "hidden-0",
        toUUID: "hidden-1",
        weight: 1.0,
        tags: [{ name: "chain", value: "bridge" }],
      },
      {
        fromUUID: "hidden-1",
        toUUID: "output-0",
        weight: 1.0,
        tags: [{ name: "layer", value: "to-output" }],
      },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);

  // Act: IDENTITY chain should be merged (hidden-1 removed)
  const compacted = compactCreature(creature, false);
  assert(compacted, "IDENTITY chain should compact");

  // Assert: The merged synapse should carry tags from
  // both the inConn and outConn that were merged.
  const exported = compacted.exportJSON();
  const mergedSynapse = exported.synapses.find(
    (s) => s.fromUUID === "hidden-0" && s.toUUID === "output-0",
  );
  assert(mergedSynapse, "Merged synapse should exist");
  assert(mergedSynapse.tags, "Tags should be preserved on merged synapse");

  const chainTag = mergedSynapse.tags.find((t) => t.name === "chain");
  assert(chainTag, "Chain tag from inConn should be preserved");

  const layerTag = mergedSynapse.tags.find((t) => t.name === "layer");
  assert(layerTag, "Layer tag from outConn should be preserved");
});

Deno.test("compact: orphaned neuron conversion to constant preserves neuron tags", () => {
  // Arrange: A hidden neuron with tags but no inward connections (orphaned).
  // When converted to a constant, tags should be preserved.
  const creatureExport: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "orphan-0",
        squash: "IDENTITY",
        bias: 0.5,
        tags: [{ name: "purpose", value: "bias-source" }],
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // orphan-0 has outward but no inward connections -> will be converted to constant
      { fromUUID: "orphan-0", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
    input: 1,
    output: 1,
  };

  // Act: Clean up orphaned neurons
  const result = cleanupOrphanedNeurons(creatureExport);

  // Assert: The neuron should be converted to constant with tags preserved.
  assertEquals(result.converted, 1, "One neuron should be converted");
  const convertedNeuron = creatureExport.neurons.find(
    (n) => n.type === "constant",
  );
  assert(convertedNeuron, "Converted neuron should exist");
  assertEquals(convertedNeuron.type, "constant");
  assert(convertedNeuron.tags, "Tags should be preserved after conversion");
  assertEquals(convertedNeuron.tags.length, 1);
  assertEquals(convertedNeuron.tags[0].name, "purpose");
  assertEquals(convertedNeuron.tags[0].value, "bias-source");
});

Deno.test("compact: parallel IDENTITY bridge merge preserves neuron tags on kept neuron", () => {
  // Arrange: Two parallel IDENTITY bridge neurons feeding the same target.
  // The kept neuron's tags should be preserved, and tags from merged neurons
  // should be merged onto the kept neuron.
  const exported: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "bridge-A",
        squash: "IDENTITY",
        bias: 0,
        tags: [{ name: "role", value: "primary" }],
      },
      {
        type: "hidden",
        uuid: "bridge-B",
        squash: "IDENTITY",
        bias: 0,
        tags: [{ name: "role", value: "secondary" }],
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "bridge-A", weight: 0.5 },
      { fromUUID: "bridge-A", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "input-1", toUUID: "bridge-B", weight: 0.3 },
      { fromUUID: "bridge-B", toUUID: "output-0", weight: 1.0 },
    ],
    input: 2,
    output: 1,
  };

  // mergeParallelIdentityBridges does not call normaliseCreatureExport,
  // so populate integer IDs before calling.
  normaliseCreatureExport(exported);

  // Act
  const result = mergeParallelIdentityBridges(exported);
  assertEquals(result.removedNeurons, 1, "One neuron should be removed");

  // Assert: The kept neuron (bridge-A) should have merged tags.
  const keptNeuron = exported.neurons.find(
    (n) => (n as { uuid?: string }).uuid === "bridge-A",
  );
  assert(keptNeuron, "Kept neuron should exist");
  assert(keptNeuron.tags, "Kept neuron should have tags");

  const primaryTag = keptNeuron.tags.find(
    (t) => t.name === "role" && t.value === "primary",
  );
  assert(primaryTag, "Primary role tag should be preserved");

  const secondaryTag = keptNeuron.tags.find(
    (t) => t.name === "role" && t.value === "secondary",
  );
  assert(
    secondaryTag,
    "Secondary role tag should be merged from removed neuron",
  );
});

Deno.test("compact: parallel bridge merge preserves neuron tags on kept neuron", () => {
  // Arrange: Two parallel COMPLEMENT bridge neurons feeding the same target.
  const exported: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "bridge-A",
        squash: "COMPLEMENT",
        bias: 0,
        tags: [{ name: "variant", value: "alpha" }],
      },
      {
        type: "hidden",
        uuid: "bridge-B",
        squash: "COMPLEMENT",
        bias: 0,
        tags: [{ name: "variant", value: "beta" }],
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "bridge-A", weight: 0.5 },
      { fromUUID: "bridge-A", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "input-1", toUUID: "bridge-B", weight: 0.3 },
      { fromUUID: "bridge-B", toUUID: "output-0", weight: 1.0 },
    ],
    input: 2,
    output: 1,
  };

  // Act (mergeParallelBridges calls normaliseCreatureExport internally)
  const result = mergeParallelBridges(exported);
  assertEquals(result.removedNeurons, 1, "One neuron should be removed");

  // Assert: The kept neuron (bridge-A) should have merged tags.
  const keptNeuron = exported.neurons.find(
    (n) => (n as { uuid?: string }).uuid === "bridge-A",
  );
  assert(keptNeuron, "Kept neuron should exist");
  assert(keptNeuron.tags, "Kept neuron should have tags");

  const alphaTag = keptNeuron.tags.find(
    (t) => t.name === "variant" && t.value === "alpha",
  );
  assert(alphaTag, "Alpha tag should be preserved on kept neuron");

  const betaTag = keptNeuron.tags.find(
    (t) => t.name === "variant" && t.value === "beta",
  );
  assert(betaTag, "Beta tag should be merged from removed neuron");
});

Deno.test("compact: parallel IDENTITY bridge merge preserves synapse tags", () => {
  // Arrange: Two parallel IDENTITY bridge neurons with tagged synapses.
  const exported: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "bridge-A",
        squash: "IDENTITY",
        bias: 0,
      },
      {
        type: "hidden",
        uuid: "bridge-B",
        squash: "IDENTITY",
        bias: 0,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "bridge-A",
        weight: 0.5,
        tags: [{ name: "channel", value: "A" }],
      },
      { fromUUID: "bridge-A", toUUID: "output-0", weight: 1.0 },
      {
        fromUUID: "input-1",
        toUUID: "bridge-B",
        weight: 0.3,
        tags: [{ name: "channel", value: "B" }],
      },
      { fromUUID: "bridge-B", toUUID: "output-0", weight: 1.0 },
    ],
    input: 2,
    output: 1,
  };

  // mergeParallelIdentityBridges does not call normaliseCreatureExport,
  // so populate integer IDs before calling.
  normaliseCreatureExport(exported);

  // Act
  const result = mergeParallelIdentityBridges(exported);
  assertEquals(result.removedNeurons, 1, "One neuron should be removed");

  // Assert: Both inbound synapses should retain their tags.
  // (bridge-B's inbound synapse is redirected to bridge-A, preserving tags)
  const bridgeAId = exported.neurons.find(
    (n) => (n as { uuid?: string }).uuid === "bridge-A",
  )!.id!;
  const synapseA = exported.synapses.find(
    (s) => s.fromId === 0 && s.toId === bridgeAId,
  );
  assert(synapseA, "Synapse from input-0 should exist");
  assert(synapseA.tags, "Synapse A tags should be preserved");
  assertEquals(synapseA.tags[0].name, "channel");
  assertEquals(synapseA.tags[0].value, "A");

  const redirectedSynapse = exported.synapses.find(
    (s) => s.fromId === 1 && s.toId === bridgeAId,
  );
  assert(redirectedSynapse, "Redirected synapse should exist");
  assert(
    redirectedSynapse.tags,
    "Redirected synapse tags should be preserved",
  );
  assertEquals(redirectedSynapse.tags[0].name, "channel");
  assertEquals(redirectedSynapse.tags[0].value, "B");
});

Deno.test("compact: COMPLEMENT bypass preserves neuron tags on remaining neurons", () => {
  // Arrange: A creature where a COMPLEMENT neuron is bypassed, but the
  // downstream neuron has tags that should not be lost.
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "complement-0",
        squash: "COMPLEMENT",
        bias: 0,
      },
      {
        type: "output",
        uuid: "output-0",
        squash: "IDENTITY",
        bias: 0,
        tags: [{ name: "role", value: "final-output" }],
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "complement-0", weight: 0.5 },
      { fromUUID: "complement-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);

  // Act
  const compacted = compactCreature(creature, false);
  assert(compacted, "COMPLEMENT neuron should be bypassed");

  // Assert: Output neuron tags should be preserved.
  // Issue #1958: Use integer IDs (output-0 = -1).
  const exported = exportNormalised(compacted);
  const outputNeuron = exported.neurons.find((n) => n.id === -1);
  assert(outputNeuron, "Output neuron should exist");
  assert(outputNeuron.tags, "Output neuron tags should be preserved");
  assertEquals(outputNeuron.tags[0].name, "role");
  assertEquals(outputNeuron.tags[0].value, "final-output");
});
