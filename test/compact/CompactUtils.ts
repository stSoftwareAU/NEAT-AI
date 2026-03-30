import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  cleanupMemeticForRemovedNeuron,
  cleanupMemeticForRemovedSynapse,
  mergeDuplicateSynapses,
  pruneDeadSubgraphs,
  pruneZeroWeightSynapses,
} from "@compact/CompactUtils.ts";

Deno.test("mergeDuplicateSynapses - sums weights of duplicate synapses", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: -1, weight: 0.3 },
      { fromId: 0, toId: -1, weight: 0.5 },
      { fromId: 1, toId: -1, weight: 0.2 },
    ],
  };

  const result = mergeDuplicateSynapses(exported);
  assertEquals(result.merged, 1);
  assertEquals(exported.synapses.length, 2);

  const mergedSynapse = exported.synapses.find(
    (s) => s.fromId === 0,
  )!;
  assertEquals(mergedSynapse.weight, 0.8); // 0.3 + 0.5
});

Deno.test("mergeDuplicateSynapses - no duplicates returns zero merges", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: -1, weight: 0.3 },
      { fromId: 1, toId: -1, weight: 0.5 },
    ],
  };

  const result = mergeDuplicateSynapses(exported);
  assertEquals(result.merged, 0);
  assertEquals(exported.synapses.length, 2);
});

Deno.test(
  "mergeDuplicateSynapses - same from/to merges even when type differs (Issue #2086)",
  () => {
    const exported: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", id: -1, squash: "IF", bias: 0 },
      ],
      synapses: [
        {
          fromId: 0,
          toId: -1,
          weight: 0.3,
          type: "condition",
        },
        {
          fromId: 0,
          toId: -1,
          weight: 0.5,
          type: "positive",
        },
      ],
    };

    const result = mergeDuplicateSynapses(exported);
    assertEquals(result.merged, 1);
    assertEquals(exported.synapses.length, 1);
    assertEquals(exported.synapses[0].weight, 0.8);
    assertEquals(exported.synapses[0].type, "condition");
  },
);

Deno.test("mergeDuplicateSynapses - deletes memetic when merging occurs", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: -1, weight: 0.3 },
      { fromId: 0, toId: -1, weight: 0.5 },
    ],
    memetic: { generation: 1, score: 0, biases: {}, weights: {} },
  };

  mergeDuplicateSynapses(exported);
  assertEquals(exported.memetic, undefined);
});

Deno.test("pruneZeroWeightSynapses - removes zero-weight untyped synapses", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        id: 5000,
        squash: "LOGISTIC",
        bias: 0.5,
      },
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.3 },
      { fromId: 1, toId: 5000, weight: 0 },
      { fromId: 5000, toId: -1, weight: 0.7 },
    ],
  };

  const result = pruneZeroWeightSynapses(exported);
  assertEquals(result.removedSynapses, 1);
  assertEquals(exported.synapses.length, 2);
});

Deno.test("pruneZeroWeightSynapses - preserves typed zero-weight synapses", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IF", bias: 0 },
    ],
    synapses: [
      {
        fromId: 0,
        toId: -1,
        weight: 0,
        type: "condition",
      },
      {
        fromId: 1,
        toId: -1,
        weight: 0.5,
        type: "positive",
      },
    ],
  };

  const result = pruneZeroWeightSynapses(exported);
  assertEquals(result.removedSynapses, 0);
  assertEquals(exported.synapses.length, 2);
});

Deno.test("pruneZeroWeightSynapses - preserves last inbound to output", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: -1, weight: 0 },
    ],
  };

  const result = pruneZeroWeightSynapses(exported);
  // Should keep the zero-weight synapse as it's the only inbound to output
  assertEquals(result.removedSynapses, 0);
  assertEquals(exported.synapses.length, 1);
});

Deno.test("pruneZeroWeightSynapses - removes non-finite weight synapses", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: -1, weight: Infinity },
      { fromId: 1, toId: -1, weight: 0.5 },
    ],
  };

  const result = pruneZeroWeightSynapses(exported);
  assertEquals(result.removedSynapses, 1);
  assertEquals(exported.synapses.length, 1);
});

