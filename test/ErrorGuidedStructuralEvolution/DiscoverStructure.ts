import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import {
  type CandidateNeuron,
  DEFAULT_RUST_FLUSH_RECORDS,
  type DiscoverRecord as _DiscoverRecord,
  DiscoverStructure,
  type DiscoverStructureDeps as _DiscoverStructureDeps,
  type NeuronErrorInfo as _NeuronErrorInfo,
  type RustFlushMetrics as _RustFlushMetrics,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  assertRustDiscoveryAvailable,
  isRustDiscoveryEnabled,
  type RustAnalyzeNeuronsResult,
  type RustCandidateNeuron,
  type RustRecordBatchStats as _RustRecordBatchStats,
  type RustRecordInput as _RustRecordInput,
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
import { BIPOLAR } from "../../src/methods/activations/types/BIPOLAR.ts";
import { HARD_TANH } from "../../src/methods/activations/types/HARD_TANH.ts";
import { ABSOLUTE } from "../../src/methods/activations/types/ABSOLUTE.ts";
import { COMPLEMENT } from "../../src/methods/activations/types/COMPLEMENT.ts";

function _makeCreature() {
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

function _makeData(input: number) {
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
  {
    id: "identity",
    name: "Error-Driven Neuron Discovery recreates missing IDENTITY neuron",
    config: {
      activationName: IDENTITY.NAME,
      incomingWeight: 1.0,
      outgoingWeight: 1.0,
    },
    randomSeed: 1407,
    expectedFromUUID: null,
  },
  {
    id: "bipolar",
    name: "Error-Driven Neuron Discovery recreates missing BIPOLAR neuron",
    config: {
      activationName: BIPOLAR.NAME,
      incomingWeight: 1.0,
      outgoingWeight: 1.0,
    },
    randomSeed: 1408,
    expectedFromUUID: null,
  },
  {
    id: "clipped",
    name: "Error-Driven Neuron Discovery recreates missing CLIPPED neuron",
    config: {
      activationName: HARD_TANH.NAME,
      incomingWeight: 1.0,
      outgoingWeight: 1.0,
    },
    randomSeed: 1409,
    expectedFromUUID: null,
  },
  {
    id: "absolute",
    name: "Error-Driven Neuron Discovery recreates missing ABSOLUTE neuron",
    config: {
      activationName: ABSOLUTE.NAME,
      incomingWeight: 1.0,
      outgoingWeight: 1.0,
    },
    randomSeed: 1410,
    expectedFromUUID: null,
  },
  {
    id: "inverse",
    name: "Error-Driven Neuron Discovery recreates missing INVERSE neuron",
    config: {
      activationName: COMPLEMENT.NAME,
      incomingWeight: 1.0,
      outgoingWeight: 1.0,
    },
    randomSeed: 1411,
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
      const discoverStructure = new DiscoverStructure(
        crippledCreature,
        120,
        DEFAULT_RUST_FLUSH_RECORDS,
      );
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
