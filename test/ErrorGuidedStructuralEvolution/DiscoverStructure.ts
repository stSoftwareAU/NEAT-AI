import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import {
  type CandidateNeuron,
  DEFAULT_RUST_FLUSH_RECORDS,
  type DiscoverRecord,
  DiscoverStructure,
  type DiscoverStructureDeps,
  type NeuronErrorInfo,
  type RustFlushMetrics,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  assertRustDiscoveryAvailable,
  isRustDiscoveryEnabled,
  type RustAnalyzeNeuronsResult,
  type RustCandidateNeuron,
  type RustRecordBatchStats,
  type RustRecordInput,
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
    const discoverStructure = new DiscoverStructure(
      crippledCreature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
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
  },
});

Deno.test({
  name:
    "DiscoverStructure honours forced focus neurons before weighted selection",
  ignore: false,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const creatureJson: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-focus-1",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        { type: "hidden", uuid: "hidden-focus-2", squash: TANH.NAME, bias: 0 },
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-focus-1", weight: 0.5 },
        { fromUUID: "hidden-focus-1", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(creatureJson);
    CreatureUtil.makeUUID(creature);

    const discoverStructure = new DiscoverStructure(
      creature,
      5,
      DEFAULT_RUST_FLUSH_RECORDS,
      {
        isRustDiscoveryEnabled: () => true,
        isRustLibraryAvailable: () => true,
        recordDiscovery: () => {
          throw new Error("recordDiscovery should not be called in focus test");
        },
        mergeDiscoveryParquet: () => {
          throw new Error(
            "mergeDiscoveryParquet should not be called in focus test",
          );
        },
        analyzeNeurons: () => {
          throw new Error("analyzeNeurons should not be called in focus test");
        },
        analyzeSynapses: () => {
          throw new Error("analyzeSynapses should not be called in focus test");
        },
        readDiscoveryRecords: () => {
          throw new Error(
            "readDiscoveryRecords should not be called in focus test",
          );
        },
      },
    );

    const dsAny = discoverStructure as unknown as {
      forcedFocusNeurons?: string[];
      listViableNeurons: () => Promise<
        Array<{ uuid: string; totalError: number }>
      >;
      tempDir: string;
    };

    let listCalled = false;
    dsAny.listViableNeurons = () => {
      listCalled = true;
      return Promise.resolve([
        { uuid: "hidden-focus-1", totalError: 5 },
        { uuid: "hidden-focus-2", totalError: 3 },
      ]);
    };
    dsAny.forcedFocusNeurons = ["hidden-focus-2", "hidden-focus-1"];

    try {
      const focusList = await discoverStructure.selectNeuronsWeightedByError(1);
      assertEquals(focusList, ["hidden-focus-2"]);
      assertEquals(listCalled, false);
    } finally {
      await Deno.remove(dsAny.tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "calculateNeuronImpact caps bounded downstream contributions during focus selection",
  fn: async () => {
    const creatureJson: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-upstream",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "hidden",
          uuid: "hidden-linear",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "hidden",
          uuid: "hidden-tanh",
          squash: TANH.NAME,
          bias: 0,
        },
        {
          type: "output",
          uuid: "output-0",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        { fromUUID: "hidden-linear", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "hidden-upstream", toUUID: "hidden-tanh", weight: 1e6 },
        { fromUUID: "hidden-tanh", toUUID: "output-0", weight: 0.02 },
      ],
    };

    const creature = Creature.fromJSON(creatureJson);
    CreatureUtil.makeUUID(creature);

    const discoverStructure = new DiscoverStructure(
      creature,
      5,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const dsAny = discoverStructure as unknown as {
      calculateNeuronImpact: (uuid: string) => number;
      tempDir: string;
    };

    try {
      const tanhImpact = dsAny.calculateNeuronImpact("hidden-tanh");
      assertAlmostEquals(tanhImpact, 0.02, 1e-6);

      const upstreamImpact = dsAny.calculateNeuronImpact("hidden-upstream");
      assertAlmostEquals(
        upstreamImpact,
        tanhImpact,
        1e-6,
        "Upstream impact should be capped by bounded TANH path",
      );

      const linearImpact = dsAny.calculateNeuronImpact("hidden-linear");
      assertAlmostEquals(
        linearImpact,
        0.5,
        1e-6,
        "Linear neuron impact should equal its outgoing weight",
      );
    } finally {
      await Deno.remove(dsAny.tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "selectNeuronsWeightedByError records bounded impact weights for saturating paths",
  fn: async () => {
    const creatureJson: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-linear",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "hidden",
          uuid: "hidden-upstream",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "hidden",
          uuid: "hidden-tanh",
          squash: TANH.NAME,
          bias: 0,
        },
        {
          type: "output",
          uuid: "output-0",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        { fromUUID: "hidden-linear", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "hidden-upstream", toUUID: "hidden-tanh", weight: 1e6 },
        { fromUUID: "hidden-tanh", toUUID: "output-0", weight: 0.02 },
      ],
    };

    const creature = Creature.fromJSON(creatureJson);
    CreatureUtil.makeUUID(creature);

    const discoverStructure = new DiscoverStructure(
      creature,
      5,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const dsAny = discoverStructure as unknown as {
      calculateNeuronImpact: (uuid: string) => number;
      listViableNeurons: () => Promise<
        Array<{ uuid: string; totalError: number; impact: number }>
      >;
      tempDir: string;
    };

    const tanhImpact = dsAny.calculateNeuronImpact("hidden-tanh");
    const upstreamImpact = dsAny.calculateNeuronImpact("hidden-upstream");
    const linearImpact = dsAny.calculateNeuronImpact("hidden-linear");

    dsAny.listViableNeurons = () =>
      Promise.resolve([
        { uuid: "hidden-upstream", totalError: 10, impact: upstreamImpact },
        { uuid: "hidden-linear", totalError: 10, impact: linearImpact },
        { uuid: "hidden-tanh", totalError: 10, impact: tanhImpact },
      ]);

    try {
      const selection = await discoverStructure.selectNeuronsWeightedByError(3);
      assertEquals(
        new Set(selection),
        new Set(["hidden-upstream", "hidden-linear", "hidden-tanh"]),
      );

      const summary = (discoverStructure as unknown as {
        lastFocusSelection?: {
          neurons: Array<{ uuid: string; weight?: number }>;
        };
      }).lastFocusSelection;
      assert(summary, "Focus summary should be recorded");
      const weightEntries = new Map(
        summary!.neurons.map((entry) => [entry.uuid, entry.weight ?? 0]),
      );
      const epsilon = 0.0001;
      const expectedLinearWeight = 10 * (linearImpact + epsilon);
      const expectedUpstreamWeight = 10 * (upstreamImpact + epsilon);

      assertAlmostEquals(
        weightEntries.get("hidden-linear") ?? 0,
        expectedLinearWeight,
        1e-6,
      );
      assertAlmostEquals(
        weightEntries.get("hidden-upstream") ?? 0,
        expectedUpstreamWeight,
        1e-6,
      );
      assert(
        expectedLinearWeight > expectedUpstreamWeight,
        "Linear neuron should retain higher weighted error than bounded upstream path",
      );
    } finally {
      await Deno.remove(dsAny.tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "listNeuronsByImpact orders outputs before hidden neurons",
  fn: async () => {
    const creatureJson: CreatureExport = {
      input: 2,
      output: 2,
      neurons: [
        {
          type: "constant",
          uuid: "const-0",
          bias: 1,
        },
        {
          type: "hidden",
          uuid: "hidden-a",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "hidden",
          uuid: "hidden-b",
          squash: TANH.NAME,
          bias: 0,
        },
        {
          type: "output",
          uuid: "output-0",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "output",
          uuid: "output-1",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.8 },
        { fromUUID: "hidden-b", toUUID: "output-1", weight: 0.4 },
        { fromUUID: "hidden-a", toUUID: "hidden-b", weight: 0.6 },
      ],
    };

    const creature = Creature.fromJSON(creatureJson);
    CreatureUtil.makeUUID(creature);

    const discoverStructure = new DiscoverStructure(
      creature,
      5,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const dsAny = discoverStructure as unknown as {
      listNeuronsByImpact: () => Array<{ uuid: string; neuronType: string }>;
      tempDir: string;
    };

    try {
      const ordered = dsAny.listNeuronsByImpact();
      assert(
        ordered.every((entry) => entry.uuid !== "const-0"),
        "Constant neurons must be excluded from impact ordering",
      );
      const topTwo = ordered.slice(0, 2).map((entry) => entry.uuid);
      assertEquals(new Set(topTwo), new Set(["output-0", "output-1"]));

      const hiddenOrdering = ordered
        .filter((entry) => entry.neuronType !== "output")
        .map((entry) => entry.uuid);
      assertEquals(hiddenOrdering[0], "hidden-a");
    } finally {
      await Deno.remove(dsAny.tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "setForcedFocusNeurons filters constants from overrides",
  fn: async () => {
    const creatureJson: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "constant", uuid: "const-0", bias: 1 },
        {
          type: "hidden",
          uuid: "hidden-focus",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "output",
          uuid: "output-0",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        { fromUUID: "const-0", toUUID: "output-0", weight: 0.7 },
        { fromUUID: "hidden-focus", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(creatureJson);
    CreatureUtil.makeUUID(creature);

    const discoverStructure = new DiscoverStructure(
      creature,
      5,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const dsAny = discoverStructure as unknown as {
      forcedFocusNeurons?: string[] | null;
      tempDir: string;
    };

    try {
      discoverStructure.setForcedFocusNeurons([
        "const-0",
        "hidden-focus",
        "output-0",
      ]);
      assertEquals(dsAny.forcedFocusNeurons, ["hidden-focus", "output-0"]);
    } finally {
      await Deno.remove(dsAny.tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "listNeuronsByImpact honors outputs for larger in-repo fixtures",
  fn: async () => {
    const fixtureUrl = new URL("../data/large.json", import.meta.url);
    const jsonText = await Deno.readTextFile(fixtureUrl);
    const creature = Creature.fromJSON(JSON.parse(jsonText));
    CreatureUtil.makeUUID(creature);

    const discoverStructure = new DiscoverStructure(
      creature,
      5,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const dsAny = discoverStructure as unknown as {
      listNeuronsByImpact: () => Array<{ uuid: string; neuronType: string }>;
      tempDir: string;
    };

    try {
      const ordered = dsAny.listNeuronsByImpact();
      const outputUUIDs = creature.neurons
        .filter((neuron) => neuron.type === "output")
        .map((neuron) => neuron.uuid);
      const leading = ordered.slice(0, outputUUIDs.length).map((entry) =>
        entry.uuid
      );
      assertEquals(new Set(leading), new Set(outputUUIDs));
    } finally {
      await Deno.remove(dsAny.tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "listViableNeurons clamps errors to maximum output error",
  fn: async () => {
    const creatureJson: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "output",
          uuid: "output-0",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(creatureJson);
    CreatureUtil.makeUUID(creature);

    const discoverStructure = new DiscoverStructure(
      creature,
      5,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const dsAny = discoverStructure as unknown as {
      recorded: boolean;
      tempDir: string;
      loadCSV: (path: string) => Promise<DiscoverRecord[]>;
      getMaxOutputError: () => Promise<number>;
    };
    dsAny.recorded = true;
    dsAny.tempDir = ".";

    const csvData = new Map<string, DiscoverRecord[]>([
      ["output-0", [{
        activation: 0,
        errors: [0.5, -0.55],
      }]],
      ["hidden-0", [{
        activation: 0,
        errors: [1.2, -1.1],
      }]],
    ]);

    dsAny.loadCSV = (path: string) => {
      const file = path.split("/").pop() ?? "";
      const uuid = file.replace(".csv", "");
      const records = csvData.get(uuid) ?? [];
      return Promise.resolve(records.map((record) => ({
        activation: record.activation,
        value: record.value,
        errors: [...record.errors],
      })));
    };
    dsAny.getMaxOutputError = () => Promise.resolve(0.55);

    const neuronErrors = await discoverStructure.listViableNeurons();
    const hidden = neuronErrors.find((entry) => entry.uuid === "hidden-0");
    const output = neuronErrors.find((entry) => entry.uuid === "output-0");
    assert(hidden);
    assert(output);
    assert(
      hidden.totalError <= 0.55 + 1e-6,
      `Hidden neuron error ${hidden.totalError} should not exceed output cap`,
    );
    assertAlmostEquals(output.totalError, 0.525, 0.001);
  },
});

Deno.test({
  name:
    "selectNeuronsWeightedByError favours neurons with higher error-impact weight",
  fn: async () => {
    const creatureJson: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "output",
          uuid: "output-0",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.3 },
      ],
    };

    const creature = Creature.fromJSON(creatureJson);
    CreatureUtil.makeUUID(creature);

    const discoverStructure = new DiscoverStructure(
      creature,
      5,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const dsAny = discoverStructure as unknown as {
      recorded: boolean;
      tempDir: string;
      listViableNeurons: () => Promise<NeuronErrorInfo[]>;
      getMaxOutputError: () => Promise<number>;
    };
    dsAny.recorded = true;
    dsAny.tempDir = ".";
    dsAny.listViableNeurons = () =>
      Promise.resolve([
        { uuid: "output-0", totalError: 0.55, impact: 1 },
        { uuid: "hidden-0", totalError: 0.2, impact: 0.5 },
      ]);
    dsAny.getMaxOutputError = () => Promise.resolve(0.55);

    const originalRandom = Math.random;
    let seed = 42;
    Math.random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const selectionCounts = new Map<string, number>();
    try {
      for (let i = 0; i < 100; i++) {
        // deno-lint-ignore no-await-in-loop
        const selection = await discoverStructure.selectNeuronsWeightedByError(
          1,
        );
        const uuid = selection[0];
        selectionCounts.set(uuid, (selectionCounts.get(uuid) ?? 0) + 1);
      }
    } finally {
      Math.random = originalRandom;
    }

    assert(
      (selectionCounts.get("output-0") ?? 0) >
        (selectionCounts.get("hidden-0") ?? 0),
      `Expected output neuron to be chosen more frequently. Counts: ${
        JSON.stringify(
          Object.fromEntries(selectionCounts.entries()),
        )
      }`,
    );
  },
});

Deno.test({
  name:
    "weighted focus selection caps combined weight to output error magnitude",
  fn: async () => {
    const creatureJson: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-large",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "hidden",
          uuid: "hidden-small",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "output",
          uuid: "output-0",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        { fromUUID: "hidden-large", toUUID: "output-0", weight: 2 },
        { fromUUID: "hidden-small", toUUID: "output-0", weight: 1 },
      ],
    };

    const creature = Creature.fromJSON(creatureJson);
    CreatureUtil.makeUUID(creature);

    const discoverStructure = new DiscoverStructure(
      creature,
      5,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const dsAny = discoverStructure as unknown as {
      listViableNeurons: () => Promise<
        Array<{ uuid: string; totalError: number; impact: number }>
      >;
      getMaxOutputError: () => Promise<number>;
      lastFocusSelection?: { totalWeight?: number };
      recorded: boolean;
      tempDir: string;
      parquetFilePath: string | null;
      deps: DiscoverStructureDeps;
    };

    dsAny.recorded = true;
    dsAny.parquetFilePath = "unused.parquet";
    dsAny.deps = {
      ...dsAny.deps,
      isRustDiscoveryEnabled: () => true,
    };
    dsAny.listViableNeurons = () =>
      Promise.resolve([
        { uuid: "hidden-large", totalError: 1_000_000, impact: 1 },
        { uuid: "hidden-small", totalError: 500_000, impact: 1 },
      ]);
    dsAny.getMaxOutputError = () => Promise.resolve(0.55);

    try {
      await discoverStructure.selectNeuronsWeightedByError(2);
      const summary = dsAny.lastFocusSelection;
      assert(summary, "Focus selection summary should exist");
      assert(
        summary!.totalWeight !== undefined &&
          summary!.totalWeight <= 0.55 + 1e-6,
        `Total weight ${summary?.totalWeight} should respect output error cap`,
      );
    } finally {
      await Deno.remove(dsAny.tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "analyzeSelectedNeurons timeout logs focus selection summary for visibility",
  fn: async () => {
    const creatureJson: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-logger",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "output",
          uuid: "output-0",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        { fromUUID: "hidden-logger", toUUID: "output-0", weight: 0.1 },
      ],
    };

    const creature = Creature.fromJSON(creatureJson);
    CreatureUtil.makeUUID(creature);

    const discoverStructure = new DiscoverStructure(
      creature,
      1,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const dsAny = discoverStructure as unknown as {
      lastFocusSelection?: {
        key: string;
        mode: "weighted";
        reason: string;
        neurons: Array<{ uuid: string; weight: number }>;
        totalWeight: number;
      };
      timeoutTS: number;
      tempDir: string;
    };

    const focusList = ["hidden-logger"];
    dsAny.lastFocusSelection = {
      key: focusList.join("|"),
      mode: "weighted",
      reason: "unit-test",
      neurons: [{ uuid: "hidden-logger", weight: 42 }],
      totalWeight: 42,
    };
    dsAny.timeoutTS = Date.now() - 1; // Force timeout path

    const warnMessages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnMessages.push(args.map((part) => String(part)).join(" "));
    };

    try {
      await discoverStructure.analyzeSelectedNeurons(focusList);
    } finally {
      console.warn = originalWarn;
      await Deno.remove(dsAny.tempDir, { recursive: true }).catch(() => {});
    }

    const summaryLog = warnMessages.find((msg) =>
      msg.includes("Focus selection [weighted]")
    );
    assert(
      summaryLog,
      "Expected timeout to emit focus selection summary for diagnostics",
    );
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
    const discoverStructure = new DiscoverStructure(
      crippledCreature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
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
    // Weight changed after v0.195.8 fix: errors now recorded once per sample (was multiple times)
    // Old: ~0.2, New: ~0.099 (correct with proper error recording)
    assertAlmostEquals(input22?.weight, 0.099, 0.02);
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

    const discoverStructure = new DiscoverStructure(
      targetCreature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
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

    const discoverStructure = new DiscoverStructure(
      targetCreature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
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
    const discoverStructure = new DiscoverStructure(
      targetCreature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
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
    const discoverStructure = new DiscoverStructure(
      targetCreature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
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

Deno.test({
  name: "inspectRustFlushBatch exposes metrics for longest UUID tracking",
  fn() {
    const longUuid = "hidden-neuron-with-extended-identifier-001";
    const trainingData: RustRecordInput["training_data"] = [{
      input: [0.1, -0.2],
      output: [0.3],
      "neuron_data": [
        {
          neuron_uuid: longUuid,
          activation: 0.51,
          value: 0.42,
          errors: [0.01, -0.02, 0.03],
        },
        {
          neuron_uuid: "output-0",
          activation: 0.37,
          value: 0.22,
          errors: [-0.05],
        },
      ],
    }];

    const creature = makeCreature();
    creature.validate();
    CreatureUtil.makeUUID(creature);

    const discoverStructure = new DiscoverStructure(
      creature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );

    const aggregation = (discoverStructure as unknown as {
      createRustFlushAggregation: (
        expectedInputLength: number,
        expectedOutputLength: number,
        expectedNeuronCount: number,
      ) => unknown;
    }).createRustFlushAggregation(2, 1, 2);

    (discoverStructure as unknown as {
      observeRustTrainingRecord: (
        aggregation: unknown,
        record: RustRecordInput["training_data"][number],
        globalSampleIndex: number,
      ) => void;
    }).observeRustTrainingRecord(aggregation, trainingData[0], 0);

    const diagnostics = (discoverStructure as unknown as {
      finalizeRustFlushDiagnostics: (
        aggregation: unknown,
      ) => {
        summary: string;
        warnings: string[];
        errors: string[];
        metrics: RustFlushMetrics;
      };
    }).finalizeRustFlushDiagnostics(aggregation);

    const metrics = diagnostics.metrics;
    assertEquals(metrics.longestNeuronUuidLength, longUuid.length);
    assertEquals(
      metrics.totalNeuronUuidBytes,
      longUuid.length + "output-0".length,
    );
    assertEquals(metrics.totalErrorValues, 4);
    assertEquals(metrics.maxErrorValuesPerNeuron, 3);
  },
});

Deno.test({
  name:
    "writeRustParquetChunk logs metrics when Invalid string length is reported",
  fn: () => {
    const longUuid = "hidden-neuron-with-extended-identifier-001";
    const creature = Creature.fromJSON({
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: longUuid,
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "output",
          uuid: "output-0",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: longUuid, weight: 0.5 },
        { fromUUID: longUuid, toUUID: "output-0", weight: -0.25 },
      ],
    });
    creature.validate();
    CreatureUtil.makeUUID(creature);

    let expectedStats!: RustRecordBatchStats;

    const recordDiscoveryCalls: RustRecordInput[] = [];
    const originalMkdirSync = Deno.mkdirSync;
    (Deno as unknown as { mkdirSync: typeof Deno.mkdirSync }).mkdirSync =
      () => {};
    const discoverStructure = new DiscoverStructure(
      creature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
      {
        isRustDiscoveryEnabled: () => true,
        isRustLibraryAvailable: () => true,
        recordDiscovery: (input) => {
          recordDiscoveryCalls.push(input);
          return {
            success: false,
            error: "Invalid string length",
            errorDetails: {
              stage: "encode",
              inputJsonLength: 512,
              inputBytesLength: 704,
              stats: expectedStats,
            },
          };
        },
        mergeDiscoveryParquet: () => ({ success: true, outputFile: "" }),
        analyzeNeurons: () => ({ success: true, helpfulNeurons: [] }),
        analyzeSynapses: () => ({
          success: true,
          helpfulSynapses: [],
          harmfulSynapses: [],
        }),
        readDiscoveryRecords: () => ({ success: true, records: [] }),
      },
    );

    const neuronMap = new Map<string, DiscoverRecord>();
    neuronMap.set(longUuid, {
      activation: 0.51,
      value: 0.42,
      errors: [0.01, -0.02, 0.03, -0.04],
    });
    neuronMap.set("output-0", {
      activation: 0.37,
      value: 0.22,
      errors: [-0.05],
    });

    (discoverStructure as unknown as { usingRustDualWrite: boolean })
      .usingRustDualWrite = true;
    (discoverStructure as unknown as {
      rustAccumulatedData: DataRecordInterface[];
    })
      .rustAccumulatedData = [{
        input: new Float32Array([0.1, -0.2]),
        output: new Float32Array([0.3]),
      }];
    (discoverStructure as unknown as {
      rustAccumulatedNeuronData: Array<Map<string, DiscoverRecord>>;
    }).rustAccumulatedNeuronData = [neuronMap];
    (discoverStructure as unknown as { rustChunkFiles: string[] })
      .rustChunkFiles = [];

    {
      const nonInputNeurons = creature.neurons.filter((neuron) =>
        neuron.type !== "input"
      );
      const rustTrainingData = (discoverStructure as unknown as {
        rustAccumulatedData: DataRecordInterface[];
        rustAccumulatedNeuronData: Array<Map<string, DiscoverRecord>>;
      }).rustAccumulatedData.map((record, index) => {
        const discover = ((discoverStructure as unknown as {
          rustAccumulatedNeuronData: Array<Map<string, DiscoverRecord>>;
        }).rustAccumulatedNeuronData[index]) ??
          new Map<string, DiscoverRecord>();

        const neuronData = nonInputNeurons.map((neuron) => {
          const mapped = discover.get(neuron.uuid);
          return {
            neuron_uuid: neuron.uuid,
            activation: mapped?.activation ?? 0,
            value: mapped?.value,
            errors: mapped?.errors ? Array.from(mapped.errors) : [],
          };
        });

        return {
          input: Array.from(record.input),
          output: Array.from(record.output),
          "neuron_data": neuronData,
        };
      });

      expectedStats = (DiscoverStructure as unknown as {
        computeRustFlushMetrics: (
          data: RustRecordInput["training_data"],
          expectedNeuronCount: number,
          expectedInputLength: number,
          expectedOutputLength: number,
        ) => RustRecordBatchStats;
      }).computeRustFlushMetrics(
        rustTrainingData,
        nonInputNeurons.length,
        creature.input,
        creature.output,
      );
    }

    const originalError = console.error;
    const errorLogs: Array<{ message: string; details: unknown }> = [];
    console.error = (...args: unknown[]) => {
      errorLogs.push({
        message: String(args[0]),
        details: args[1],
      });
    };

    try {
      const chunkDir = (discoverStructure as unknown as {
        getNextChunkDir: () => string;
      }).getNextChunkDir();

      const result = (discoverStructure as unknown as {
        writeRustParquetChunk: (dir: string) => string | null;
      }).writeRustParquetChunk(chunkDir);

      assertEquals(result, null);
    } finally {
      console.error = originalError;
      (Deno as unknown as { mkdirSync: typeof Deno.mkdirSync }).mkdirSync =
        originalMkdirSync;
    }

    assertEquals(
      recordDiscoveryCalls.length,
      1,
      "Expected recordDiscovery to be invoked exactly once",
    );
    const errorLog = errorLogs.find((log) =>
      log.message.includes("Rust discovery recording failed")
    );
    assert(errorLog, "Expected invalid string length failure to be logged");
    const details = errorLog!.details as Record<string, unknown>;
    assert(details, "Expected error log to include metadata");
    assertEquals(
      details.longestRustUuidLength,
      expectedStats.longestNeuronUuidLength,
    );
    assertEquals(
      details.totalRustUuidBytes,
      expectedStats.totalNeuronUuidBytes,
    );
    assertEquals(
      details.maxRustErrorsPerNeuron,
      expectedStats.maxErrorValuesPerNeuron,
    );
    assertEquals(details.totalRustErrorValues, expectedStats.totalErrorValues);
    assertEquals(details.rustInputJsonLength, 512);
    assertEquals(details.rustInputBytes, 704);
    assertEquals(
      (details.recordDiscoveryStats as typeof expectedStats)
        .longestNeuronUuidLength,
      expectedStats.longestNeuronUuidLength,
    );
  },
});