Deno.test("pruneDeadSubgraphs - removes neurons with no path to output", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "dead-h",
        id: 5000,
        squash: "LOGISTIC",
        bias: 0.1,
      },
      {
        type: "hidden",
        uuid: "alive-h",
        id: 5001,
        squash: "LOGISTIC",
        bias: 0.2,
      },
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // dead-h has inbound but no path to output
      { fromId: 0, toId: 5000, weight: 0.3 },
      // alive-h has a path to output
      { fromId: 1, toId: 5001, weight: 0.4 },
      { fromId: 5001, toId: -1, weight: 0.5 },
    ],
  };

  const result = pruneDeadSubgraphs(exported);
  assertEquals(result.removedNeurons, 1);
  assert(result.removedSynapses >= 1);
  assertEquals(exported.neurons.length, 2); // alive-h + output-0
});

Deno.test("pruneDeadSubgraphs - no dead neurons returns zero counts", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", id: 5000, squash: "LOGISTIC", bias: 0.1 },
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5000, weight: 0.3 },
      { fromId: 5000, toId: -1, weight: 0.5 },
    ],
  };

  const result = pruneDeadSubgraphs(exported);
  assertEquals(result.removedNeurons, 0);
  assertEquals(result.removedSynapses, 0);
});

Deno.test("cleanupMemeticForRemovedSynapse - deletes memetic when synapse is referenced", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
    memetic: {
      generation: 1,
      score: 0,
      biases: {},
      weights: {
        0: [{ toId: -1, weight: 0.1 }],
      },
    },
  };

  cleanupMemeticForRemovedSynapse(exported, 0, -1);
  assertEquals(exported.memetic, undefined);
});

Deno.test("cleanupMemeticForRemovedSynapse - preserves memetic when synapse not referenced", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
    memetic: {
      generation: 1,
      score: 0,
      biases: {},
      weights: {
        0: [{ toId: -1, weight: 0.1 }],
      },
    },
  };

  cleanupMemeticForRemovedSynapse(exported, 9768, -1);
  assert(exported.memetic !== undefined);
});

Deno.test("cleanupMemeticForRemovedSynapse - handles missing memetic gracefully", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
  };

  cleanupMemeticForRemovedSynapse(exported, 0, -1);
  assertEquals(exported.memetic, undefined, "Memetic should remain absent");
  assertEquals(exported.synapses.length, 0, "Synapses should be unchanged");
});

Deno.test("cleanupMemeticForRemovedNeuron - deletes memetic when neuron is in weights", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
    memetic: {
      generation: 1,
      score: 0,
      biases: {},
      weights: {
        5001: [{ toId: -1, weight: 0.1 }],
      },
    },
  };

  cleanupMemeticForRemovedNeuron(exported, 5001);
  assertEquals(exported.memetic, undefined);
});

Deno.test("cleanupMemeticForRemovedNeuron - deletes memetic when neuron is a weight target", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
    memetic: {
      generation: 1,
      score: 0,
      biases: {},
      weights: {
        0: [{ toId: 5001, weight: 0.1 }],
      },
    },
  };

  cleanupMemeticForRemovedNeuron(exported, 5001);
  assertEquals(exported.memetic, undefined);
});

Deno.test("cleanupMemeticForRemovedNeuron - deletes memetic when neuron is in biases", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
    memetic: {
      generation: 1,
      score: 0,
      weights: {},
      biases: {
        5001: 0.1,
      },
    },
  };

  cleanupMemeticForRemovedNeuron(exported, 5001);
  assertEquals(exported.memetic, undefined);
});

Deno.test("cleanupMemeticForRemovedNeuron - preserves memetic when neuron not referenced", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
    memetic: {
      generation: 1,
      score: 0,
      biases: {},
      weights: {
        0: [{ toId: -1, weight: 0.1 }],
      },
    },
  };

  cleanupMemeticForRemovedNeuron(exported, 9429);
  assert(exported.memetic !== undefined);
});

Deno.test("cleanupMemeticForRemovedNeuron - handles missing memetic gracefully", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
  };

  cleanupMemeticForRemovedNeuron(exported, 5001);
  assertEquals(exported.memetic, undefined, "Memetic should remain absent");
  assertEquals(exported.neurons.length, 1, "Neurons should be unchanged");
});
