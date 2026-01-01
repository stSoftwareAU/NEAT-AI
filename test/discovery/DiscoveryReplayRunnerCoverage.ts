import { assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type {
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { RemovalCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type { SplitSynapseInsertNeuronCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/SplitSynapseInsertNeuronCandidate.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import { DiscoveryReplayRunner } from "../../src/discovery/DiscoveryReplayRunner.ts";
import type { SuccessCacheEntry } from "../../src/discovery/SuccessCache.ts";

function makeEntry(
  key: string,
  changeType: string,
  rustRequest: Record<string, unknown>,
): SuccessCacheEntry {
  return {
    key,
    changeType,
    description: key,
    originalScore: 0.5,
    candidateScore: 0.6,
    scoreDelta: 0.1,
    originalError: 1,
    error: 0.9,
    timestamp: new Date().toISOString(),
    rustRequest,
  };
}

Deno.test("DiscoveryReplayRunner: default applyEntry replays singles, then all-successful combo, returning best", async () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
    ],
  });
  creature.uuid = "base";

  const addSynapse: CandidateSynapse = {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "output-0",
    weight: 0.5,
    targetNeuronImpact: 1,
    expectedCreatureErrorReduction: 0.01,
    expectedCreatureScoreGain: 0.01,
    improvedCount: 1,
    totalCount: 1,
    comment: "replay-test",
  };

  const changeSquash: CandidateSquash = {
    neuronUUID: "hidden-0",
    previousSquash: IDENTITY.NAME,
    squash: TANH.NAME,
    expectedCreatureScoreGain: 0.01,
    improvedError: 0.9,
    currentError: 1.0,
    comment: "replay-test",
  };

  const eAdd = makeEntry("add", "add-synapses", {
    synapseCandidate: addSynapse,
  });
  const eSquash = makeEntry("squash", "change-squash", {
    squashCandidate: changeSquash,
  });

  const archived: string[] = [];
  const runner = new DiscoveryReplayRunner({
    listEntries: () => [eAdd, eSquash],
    archiveEntry: (_dir, entry) => archived.push(entry.key),
    // Use the default applyEntryUsingRustRequest by not overriding applyEntry.
    evaluateError: (c) => {
      const exported = c.exportJSON();
      const hasDirect = exported.synapses.some((s) =>
        s.fromUUID === "input-0" && s.toUUID === "output-0"
      );
      const hidden0 = c.neurons.find((n) => n.uuid === "hidden-0");
      const hasTanh = hidden0?.squash === TANH.NAME;

      // Baseline: 0.5
      // Add synapse only: 0.6
      // Change squash only: 0.61
      // Both (combo): 0.7
      const score = hasDirect && hasTanh
        ? 0.7
        : hasTanh
        ? 0.61
        : hasDirect
        ? 0.6
        : 0.5;
      return Promise.resolve({ error: 0, score });
    },
  });

  const result = await runner.replayDir({
    creature,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      discoveryReplayMaxSingles: 10,
      discoveryReplayMaxPairwise: 10,
      discoveryReplayMaxTriples: 10,
      threads: 1,
    },
  });

  assertEquals(result.evaluatedSingles, 2);
  assertEquals(result.pruned, 0);
  assertEquals(archived.length, 0);

  assertExists(result.improvement);
  assertEquals(result.improvement.changeType, "combo-successful");
  assertEquals(result.improvement.score, 0.7);
});

Deno.test("DiscoveryReplayRunner: skips already-applied add-synapses candidates", async () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature.uuid = "base";

  const addSynapse: CandidateSynapse = {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "output-0",
    weight: 0.5,
    targetNeuronImpact: 1,
    expectedCreatureErrorReduction: 0.01,
    expectedCreatureScoreGain: 0.01,
    improvedCount: 1,
    totalCount: 1,
  };

  const entry = makeEntry("already", "add-synapses", {
    synapseCandidate: addSynapse,
  });
  const runner = new DiscoveryReplayRunner({
    listEntries: () => [entry],
    evaluateError: () => Promise.resolve({ error: 0, score: 0.5 }),
  });

  const result = await runner.replayDir({
    creature,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      threads: 1,
    },
  });

  assertEquals(result.skippedAlreadyApplied, 1);
  assertEquals(result.evaluatedSingles, 0);
  assertEquals(result.improvement, undefined);
});

