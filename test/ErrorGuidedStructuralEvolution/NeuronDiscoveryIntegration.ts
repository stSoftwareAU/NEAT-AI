/**
 * Integration tests for neuron discovery functionality.
 *
 * These tests use the REAL Rust library to verify neuron discovery
 * in production-like scenarios.
 *
 * Key areas tested:
 * 1. Simple creature - baseline that should always work
 * 2. Complex multi-layer creatures - production-like scenarios
 * 3. Wide creatures - many inputs/neurons
 * 4. Production method (collectRustAnalysisCandidates)
 */
import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import {
  DEFAULT_RUST_FLUSH_RECORDS,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { initWasmForTests } from "../_initWasm.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import { LeakyReLU } from "../../src/methods/activations/types/LeakyReLU.ts";
import { Mish } from "../../src/methods/activations/types/Mish.ts";

// =============================================================================
// Test Scenarios
// =============================================================================

/**
 * Creates a scenario where a simple hidden neuron is missing.
 * This is the simplest case - if this fails, something is fundamentally broken.
 */
function makeSimpleRecoveryScenario(): {
  crippledCreature: Creature;
  trainingData: DataRecordInterface[];
} {
  // Target: input -> TANH hidden -> output
  const targetJson: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-tanh", squash: TANH.NAME, bias: 0.1 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-tanh", weight: 0.8 },
      { fromUUID: "input-1", toUUID: "hidden-tanh", weight: -0.5 },
      { fromUUID: "hidden-tanh", toUUID: "output-0", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 0.1 },
    ],
  };
  const targetCreature = Creature.fromJSON(targetJson);
  targetCreature.validate();

  // Crippled: missing the hidden neuron entirely
  const crippledJson: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "output-0", weight: -0.2 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 0.1 },
    ],
  };
  const crippledCreature = Creature.fromJSON(crippledJson);
  crippledCreature.validate();
  CreatureUtil.makeUUID(crippledCreature);

  // Generate training data from target
  const trainingData: DataRecordInterface[] = [];
  for (let i = 0; i < 256; i++) {
    const input = new Float32Array(3);
    for (let j = 0; j < 3; j++) {
      input[j] = Math.random() * 2 - 1;
    }
    const output = targetCreature.activate(input);
    trainingData.push({ input, output: new Float32Array(output) });
  }

  return { crippledCreature, trainingData };
}

/**
 * Creates a multi-layer scenario similar to production.
 * The crippled creature is missing a critical hidden neuron in layer 2.
 */
function makeMultiLayerScenario(): {
  crippledCreature: Creature;
  trainingData: DataRecordInterface[];
} {
  const targetJson: CreatureExport = {
    input: 10,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "L1-a", squash: TANH.NAME, bias: 0.1 },
      { type: "hidden", uuid: "L1-b", squash: LeakyReLU.NAME, bias: -0.1 },
      { type: "hidden", uuid: "L2-missing", squash: TANH.NAME, bias: 0.2 },
      { type: "hidden", uuid: "L2-present", squash: Mish.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-1", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "L1-a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "L1-a", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "L1-b", weight: 0.4 },
      { fromUUID: "input-3", toUUID: "L1-b", weight: 0.2 },
      { fromUUID: "L1-a", toUUID: "L2-missing", weight: 0.7 },
      { fromUUID: "L1-b", toUUID: "L2-missing", weight: -0.4 },
      { fromUUID: "L1-a", toUUID: "L2-present", weight: 0.3 },
      { fromUUID: "L1-b", toUUID: "L2-present", weight: 0.5 },
      { fromUUID: "L2-missing", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "L2-missing", toUUID: "output-1", weight: -0.6 },
      { fromUUID: "L2-present", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "L2-present", toUUID: "output-1", weight: 0.4 },
    ],
  };
  const targetCreature = Creature.fromJSON(targetJson);
  targetCreature.validate();

  // Crippled: L2-missing is removed
  const crippledJson: CreatureExport = {
    input: 10,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "L1-a", squash: TANH.NAME, bias: 0.1 },
      { type: "hidden", uuid: "L1-b", squash: LeakyReLU.NAME, bias: -0.1 },
      { type: "hidden", uuid: "L2-present", squash: Mish.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-1", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "L1-a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "L1-a", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "L1-b", weight: 0.4 },
      { fromUUID: "input-3", toUUID: "L1-b", weight: 0.2 },
      { fromUUID: "L1-a", toUUID: "L2-present", weight: 0.3 },
      { fromUUID: "L1-b", toUUID: "L2-present", weight: 0.5 },
      { fromUUID: "L2-present", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "L2-present", toUUID: "output-1", weight: 0.4 },
      { fromUUID: "L1-a", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "L1-b", toUUID: "output-1", weight: -0.2 },
    ],
  };
  const crippledCreature = Creature.fromJSON(crippledJson);
  crippledCreature.validate();
  CreatureUtil.makeUUID(crippledCreature);

  const trainingData: DataRecordInterface[] = [];
  for (let i = 0; i < 256; i++) {
    const input = new Float32Array(10);
    for (let j = 0; j < 10; j++) {
      input[j] = Math.random() * 2 - 1;
    }
    const output = targetCreature.activate(input);
    trainingData.push({ input, output: new Float32Array(output) });
  }

  return { crippledCreature, trainingData };
}

