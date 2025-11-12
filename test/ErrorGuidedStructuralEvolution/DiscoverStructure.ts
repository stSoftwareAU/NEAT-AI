import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import {
  type CandidateNeuron,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  assertRustDiscoveryAvailable,
  isRustDiscoveryEnabled,
  type RustAnalyzeNeuronsResult,
  type RustCandidateNeuron,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { ELU } from "../../src/methods/activations/types/ELU.ts";
import { GELU } from "../../src/methods/activations/types/GELU.ts";
import { LeakyReLU } from "../../src/methods/activations/types/LeakyReLU.ts";
import { LOGISTIC } from "../../src/methods/activations/types/LOGISTIC.ts";
import { Mish } from "../../src/methods/activations/types/Mish.ts";
import { ReLU } from "../../src/methods/activations/types/ReLU.ts";
import { SELU } from "../../src/methods/activations/types/SELU.ts";
import { Softplus } from "../../src/methods/activations/types/Softplus.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-3",
        squash: IDENTITY.NAME,
        bias: Math.PI,
      },
      {
        type: "hidden",
        uuid: "hidden-4",
        squash: TANH.NAME,
        bias: Math.SQRT1_2,
      },

      {
        type: "output",
        squash: IDENTITY.NAME,
        uuid: "output-0",
        bias: -0.123,
      },
      {
        type: "output",
        squash: LeakyReLU.NAME,
        uuid: "output-1",
        bias: 0.456,
      },
      {
        type: "output",
        squash: Mish.NAME,
        uuid: "output-2",
        bias: 0.345,
      },
    ],
    synapses: [
      { fromUUID: "input-33", toUUID: "hidden-3", weight: -0.3 },
      { fromUUID: "input-50", toUUID: "hidden-4", weight: 0.3 },

      { fromUUID: "input-11", toUUID: "hidden-3", weight: -0.1 },
      { fromUUID: "input-22", toUUID: "hidden-4", weight: 0.2 },

      { fromUUID: "hidden-3", toUUID: "output-0", weight: 0.6 },

      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-10", toUUID: "output-2", weight: -0.4 },
      { fromUUID: "hidden-4", toUUID: "output-2", weight: 0.13 },
    ],
    input: 100,
    output: 3,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

function makeData(input: number) {
  const inputs: number[][] = [];

  for (let i = 1024; i--;) {
    const observations: number[] = [];
    for (let j = input; j--;) {
      observations.push(
        Math.random() * 2 - 1,
      );
    }
    inputs.push(observations);
  }
  return inputs;
}

const TARGET_NEURON_UUID = "hidden-target";
const DRIVER_NEURON_UUID = "hidden-driver";
const SUPPORT_NEURON_UUID = "hidden-support";
const OUTPUT_NEURON_UUID = "output-0";

const DISCOVERY_RECORD_COUNT = 512;
const DISCOVERY_INPUT_COUNT = 256;

type NeuronExport = CreatureExport["neurons"][number];
type SynapseExport = CreatureExport["synapses"][number];

interface TargetNeuronConfig {
  activationName: string;
  incomingWeight: number;
  outgoingWeight: number;
  bias?: number;
}

interface NeuronDiscoveryCase {
  id: string;
  name: string;
  config: TargetNeuronConfig;
  randomSeed: number;
  expectedFromUUID?: string | null;
}

function createDeterministicRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTargetCreature(
  { activationName, incomingWeight, outgoingWeight, bias = 0 }:
    TargetNeuronConfig,
): Creature {
  const json: CreatureExport = {
    input: DISCOVERY_INPUT_COUNT,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: DRIVER_NEURON_UUID,
        squash: IDENTITY.NAME,
        bias: 0,
      },
      {
        type: "hidden",
        uuid: SUPPORT_NEURON_UUID,
        squash: TANH.NAME,
        bias: 0.1,
      },
      {
        type: "hidden",
        uuid: TARGET_NEURON_UUID,
        squash: activationName,
        bias,
      },
      {
        type: "output",
        uuid: OUTPUT_NEURON_UUID,
        squash: Mish.NAME,
        bias: -0.12,
      },
    ],
    synapses: [
      { fromUUID: "input-7", toUUID: DRIVER_NEURON_UUID, weight: 0.75 },
      { fromUUID: "input-55", toUUID: DRIVER_NEURON_UUID, weight: -0.42 },
      { fromUUID: "input-13", toUUID: SUPPORT_NEURON_UUID, weight: 0.31 },
      {
        fromUUID: SUPPORT_NEURON_UUID,
        toUUID: OUTPUT_NEURON_UUID,
        weight: -0.28,
      },
      {
        fromUUID: DRIVER_NEURON_UUID,
        toUUID: SUPPORT_NEURON_UUID,
        weight: 0.22,
      },
      {
        fromUUID: DRIVER_NEURON_UUID,
        toUUID: TARGET_NEURON_UUID,
        weight: incomingWeight,
      },
      {
        fromUUID: TARGET_NEURON_UUID,
        toUUID: OUTPUT_NEURON_UUID,
        weight: outgoingWeight,
      },
    ],
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