Deno.test("DiscoveryReplayRunner: prunes stale candidates (remove-low-impact + remove-synapse synapseDetails fallback)", async () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", squash: IDENTITY.NAME, bias: 0.25, uuid: "neuron-X" },
      { type: "hidden", squash: IDENTITY.NAME, bias: -0.1, uuid: "neuron-T" },
      { type: "output", squash: IDENTITY.NAME, bias: 0.05, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "neuron-X", weight: 1.0 },
      { fromUUID: "neuron-X", toUUID: "neuron-T", weight: -1.2 },
      { fromUUID: "neuron-X", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "neuron-T", toUUID: "output-0", weight: 0.25 },
      { fromUUID: "input-1", toUUID: "output-0", weight: -0.25 },
    ],
  });
  creature.uuid = "base";

  const removal: RemovalCandidate = {
    neuronUUID: "neuron-X",
    totalError: 1,
    impact: 0.0001,
    reason: "test",
    meanActivation: 0.4,
  };

  const removeSynapseDetails = {
    fromNeuronUUID: "neuron-T",
    toNeuronUUID: "output-0",
  };

  const eRemoval = makeEntry("low-impact", "remove-low-impact", {
    removalCandidate: removal,
  });
  const eRemoveSyn = makeEntry("rm-syn", "remove-synapse", {
    synapseDetails: removeSynapseDetails,
  });

  const archived: string[] = [];
  const runner = new DiscoveryReplayRunner({
    listEntries: () => [eRemoval, eRemoveSyn],
    archiveEntry: (_dir, entry) => archived.push(entry.key),
    evaluateError: (c) => {
      // If we removed neuron-X or removed neuron-T->output-0, call it worse.
      const exported = c.exportJSON();
      const hasX = c.neurons.some((n) => n.uuid === "neuron-X");
      const hasTSyn = exported.synapses.some((s) =>
        s.fromUUID === "neuron-T" && s.toUUID === "output-0"
      );
      const score = hasX && hasTSyn ? 0.5 : 0.4;
      return Promise.resolve({ error: 0, score });
    },
  });

  const result = await runner.replayDir({
    creature,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      threads: 1,
    },
  });

  assertEquals(result.pruned, 2);
  assertEquals(archived.sort(), ["low-impact", "rm-syn"].sort());
  assertEquals(result.improvement, undefined);
});

Deno.test("DiscoveryReplayRunner: add-neurons already-applied detection matches exponent buckets", async () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "added-1", type: "hidden", squash: IDENTITY.NAME, bias: 0.001 }, // e-3
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "added-1", weight: 0.12 }, // e-1
      { fromUUID: "added-1", toUUID: "output-0", weight: 0.34 }, // e-1
    ],
  });
  creature.uuid = "base";

  const neuronDetails = {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "output-0",
    incomingWeight: 0.12,
    outgoingWeight: 0.34,
    bias: 0.001,
    squash: IDENTITY.NAME,
  };

  const neuronCandidate: CandidateNeuron = {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "output-0",
    incomingWeight: 0.12,
    outgoingWeight: 0.34,
    squash: IDENTITY.NAME,
    bias: 0.001,
    targetNeuronImpact: 1,
    expectedCreatureErrorReduction: 0.01,
    expectedCreatureScoreGain: 0.01,
    improvedCount: 1,
    totalCount: 1,
  };

  const entry = makeEntry("n", "add-neurons", {
    neuronDetails,
    neuronCandidate,
  });

  const runner = new DiscoveryReplayRunner({
    listEntries: () => [entry],
    evaluateError: () => Promise.resolve({ error: 0, score: 0.5 }),
  });

  const result = await runner.replayDir({
    creature,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      threads: 1,
    },
  });

  assertEquals(result.skippedAlreadyApplied, 1);
  assertEquals(result.evaluatedSingles, 0);
});

Deno.test("DiscoveryReplayRunner: split-synapse candidate can be replayed", async () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
    ],
  });
  creature.uuid = "base";

  const split: SplitSynapseInsertNeuronCandidate = {
    type: "split_synapse_insert_neuron",
    fromNeuronUuid: "hidden-0",
    toNeuronUuid: "output-0",
    oldWeight: 0.25,
    newNeuron: {
      uuid: "hidden-split-0",
      type: "hidden",
      squash: IDENTITY.NAME,
      bias: 0,
    },
    newSynapses: [
      { from_uuid: "hidden-0", to_uuid: "hidden-split-0", weight: 0.6 },
      { from_uuid: "hidden-split-0", to_uuid: "output-0", weight: 0.7 },
    ],
    expectedCreatureScoreGain: 0.01,
  };

  const entry = makeEntry("split", "split-synapse-insert-neuron", {
    splitSynapseInsertNeuronCandidate: split,
  });

  const runner = new DiscoveryReplayRunner({
    listEntries: () => [entry],
    evaluateError: (c) => {
      const hasSplit = c.neurons.some((n) => n.uuid === "hidden-split-0");
      return Promise.resolve({ error: 0, score: hasSplit ? 0.6 : 0.5 });
    },
  });

  const result = await runner.replayDir({
    creature,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      threads: 1,
    },
  });

  assertExists(result.improvement);
  assertEquals(result.improvement.changeType, "split-synapse-insert-neuron");
});