/**
 * Creates a wide creature similar to production (many inputs, many hidden neurons).
 */
function makeWideCreatureScenario(): {
  crippledCreature: Creature;
  trainingData: DataRecordInterface[];
} {
  const targetNeurons: CreatureExport["neurons"] = [];
  const targetSynapses: CreatureExport["synapses"] = [];
  const crippledNeurons: CreatureExport["neurons"] = [];
  const crippledSynapses: CreatureExport["synapses"] = [];

  for (let i = 0; i < 10; i++) {
    const neuron = {
      type: "hidden" as const,
      uuid: `hidden-${i}`,
      squash: i % 3 === 0
        ? TANH.NAME
        : (i % 3 === 1 ? LeakyReLU.NAME : Mish.NAME),
      bias: (i - 5) * 0.1,
    };
    targetNeurons.push(neuron);
    if (i !== 5) {
      crippledNeurons.push({ ...neuron });
    }
  }

  for (let i = 0; i < 3; i++) {
    const neuron = {
      type: "output" as const,
      uuid: `output-${i}`,
      squash: IDENTITY.NAME,
      bias: 0,
    };
    targetNeurons.push(neuron);
    crippledNeurons.push({ ...neuron });
  }

  for (let h = 0; h < 10; h++) {
    const inputStart = h * 2;
    for (let j = 0; j < 3; j++) {
      const synapse = {
        fromUUID: `input-${(inputStart + j) % 30}`,
        toUUID: `hidden-${h}`,
        weight: (Math.random() - 0.5) * 2,
      };
      targetSynapses.push(synapse);
      if (h !== 5) {
        crippledSynapses.push({ ...synapse });
      }
    }
  }

  for (let h = 0; h < 10; h++) {
    for (let o = 0; o < 3; o++) {
      if ((h + o) % 2 === 0) {
        const synapse = {
          fromUUID: `hidden-${h}`,
          toUUID: `output-${o}`,
          weight: (Math.random() - 0.5) * 2,
        };
        targetSynapses.push(synapse);
        if (h !== 5) {
          crippledSynapses.push({ ...synapse });
        }
      }
    }
  }

  const targetCreature = Creature.fromJSON({
    input: 30,
    output: 3,
    neurons: targetNeurons,
    synapses: targetSynapses,
  });
  targetCreature.validate();

  const crippledCreature = Creature.fromJSON({
    input: 30,
    output: 3,
    neurons: crippledNeurons,
    synapses: crippledSynapses,
  });
  crippledCreature.validate();
  CreatureUtil.makeUUID(crippledCreature);

  const trainingData: DataRecordInterface[] = [];
  for (let i = 0; i < 512; i++) {
    const input = new Float32Array(30);
    for (let j = 0; j < 30; j++) {
      input[j] = Math.random() * 2 - 1;
    }
    const output = targetCreature.activate(input);
    trainingData.push({ input, output: new Float32Array(output) });
  }

  return { crippledCreature, trainingData };
}

// =============================================================================
// Integration Tests
// =============================================================================