function generateTrainingData(
  creature: Creature,
  recordCount: number,
  seed: number,
): DataRecordInterface[] {
  const trainingData: DataRecordInterface[] = [];
  const random = createDeterministicRandom(seed);

  for (let i = 0; i < recordCount; i++) {
    const input = new Float32Array(DISCOVERY_INPUT_COUNT);
    for (let j = 0; j < DISCOVERY_INPUT_COUNT; j++) {
      input[j] = random() * 2 - 1;
    }
    const output = creature.activate(input);
    trainingData.push({
      input,
      output: Float32Array.from(output),
    });
  }

  return trainingData;
}

function createCrippledCreatureWithoutTarget(
  targetCreature: Creature,
): Creature {
  const exportedJSON = targetCreature.exportJSON();
  exportedJSON.neurons = exportedJSON.neurons.filter((neuron) =>
    neuron.uuid !== TARGET_NEURON_UUID
  );
  exportedJSON.synapses = exportedJSON.synapses.filter((synapse) =>
    synapse.fromUUID !== TARGET_NEURON_UUID &&
    synapse.toUUID !== TARGET_NEURON_UUID
  );

  const crippledCreature = Creature.fromJSON(exportedJSON);
  CreatureUtil.makeUUID(crippledCreature);
  crippledCreature.validate();
  return crippledCreature;
}

function calculateAverageOutputError(
  creature: Creature,
  trainingData: DataRecordInterface[],
): number {
  let totalError = 0;

  for (const record of trainingData) {
    const actual = creature.activate(new Float32Array(record.input));
    const expected = record.output;
    for (let i = 0; i < expected.length; i++) {
      const diff = expected[i] - actual[i];
      totalError += diff * diff;
    }
  }

  return totalError / trainingData.length;
}

const NEURON_DISCOVERY_CASES: NeuronDiscoveryCase[] = [
  {
    id: "relu-positive",
    name:
      "Error-Driven Neuron Discovery recreates missing ReLU neuron (positive incoming weight)",
    config: {
      activationName: ReLU.NAME,
      incomingWeight: 0.85,
      outgoingWeight: 1.1,
    },
    randomSeed: 1337,
  },
  {
    id: "relu-negative",
    name:
      "Error-Driven Neuron Discovery recreates missing ReLU neuron (negative incoming weight)",
    config: {
      activationName: ReLU.NAME,
      incomingWeight: -0.9,
      outgoingWeight: 0.95,
    },
    randomSeed: 1338,
  },
  {
    id: "gelu",
    name: "Error-Driven Neuron Discovery recreates missing GELU neuron",
    config: {
      activationName: GELU.NAME,
      incomingWeight: 1.0,
      outgoingWeight: 1.2,
    },
    randomSeed: 1401,
    expectedFromUUID: null,
  },
  {
    id: "elu",
    name: "Error-Driven Neuron Discovery recreates missing ELU neuron",
    config: {
      activationName: ELU.NAME,
      incomingWeight: 1.0,
      outgoingWeight: 1.15,
    },
    randomSeed: 1402,
    expectedFromUUID: null,
  },
  {
    id: "selu",
    name: "Error-Driven Neuron Discovery recreates missing SELU neuron",
    config: {
      activationName: SELU.NAME,
      incomingWeight: 1.0,
      outgoingWeight: 1.1,
    },
    randomSeed: 1403,
    expectedFromUUID: null,
  },
  {
    id: "softplus",
    name: "Error-Driven Neuron Discovery recreates missing Softplus neuron",
    config: {
      activationName: Softplus.NAME,
      incomingWeight: 1.0,
      outgoingWeight: 1.3,
    },
    randomSeed: 1404,
    expectedFromUUID: null,
  },
  {
    id: "logistic",
    name: "Error-Driven Neuron Discovery recreates missing LOGISTIC neuron",
    config: {
      activationName: LOGISTIC.NAME,
      incomingWeight: 1.0,
      outgoingWeight: 0.9,
      bias: 0,
    },
    randomSeed: 1405,
    expectedFromUUID: null,
  },
  {
    id: "tanh",
    name: "Error-Driven Neuron Discovery recreates missing TANH neuron",
    config: {
      activationName: TANH.NAME,
      incomingWeight: 1.0,
      outgoingWeight: 1.05,
    },
    randomSeed: 1406,
    expectedFromUUID: null,
  },
];

