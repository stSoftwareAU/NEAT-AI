/**
 * Tests for accumulation count accuracy in topological backpropagation.
 *
 * Issue #1652 - Verifies that SynapseState.count and NeuronState.count
 * reflect the actual number of training samples processed, not the
 * number of downstream connections (fan-out). Previously, accumulation
 * was repeated `downstreamCount` times, which inflated counts and
 * distorted the weighted average in calculateWeight() and calculateBias().
 */

import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

Deno.test("AccumulationCounts - synapse count equals training samples not fan-out", () => {
  // Network: Input → H1 → Output-0
  //                     → Output-1
  //                     → Output-2
  //
  // The synapse Input→H1 should have count == number of training samples,
  // NOT count == samples × 3 (the downstream fan-out of H1).
  const json: CreatureExport = {
    input: 1,
    output: 3,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-2", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-2", weight: 1.0 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-12,
    maximumWeightAdjustmentScale: 10,
    maximumBiasAdjustmentScale: 10,
    disableRandomSamples: true,
    batchSize: 1000, // Large batch to prevent batch resets clearing counts.
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([1.1, 1.1, 1.1]);

  const samples = 5;
  for (let i = 0; i < samples; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }

  // Find the Input→H1 synapse connection state.
  // Input neuron index is 0, H1 is at index 1 (after input).
  const inputIndex = 0;
  const h1Index = creature.input; // First neuron after inputs.
  const cs = creature.state.connection(inputIndex, h1Index);

  // The synapse count should equal the number of training samples,
  // not samples × 3 (the downstream fan-out).
  assertEquals(
    cs.count,
    samples,
    `SynapseState.count should be ${samples} (training samples), ` +
      `not ${samples * 3} (inflated by fan-out). Got ${cs.count}`,
  );
});

Deno.test("AccumulationCounts - neuron bias count equals training samples not fan-out", () => {
  // Network: Input → H1 → Output-0
  //                     → Output-1
  //                     → Output-2
  //
  // H1's NeuronState.count should equal the number of training samples,
  // NOT samples × 3 (the downstream fan-out).
  const json: CreatureExport = {
    input: 1,
    output: 3,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-2", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-2", weight: 1.0 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-12,
    maximumWeightAdjustmentScale: 10,
    maximumBiasAdjustmentScale: 10,
    disableRandomSamples: true,
    batchSize: 1000,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([1.1, 1.1, 1.1]);

  const samples = 5;
  for (let i = 0; i < samples; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }

  // H1 is the first neuron after inputs.
  const h1Index = creature.input;
  const ns = creature.state.node(h1Index);

  assertEquals(
    ns.count,
    samples,
    `NeuronState.count should be ${samples} (training samples), ` +
      `not ${samples * 3} (inflated by fan-out). Got ${ns.count}`,
  );
});

Deno.test("AccumulationCounts - fan-out does not inflate counts vs single output", () => {
  // Compare a single-output network vs a triple-output network.
  // Both train for the same number of samples.
  // The Input→H1 synapse count should be identical in both cases.

  const singleJson: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.0 },
    ],
  };

  const tripleJson: CreatureExport = {
    input: 1,
    output: 3,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-2", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-2", weight: 1.0 },
    ],
  };

  const configOpts = {
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-12,
    maximumWeightAdjustmentScale: 10,
    maximumBiasAdjustmentScale: 10,
    disableRandomSamples: true,
    batchSize: 1000,
  };

  const samples = 10;
  const input = new Float32Array([1.0]);

  // Train single-output network.
  const singleCreature = Creature.fromJSON(singleJson);
  const singleConfig = createBackPropagationConfig(configOpts);
  const singleSparse = new SparseConfig(
    singleCreature.exportJSON(),
    singleConfig,
  );
  for (let i = 0; i < samples; i++) {
    singleCreature.activateAndTrace(input, false, singleSparse);
    singleCreature.propagate(
      new Float32Array([1.1]),
      singleConfig,
      singleSparse,
    );
  }

  // Train triple-output network.
  const tripleCreature = Creature.fromJSON(tripleJson);
  const tripleConfig = createBackPropagationConfig(configOpts);
  const tripleSparse = new SparseConfig(
    tripleCreature.exportJSON(),
    tripleConfig,
  );
  for (let i = 0; i < samples; i++) {
    tripleCreature.activateAndTrace(input, false, tripleSparse);
    tripleCreature.propagate(
      new Float32Array([1.1, 1.1, 1.1]),
      tripleConfig,
      tripleSparse,
    );
  }

  // Both networks should have the same synapse count for Input→H1.
  const singleCs = singleCreature.state.connection(0, singleCreature.input);
  const tripleCs = tripleCreature.state.connection(0, tripleCreature.input);

  assertEquals(
    singleCs.count,
    tripleCs.count,
    `Input→H1 synapse count should be identical regardless of fan-out. ` +
      `Single: ${singleCs.count}, Triple: ${tripleCs.count}`,
  );

  // Both networks should have the same neuron count for H1.
  const singleNs = singleCreature.state.node(singleCreature.input);
  const tripleNs = tripleCreature.state.node(tripleCreature.input);

  assertEquals(
    singleNs.count,
    tripleNs.count,
    `H1 neuron count should be identical regardless of fan-out. ` +
      `Single: ${singleNs.count}, Triple: ${tripleNs.count}`,
  );
});

Deno.test("AccumulationCounts - output synapse counts match training samples", () => {
  // Each H1→Output synapse should have count equal to training samples.
  // In a fan-out topology, all outgoing synapses from H1 are independently
  // accumulated once per sample.
  const json: CreatureExport = {
    input: 1,
    output: 3,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-2", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-2", weight: 1.0 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.1,
    plankConstant: 1e-12,
    maximumWeightAdjustmentScale: 10,
    maximumBiasAdjustmentScale: 10,
    disableRandomSamples: true,
    batchSize: 1000,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  const input = new Float32Array([1.0]);
  const target = new Float32Array([1.1, 1.1, 1.1]);

  const samples = 7;
  for (let i = 0; i < samples; i++) {
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(target, config, sparseConfig);
  }

  // Check each H1→Output synapse count.
  const h1Index = creature.input;
  const outputStart = creature.neurons.length - creature.output;

  for (let i = 0; i < creature.output; i++) {
    const outputIndex = outputStart + i;
    const cs = creature.state.connection(h1Index, outputIndex);
    assertEquals(
      cs.count,
      samples,
      `H1→Output-${i} synapse count should be ${samples}, got ${cs.count}`,
    );
  }
});