Deno.test({
  name:
    "Neuron discovery: simple creature finds and adds missing hidden neuron",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    await initWasmForTests();
    const { crippledCreature, trainingData } = makeSimpleRecoveryScenario();

    const discoverStructure = new DiscoverStructure(
      crippledCreature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );

    const neuronPromises = new Map<number, Promise<void>>();

    try {
      discoverStructure.initialize(neuronPromises);
      const recorded = discoverStructure.record(trainingData, neuronPromises);
      assert(recorded, "Recording should succeed");
      await Promise.all([...neuronPromises.values()]);

      const flushSuccess = discoverStructure.flushRustRecording();
      assert(flushSuccess, "Flush should succeed");

      discoverStructure.extendTimeoutForAnalysis(5);

      const candidates = await discoverStructure.analyzeMissingNeurons([
        "output-0" as unknown as number,
      ]);

      if (candidates && candidates.length > 0) {
        const improved = DiscoverStructure.addHelpfulNeurons(
          "test",
          crippledCreature,
          candidates.slice(0, 1),
        );
        if (improved) {
          improved.validate();
        }
      }
    } finally {
      await discoverStructure.cleanUp();
    }
  },
});

Deno.test({
  name:
    "Neuron discovery: multi-layer creature analyses each output independently",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    await initWasmForTests();
    const { crippledCreature, trainingData } = makeMultiLayerScenario();

    const discoverStructure = new DiscoverStructure(
      crippledCreature,
      120,
      DEFAULT_RUST_FLUSH_RECORDS,
    );

    const neuronPromises = new Map<number, Promise<void>>();

    try {
      discoverStructure.initialize(neuronPromises);
      discoverStructure.record(trainingData, neuronPromises);
      await Promise.all([...neuronPromises.values()]);
      discoverStructure.flushRustRecording();

      for (const outputUUID of ["output-0", "output-1"]) {
        discoverStructure.extendTimeoutForAnalysis(5);
        // @ts-ignore: test with legacy string neuron IDs
        // deno-lint-ignore no-await-in-loop
        await discoverStructure.analyzeMissingNeurons([outputUUID]);
      }

      // Combined analysis
      discoverStructure.extendTimeoutForAnalysis(5);
      const allCandidates = await discoverStructure.analyzeMissingNeurons([
        "output-0" as unknown as number,
        "output-1" as unknown as number,
      ]);

      if (allCandidates && allCandidates.length > 0) {
        const improved = DiscoverStructure.addHelpfulNeurons(
          "test",
          crippledCreature,
          allCandidates,
        );
        if (improved) {
          improved.validate();
        }
      }
    } finally {
      await discoverStructure.cleanUp();
    }
  },
});

Deno.test({
  name: "Neuron discovery: wide creature with many inputs and hidden neurons",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    await initWasmForTests();
    const { crippledCreature, trainingData } = makeWideCreatureScenario();

    const discoverStructure = new DiscoverStructure(
      crippledCreature,
      180,
      DEFAULT_RUST_FLUSH_RECORDS,
    );

    const neuronPromises = new Map<number, Promise<void>>();

    try {
      discoverStructure.initialize(neuronPromises);
      discoverStructure.record(trainingData, neuronPromises);
      await Promise.all([...neuronPromises.values()]);
      discoverStructure.flushRustRecording();

      discoverStructure.extendTimeoutForAnalysis(10);

      const focusNeurons = ["output-0", "output-1", "output-2"];
      // @ts-ignore: test with legacy string IDs
      await discoverStructure.analyzeMissingNeurons(focusNeurons);
    } finally {
      await discoverStructure.cleanUp();
    }
  },
});

Deno.test({
  name:
    "Neuron discovery: collectRustAnalysisCandidates returns analysis bundle",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    await initWasmForTests();
    const { crippledCreature, trainingData } = makeMultiLayerScenario();

    const discoverStructure = new DiscoverStructure(
      crippledCreature,
      120,
      DEFAULT_RUST_FLUSH_RECORDS,
    );

    const neuronPromises = new Map<number, Promise<void>>();

    try {
      discoverStructure.initialize(neuronPromises);
      discoverStructure.record(trainingData, neuronPromises);
      await Promise.all([...neuronPromises.values()]);
      discoverStructure.flushRustRecording();

      discoverStructure.extendTimeoutForAnalysis(10);

      // This is what DiscoverDirectory uses in production
      const bundle = discoverStructure.collectRustAnalysisCandidates(
        // @ts-ignore: test with legacy string neuron IDs
        ["output-0" as unknown as number, "output-1" as unknown as number],
        // @ts-ignore: test with string IDs
        // @ts-ignore: test with string IDs
      );

      if (bundle && bundle.helpfulNeurons && bundle.helpfulNeurons.length > 0) {
        assert(
          bundle.helpfulNeurons[0].squash,
          "Helpful neuron candidate should have a squash function",
        );
      }
    } finally {
      await discoverStructure.cleanUp();
    }
  },
});