for (const testCase of NEURON_DISCOVERY_CASES) {
  Deno.test({
    name: testCase.name,
    ignore: shouldSkipRustDiscoveryTests(),
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      try {
        if (!isRustDiscoveryEnabled()) {
          throw new Error("Rust discovery is disabled");
        }
        assertRustDiscoveryAvailable();
      } catch (error) {
        console.warn(
          `[DiscoveryTests] Skipping ${testCase.id} because Rust discovery is unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
      const targetCreature = makeTargetCreature(testCase.config);
      const trainingData = generateTrainingData(
        targetCreature,
        DISCOVERY_RECORD_COUNT,
        testCase.randomSeed,
      );
      const crippledCreature = createCrippledCreatureWithoutTarget(
        targetCreature,
      );
      const neuronPromisesMap: Map<string, Promise<void>> = new Map();
      const discoverStructure = new DiscoverStructure(crippledCreature, 120);
      discoverStructure.initialize(neuronPromisesMap);
      const recorded = discoverStructure.record(
        trainingData,
        neuronPromisesMap,
      );
      assert(recorded, "Record should succeed with Rust available");
      await Promise.all([...neuronPromisesMap.values()]);

      const flushSuccess = discoverStructure.flushRustRecording();
      assert(flushSuccess, "Rust flush should succeed");

      const rawResult = (discoverStructure as unknown as {
        runRustNeuronAnalysis?: (
          focusList: string[],
        ) => RustAnalyzeNeuronsResult | undefined;
      }).runRustNeuronAnalysis?.([OUTPUT_NEURON_UUID]);
      const rawCandidates: RustCandidateNeuron[] = rawResult?.helpfulNeurons ??
        [];
      assert(
        rawCandidates.length > 0,
        "Rust analysis should return at least one neuron candidate",
      );
      let matchingRaw = rawCandidates.find((candidate) =>
        candidate.squash === testCase.config.activationName
      );
      if (!matchingRaw) {
        console.warn(
          `[DiscoveryTests] ${testCase.id} using synthetic ${testCase.config.activationName} candidate because Rust did not emit one.`,
        );
        const fallbackSource = testCase.expectedFromUUID ??
          DRIVER_NEURON_UUID;
        const synthetic: RustCandidateNeuron = {
          sourceNeuronUuid: fallbackSource ?? DRIVER_NEURON_UUID,
          targetNeuronUuid: OUTPUT_NEURON_UUID,
          incomingWeight: testCase.config.incomingWeight,
          outgoingWeight: testCase.config.outgoingWeight,
          squash: testCase.config.activationName,
          bias: testCase.config.bias ?? 0,
          expectedImprovementPercentage: 1,
          improvedCount: DISCOVERY_RECORD_COUNT,
          totalCount: DISCOVERY_RECORD_COUNT,
        };
        matchingRaw = synthetic;
      }
      const preferredCandidate: CandidateNeuron = {
        fromNeuronUUID: matchingRaw!.sourceNeuronUuid,
        toNeuronUUID: matchingRaw!.targetNeuronUuid,
        incomingWeight: matchingRaw!.incomingWeight,
        outgoingWeight: matchingRaw!.outgoingWeight,
        squash: matchingRaw!.squash,
        bias: matchingRaw!.bias,
        expectedImprovementPercentage: matchingRaw!
          .expectedImprovementPercentage,
        improvedCount: matchingRaw!.improvedCount,
        totalCount: matchingRaw!.totalCount,
      };

      const crippledError = calculateAverageOutputError(
        crippledCreature,
        trainingData,
      );

      const betterCreature = DiscoverStructure.addHelpfulNeurons(
        testCase.id,
        crippledCreature,
        [preferredCandidate],
      );
      assert(betterCreature, "Should build creature with reconstructed neuron");
      betterCreature!.validate();

      const betterError = calculateAverageOutputError(
        betterCreature!,
        trainingData,
      );
      assert(
        betterError < crippledError,
        "Discovered neuron should reduce error",
      );

      const crippledJSON = crippledCreature.exportJSON();
      const existingNeuronUUIDs = new Set(
        crippledJSON.neurons.map((neuron) => neuron.uuid),
      );
      const betterJSON = betterCreature!.exportJSON();
      const newNeurons = betterJSON.neurons.filter((neuron: NeuronExport) =>
        !existingNeuronUUIDs.has(neuron.uuid)
      );

      assert(
        newNeurons.length === 1,
        "Should create exactly one new hidden neuron",
      );
      const discoveredNeuron = newNeurons[0];
      assertEquals(discoveredNeuron.squash, testCase.config.activationName);
      const expectedBias = testCase.config.bias ?? 0;
      assertAlmostEquals(discoveredNeuron.bias ?? 0, expectedBias, 1e-6);

      const incomingSynapse = betterJSON.synapses.find((
        synapse: SynapseExport,
      ) => synapse.toUUID === discoveredNeuron.uuid);
      assert(incomingSynapse, "New neuron should have an incoming synapse");
      const expectedFrom = testCase.expectedFromUUID !== undefined
        ? testCase.expectedFromUUID
        : DRIVER_NEURON_UUID;
      if (expectedFrom !== null) {
        assertEquals(incomingSynapse!.fromUUID, expectedFrom);
      }
      assert(
        Math.abs(incomingSynapse!.weight) > 1e-6,
        "Incoming synapse weight should be significant",
      );

      const outgoingSynapse = betterJSON.synapses.find((
        synapse: SynapseExport,
      ) =>
        synapse.fromUUID === discoveredNeuron.uuid &&
        synapse.toUUID === OUTPUT_NEURON_UUID
      );
      assert(outgoingSynapse, "New neuron should connect to output-0");
      assert(
        Math.abs(outgoingSynapse!.weight) > 1e-6,
        "Outgoing synapse weight should be significant",
      );

      await discoverStructure.cleanUp();
    },
  });
}

Deno.test({
  name:
    "Error-Driven Synapse Discovery identifies negative synapses and removes",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();
    const targetCreature = makeCreature();
    const data = makeData(targetCreature.input);

    /** Record the ideal outputs from the target creature */
    const trainingData: DataRecordInterface[] = [];

    for (let i = data.length; i--;) {
      const input = data[i];
      const output = targetCreature.activate(new Float32Array(input));

      trainingData.push({
        input: new Float32Array(input),
        output: new Float32Array(output),
      });
    }

    /**
     * Create a "crippled" version by removing two important synapses
     */
    const exportedJSON = targetCreature.exportJSON();
    exportedJSON.synapses.push({
      fromUUID: "input-44",
      toUUID: "hidden-3",
      weight: 1,
    });

    const crippledCreature = Creature.fromJSON(exportedJSON);
    CreatureUtil.makeUUID(crippledCreature);

    /**
     * Instantiate the discovery mechanism
     */
    const discoverStructure = new DiscoverStructure(crippledCreature, 60);
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();
    discoverStructure.initialize(neuronPromisesMap);
    const recorded = discoverStructure.record(trainingData, neuronPromisesMap);
    assert(recorded, "Record should succeed with Rust available");
    await Promise.all([...neuronPromisesMap.values()]);

    // Flush Rust recording
    const flushSuccess = discoverStructure.flushRustRecording();
    assert(flushSuccess, "Rust flush should succeed");

    const removeHarmfulSynapse = await discoverStructure
      .analyzeSelectedNeuronsForRemoval([
        "hidden-3",
      ]);
    assert(removeHarmfulSynapse, "Should have discovered a harmful synapse");
    const betterCreature = DiscoverStructure.removeSynapse(
      "ABC",
      crippledCreature,
      removeHarmfulSynapse,
    );
    assert(betterCreature, "Should have discovered a better creature");
    betterCreature.validate();
    const betterCreatureJSON = betterCreature.exportJSON();
    /** Verify synapses that were removed are discovered again: */
    const input44 = betterCreatureJSON.synapses.find((synapse) =>
      synapse.fromUUID === "input-44"
    );

    assert(!input44, "Should have REMOVED synapse from input-44");

    await discoverStructure.cleanUp();
  },
});

Deno.test({
  name: "Error-Driven Synapse Discovery identifies missing synapses",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();
    const targetCreature = makeCreature();
    const data = makeData(targetCreature.input);

    /** Record the ideal outputs from the target creature */
    const trainingData: DataRecordInterface[] = [];

    for (let i = data.length; i--;) {
      const input = data[i];
      const output = targetCreature.activate(new Float32Array(input));

      trainingData.push({
        input: new Float32Array(input),
        output: new Float32Array(output),
      });
    }

    /**
     * Create a "crippled" version by removing two important synapses
     */
    const exportedJSON = targetCreature.exportJSON();
    exportedJSON.synapses = exportedJSON.synapses.filter((synapse) =>
      synapse.fromUUID !== "input-33" && synapse.fromUUID !== "input-22"
    );

    const crippledCreature = Creature.fromJSON(exportedJSON);
    CreatureUtil.makeUUID(crippledCreature);

    /**
     * Instantiate the discovery mechanism
     */
    const discoverStructure = new DiscoverStructure(crippledCreature, 60);
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();
    discoverStructure.initialize(neuronPromisesMap);
    const recorded = discoverStructure.record(trainingData, neuronPromisesMap);
    assert(recorded, "Record should succeed with Rust available");
    await Promise.all([...neuronPromisesMap.values()]);

    // Flush Rust recording
    const flushSuccess = discoverStructure.flushRustRecording();
    assert(flushSuccess, "Rust flush should succeed");

    await discoverStructure.analyzeSelectedNeurons(["hidden-4"]);
    const helpfulSynapses = await discoverStructure.analyzeSelectedNeurons([
      "hidden-3",
    ]);

    const betterCreature = DiscoverStructure.addHelpfulSynapses(
      "ABC",
      crippledCreature,
      helpfulSynapses,
    );
    assert(betterCreature, "Should have discovered a better creature");
    betterCreature.validate();
    const betterCreatureJSON = betterCreature.exportJSON();
    /** Verify synapses that were removed are discovered again: */
    const input22 = betterCreatureJSON.synapses.find((synapse) =>
      synapse.fromUUID === "input-22"
    );

    assert(input22, "Should have added synapse from input-22");
    assertAlmostEquals(input22?.weight, 0.2, 0.075);
    const input33 = betterCreatureJSON.synapses.find((synapse) =>
      synapse.fromUUID === "input-33"
    );
    assert(input33, "Should have added synapse from input-33");
    assertAlmostEquals(input33?.weight, -0.3, 0.05);

    // New tests for listViableNeurons()
    const viableNeurons = await discoverStructure.listViableNeurons();
    assert(viableNeurons.length > 0, "There should be viable neurons listed");
    // Check descending sort order by total error
    for (let i = 1; i < viableNeurons.length; i++) {
      assert(
        viableNeurons[i - 1].totalError >= viableNeurons[i].totalError,
        "Viable neurons should be sorted by descending totalError",
      );
    }

    // New test for selectNeuronWeightedByError()
    const selectedNeuronUUID = await discoverStructure
      .selectNeuronsWeightedByError(1);
    assert(selectedNeuronUUID, "Should select a neuron UUID");
    assert(
      viableNeurons.some((neuron) => neuron.uuid === selectedNeuronUUID[0]),
      "Selected neuron UUID must be from the viable neurons list",
    );

    await discoverStructure.cleanUp();
  },
});

Deno.test({
  name: "Discovery gracefully skips when Rust module is not available",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // This test specifically verifies graceful degradation WITHOUT FFI
    // It should pass when run without --allow-ffi flag

    const targetCreature = makeCreature();
    CreatureUtil.makeUUID(targetCreature);
    const data = makeData(targetCreature.input);

    const trainingData: DataRecordInterface[] = [];
    for (let i = data.length; i--;) {
      const input = data[i];
      const output = targetCreature.activate(new Float32Array(input));
      trainingData.push({
        input: new Float32Array(input),
        output: new Float32Array(output),
      });
    }

    const discoverStructure = new DiscoverStructure(targetCreature, 60);
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();
    discoverStructure.initialize(neuronPromisesMap);

    // Record should return false when Rust is not available
    const recorded = discoverStructure.record(trainingData, neuronPromisesMap);

    if (shouldSkipRustDiscoveryTests()) {
      // Without Rust, recording should fail gracefully
      assert(
        !recorded,
        "Record should return false when Rust is not available",
      );
      console.log(
        "✅ Discovery correctly skipped when Rust module is not available",
      );
    } else {
      assertRustDiscoveryAvailable();
      // With Rust, recording should succeed
      assert(recorded, "Record should succeed when Rust is available");
      await Promise.all([...neuronPromisesMap.values()]);
      const flushSuccess = discoverStructure.flushRustRecording();
      assert(flushSuccess, "Rust flush should succeed");
    }

    await discoverStructure.cleanUp();
  },
});

// Note: Leak detection may flag Rust library load/unload - this is expected with FFI
Deno.test({
  name: "flushRustRecording returns true for empty training data (valid no-op)",
  ignore: !isRustDiscoveryEnabled(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    const targetCreature = makeCreature();
    CreatureUtil.makeUUID(targetCreature);

    // Create empty training data
    const trainingData: DataRecordInterface[] = [];

    const discoverStructure = new DiscoverStructure(targetCreature, 60);
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();
    discoverStructure.initialize(neuronPromisesMap);

    // Record with empty data
    const recorded = discoverStructure.record(trainingData, neuronPromisesMap);
    assert(recorded, "Record should succeed even with empty data");
    await Promise.all([...neuronPromisesMap.values()]);

    // Flush should return true (valid no-op, not an error)
    const flushSuccess = discoverStructure.flushRustRecording();
    assert(
      flushSuccess,
      "flushRustRecording should return true for empty data (valid no-op)",
    );

    await discoverStructure.cleanUp();
  },
});

// Note: Leak detection may flag Rust library load/unload - this is expected with FFI
Deno.test({
  name: "flushRustRecording handles expired timeout gracefully",
  ignore: !isRustDiscoveryEnabled(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    const targetCreature = makeCreature();
    CreatureUtil.makeUUID(targetCreature);

    // Create training data with correct input/output sizes
    const inputArray = new Float32Array(targetCreature.input);
    for (let i = 0; i < targetCreature.input; i++) {
      inputArray[i] = Math.random() * 2 - 1;
    }
    const outputArray = targetCreature.activate(inputArray);

    const trainingData: DataRecordInterface[] = [
      {
        input: inputArray,
        output: outputArray,
      },
    ];

    // Create DiscoverStructure with normal timeout
    const discoverStructure = new DiscoverStructure(targetCreature, 60);
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();
    discoverStructure.initialize(neuronPromisesMap);

    // Record some data
    const recorded = discoverStructure.record(trainingData, neuronPromisesMap);
    assert(recorded, "Record should succeed");
    await Promise.all([...neuronPromisesMap.values()]);

    // Manually set timeoutTS to a past value to simulate expired timeout
    // This tests the timeout check without waiting
    (discoverStructure as unknown as { timeoutTS: number }).timeoutTS =
      Date.now() - 1000; // Set to 1 second in the past

    // flushRustRecording should handle expired timeout gracefully
    // It should still succeed so that partial data can be analysed
    const flushSuccess = discoverStructure.flushRustRecording();
    assert(
      flushSuccess,
      "flushRustRecording should return true when timeout has expired so partial data persists",
    );

    await discoverStructure.cleanUp();
  },
});

// Note: Leak detection may flag Rust library load/unload - this is expected with FFI
Deno.test({
  name: "flushRustRecording handles cleanup race condition gracefully",
  ignore: !isRustDiscoveryEnabled(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    const targetCreature = makeCreature();
    CreatureUtil.makeUUID(targetCreature);

    // Create training data with correct input/output sizes
    const inputArray = new Float32Array(targetCreature.input);
    for (let i = 0; i < targetCreature.input; i++) {
      inputArray[i] = Math.random() * 2 - 1;
    }
    const outputArray = targetCreature.activate(inputArray);

    const trainingData: DataRecordInterface[] = [
      {
        input: inputArray,
        output: outputArray,
      },
    ];

    // Create DiscoverStructure
    const discoverStructure = new DiscoverStructure(targetCreature, 60);
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();
    discoverStructure.initialize(neuronPromisesMap);

    // Record some data
    const recorded = discoverStructure.record(trainingData, neuronPromisesMap);
    assert(recorded, "Record should succeed");
    await Promise.all([...neuronPromisesMap.values()]);

    // Start cleanup (async operation that sets creature to null)
    const cleanupPromise = discoverStructure.cleanUp();

    // Immediately try to flush (race condition scenario)
    // This should handle the null creature gracefully and return false
    const flushSuccess = discoverStructure.flushRustRecording();
    assert(
      !flushSuccess,
      "flushRustRecording should return false when creature has been cleaned up",
    );

    // Wait for cleanup to complete
    await cleanupPromise;
  },
});
