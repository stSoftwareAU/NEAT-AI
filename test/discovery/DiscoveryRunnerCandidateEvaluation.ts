import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";

// Integer IDs for neurons (from UUID hashing):
// hidden-1 → 1775329650, positive-test-hidden → 293051313
const ID_HIDDEN_1 = 1775329650;
const ID_POSITIVE_TEST_HIDDEN = 293051313;
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { DEFAULT_COST_OF_GROWTH } from "../../src/config/NeatConfig.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Creature } from "../../src/Creature.ts";
import type { DiscoveryRunnerWorker } from "../../src/discovery/DiscoveryRunner.ts";
import { DiscoveryRunner } from "../../src/discovery/DiscoveryRunner.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
import { makeBaseCreature } from "../fixtures/SimpleCreatures.ts";

function makeDenseOutputCreature(extraFanIn: number) {
  // Build the full creature JSON with UUID-based references so that
  // normaliseCreatureExport can resolve all connections correctly.
  const neurons: Array<{
    type: "hidden" | "output" | "constant";
    uuid: string;
    squash: string;
    bias: number;
  }> = [
    { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
  ];
  const synapses: Array<{
    fromUUID: string;
    toUUID: string;
    weight: number;
  }> = [
    { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
    { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
    { fromUUID: "input-1", toUUID: "output-0", weight: -0.25 },
  ];

  for (let i = 0; i < extraFanIn; i++) {
    const uuid = `dense-hidden-${i}`;
    neurons.push({ type: "hidden", uuid, squash: "IDENTITY", bias: 0 });
    synapses.push({ fromUUID: "input-0", toUUID: uuid, weight: 0.5 });
    synapses.push({ fromUUID: uuid, toUUID: "output-0", weight: 0.5 });
  }

  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  const json = { input: 2, output: 1, neurons, synapses };
  const creature = Creature.fromJSON(json);
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

function cloneCreatureJSON(
  creature: Creature,
): ReturnType<Creature["exportJSON"]> {
  return JSON.parse(
    JSON.stringify(creature.exportJSON()),
  ) as ReturnType<Creature["exportJSON"]>;
}

class FakeWorker implements DiscoveryRunnerWorker {
  #discoverResult: DiscoverResult;
  #computeError: (creature: Creature) => number;
  lastDiscoverOptions?: NeatOptions;

  constructor(
    discoverResult: DiscoverResult,
    computeError: (creature: Creature) => number,
  ) {
    this.#discoverResult = discoverResult;
    this.#computeError = computeError;
  }

  discover(
    _creature: Creature,
    options: NeatOptions,
  ): Promise<Awaited<ReturnType<DiscoveryRunnerWorker["discover"]>>> {
    this.lastDiscoverOptions = options;
    return Promise.resolve({
      taskID: 1,
      duration: 10,
      discover: this.#discoverResult,
    });
  }

  evaluate(
    creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<Awaited<ReturnType<DiscoveryRunnerWorker["evaluate"]>>> {
    const error = this.#computeError(creature);
    return Promise.resolve({
      taskID: 2,
      duration: 5,
      evaluate: {
        error,
      },
    });
  }

  terminate(): void {
    // no-op for fake worker
  }
}

function makeOptions(overrides: NeatOptions = {}): NeatOptions {
  return {
    discoveryRecordTimeOutMinutes: 0.05, // 3 seconds - sufficient for CI
    discoveryAnalysisTimeoutMinutes: 0.05, // 3 seconds - sufficient for CI
    threads: 1,
    // Use DEFAULT_COST_OF_GROWTH so removal candidates pass the filter and
    // removal improves score (enabling Phase 2 combo evaluation).
    // 0 is valid but filters out removal candidates (impact < 0) and yields no score delta.
    costOfGrowth: DEFAULT_COST_OF_GROWTH,
    costName: "MSE",
    ...overrides,
  };
}

Deno.test("DiscoveryRunner records evaluation summaries and archives candidates", async () => {
  const discoveryResult: DiscoverResult = {
    ID: "ARCHIVE_TEST",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const baseCreature = makeBaseCreature();
  const candidateCreature = Creature.fromJSON(baseCreature.exportJSON());
  CreatureUtil.makeUUID(candidateCreature);

  const computeError = (creature: Creature) =>
    creature === candidateCreature ? 0.25 : 0.5;

  const tempDir = await Deno.makeTempDir();
  const previousCwd = Deno.cwd();

  const runner = new DiscoveryRunner({
    rustDiscoveryEnabled: () => true,
    workerFactory: () =>
      new FakeWorker(
        discoveryResult,
        computeError,
      ),
    candidateBuilder: () => [{
      creature: candidateCreature,
      change: {
        type: "add-neurons",
        description: "test candidate",
        expectedErrorReduction: 0.1, // Must exceed 2x costOfGrowth
      },
    }],
  });

  try {
    Deno.chdir(tempDir);

    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    assert(result.evaluations);
    assertEquals(result.evaluations.length, 2);

    const originalEval = result.evaluations.find((entry) =>
      entry.kind === "original"
    );
    const candidateEval = result.evaluations.find((entry) =>
      entry.kind === "candidate"
    );

    assert(originalEval);
    assert(candidateEval);
    assertEquals(candidateEval.improved, true);
    assert(
      (candidateEval.scoreDelta ?? 0) > 0,
      "candidate should record positive score delta",
    );

    assert(result.candidateArchiveDir);
    assert(candidateEval.archivePath);

    const summaryPath = `${result.candidateArchiveDir}/summary.json`;
    const summary = JSON.parse(await Deno.readTextFile(summaryPath));
    assert(Array.isArray(summary));
    assertEquals(summary.length, 2);
  } finally {
    Deno.chdir(previousCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DiscoveryRunner evaluates synapse candidates correctly", async () => {
  const discoveryResult: DiscoverResult = {
    ID: "SYNAPSE_EVAL_TEST",
    addHelpfulSynapses: [{
      fromNeuronId: 1,
      toNeuronId: ID_HIDDEN_1,
      weight: 0.45,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.6,
      improvedCount: 9,
      totalCount: 10,
    }],
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const worker = new FakeWorker(
    discoveryResult,
    (creature: Creature) => {
      const json = creature.exportJSON();
      const hasHelpful = json.synapses.some((synapse) =>
        synapse.fromId === 1 && synapse.toId === ID_HIDDEN_1 &&
        Math.abs(synapse.weight - 0.45) < 1e-6
      );
      return hasHelpful ? 0.99 : 1.0;
    },
  );

  const runner = new DiscoveryRunner({
    rustDiscoveryEnabled: () => true,
    workerFactory: () => worker,
  });

  const result = await runner.discoverDir({
    creature: makeDenseOutputCreature(120),
    dataDir: "/tmp/data",
    options: makeOptions(),
  });

  const candidateEval = result.evaluations?.find((entry) =>
    entry.kind === "candidate" && entry.changeType === "add-synapses"
  );
  assert(candidateEval, "expected add-synapses candidate evaluation");

  // Verify the actual improvement percentage
  assertAlmostEquals(
    candidateEval.errorDeltaPct ?? 0,
    1.0, // (1.0 - 0.99) / 1.0 * 100 = 1%
    1e-6,
  );
});

Deno.test("DiscoveryRunner evaluates neuron candidates correctly", async () => {
  const creature = makeDenseOutputCreature(100); // 100+ synapses to output

  // Set a baseline error for the creature
  const baseError = 0.584263;
  const { addTag } = await import("@stsoftware/tags/mod");
  addTag(creature, "error", baseError.toString());

  const expectedImprovementPct = 0.1; // 0.1% improvement
  const errorReduction = baseError * (expectedImprovementPct / 100);

  const neuronCandidate = {
    fromNeuronId: ID_HIDDEN_1,
    toNeuronId: -1,
    incomingWeight: 0.45,
    outgoingWeight: -0.3,
    squash: "TANH",
    bias: 0.05,
    targetNeuronImpact: 1.0,
    expectedCreatureErrorReduction: 0,
    expectedCreatureScoreGain: errorReduction,
    improvedCount: 9,
    totalCount: 10,
  };

  const discoveryResult: DiscoverResult = {
    ID: "NEURON_EVAL_TEST",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: [neuronCandidate],
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const worker = new FakeWorker(
    discoveryResult,
    (creature: Creature) => {
      const json = creature.exportJSON();
      // Check for the added neuron by finding its incoming synapse
      const incomingSynapse = json.synapses.find((synapse) =>
        synapse.fromId === neuronCandidate.fromNeuronId &&
        Math.abs(synapse.weight - neuronCandidate.incomingWeight) < 1e-6
      );
      const hasNeuron = incomingSynapse !== undefined;
      return hasNeuron ? baseError - errorReduction : baseError;
    },
  );

  const runner = new DiscoveryRunner({
    rustDiscoveryEnabled: () => true,
    workerFactory: () => worker,
  });

  const result = await runner.discoverDir({
    creature: creature,
    dataDir: "/tmp/data",
    options: makeOptions(),
  });

  const candidateEval = result.evaluations?.find((entry) =>
    entry.kind === "candidate" && entry.changeType === "add-neurons"
  );
  assert(candidateEval, "expected add-neurons candidate evaluation");

  // Verify actual improvement percentage
  assertAlmostEquals(
    candidateEval.errorDeltaPct ?? 0,
    expectedImprovementPct,
    0.01,
    "actualErrorDeltaPct should match expected improvement",
  );
});

Deno.test("DiscoveryRunner passes discovery focus neurons to worker", async () => {
  const discoveryResult: DiscoverResult = {
    ID: "DISCOVER_FOCUS",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  const worker = new FakeWorker(
    discoveryResult,
    () => 1.0,
  );

  const runner = new DiscoveryRunner({
    rustDiscoveryEnabled: () => true,
    workerFactory: () => worker,
  });

  try {
    const options = makeOptions({ verbose: true });
    (options as Record<string, unknown>).discoveryFocusNeuronUUIDs = [
      100,
      200,
    ];

    await runner.discoverDir({
      creature: makeBaseCreature(),
      dataDir: "/tmp/data",
      options,
    });

    assert(worker.lastDiscoverOptions);
    assertEquals(
      (worker.lastDiscoverOptions as Record<string, unknown>)
        .discoveryFocusNeuronUUIDs,
      [100, 200],
    );
  } finally {
    // nothing
  }
});

Deno.test(
  "DiscoveryRunner includes synapse candidates with positive expected impact",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "POSITIVE_FILTER_SYN",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const baseCreature = makeBaseCreature();
    const extraSynapse = {
      fromId: 0,
      toId: -1,
      weight: 0.05,
    };

    const cloneExport = () => cloneCreatureJSON(baseCreature);

    const candidateBuilder = (
      _creature: Creature,
      _discovery: DiscoverResult,
    ): DiscoveryCandidate[] => {
      const json = cloneExport();
      json.synapses.push({
        fromId: extraSynapse.fromId,
        toId: extraSynapse.toId,
        weight: extraSynapse.weight,
      });
      const candidate = Creature.fromJSON(json);
      candidate.validate();
      CreatureUtil.makeUUID(candidate);
      return [{
        creature: candidate,
        change: {
          type: "add-synapses",
          description: "extra synapse",
          expectedErrorReduction: 0.05, // Must exceed 2x costOfGrowth (0.02 * 2 = 0.04)
        },
      }];
    };

    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const hasExtraSynapse = json.synapses.some((synapse) =>
        synapse.fromId === extraSynapse.fromId &&
        synapse.toId === extraSynapse.toId &&
        Math.abs(synapse.weight - extraSynapse.weight) < 1e-9
      );
      return hasExtraSynapse ? 0.4 : 0.5;
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () =>
        new FakeWorker(
          discoveryResult,
          computeError,
        ),
      candidateBuilder,
    });

    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options: makeOptions({ costOfGrowth: 0.02 }), // Positive candidates are included
    });

    assert(
      result.evaluations?.some((entry) => entry.kind === "candidate"),
      "candidates with positive expected impact should be included",
    );
  },
);

Deno.test(
  "DiscoveryRunner includes neuron candidates with positive expected impact",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "POSITIVE_FILTER_NEURON",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const baseCreature = makeBaseCreature();

    const candidateBuilder = (
      _creature: Creature,
      _discovery: DiscoverResult,
    ): DiscoveryCandidate[] => {
      const json = cloneCreatureJSON(baseCreature);
      const outputCount = json.output ?? 1;
      const outputOffset = json.neurons.length - outputCount;
      json.neurons.splice(outputOffset, 0, {
        type: "hidden",
        id: ID_POSITIVE_TEST_HIDDEN,
        squash: "IDENTITY",
        bias: 0,
      });
      json.synapses.push({
        fromId: 0,
        toId: ID_POSITIVE_TEST_HIDDEN,
        weight: 0.2,
      });
      json.synapses.push({
        fromId: ID_POSITIVE_TEST_HIDDEN,
        toId: -1,
        weight: -0.2,
      });
      const candidate = Creature.fromJSON(json);
      candidate.validate();
      CreatureUtil.makeUUID(candidate);
      return [{
        creature: candidate,
        change: {
          type: "add-neurons",
          description: "extra neuron",
          expectedErrorReduction: 0.02, // Positive expected impact
        },
      }];
    };

    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const hasNewNeuron = json.neurons.some((neuron) =>
        neuron.id === ID_POSITIVE_TEST_HIDDEN
      );
      return hasNewNeuron ? 0.3 : 0.5;
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () =>
        new FakeWorker(
          discoveryResult,
          computeError,
        ),
      candidateBuilder,
    });

    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options: makeOptions({ costOfGrowth: 0.01 }), // Positive candidates are included
    });

    assert(
      result.evaluations?.some((entry) => entry.kind === "candidate"),
      "neuron additions with positive expected impact should be included",
    );
  },
);

// NOTE: Test "DiscoveryRunner skips candidates with non-positive expected impact" removed.
// Rust is the single source of truth for candidate filtering (DRY principle).

Deno.test(
  "DiscoveryRunner includes candidates with undefined expectedErrorReduction for evaluation",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "UNDEFINED_EXPECTED",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const baseCreature = makeBaseCreature();

    const candidateBuilder = (
      _creature: Creature,
      _discovery: DiscoverResult,
    ): DiscoveryCandidate[] => {
      const json = cloneCreatureJSON(baseCreature);
      const candidate = Creature.fromJSON(json);
      candidate.validate();
      CreatureUtil.makeUUID(candidate);
      return [{
        creature: candidate,
        change: {
          type: "combo-all",
          description: "combo candidate without expected impact",
          // expectedErrorReduction is undefined - typical for combo candidates
        },
      }];
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () =>
        new FakeWorker(
          discoveryResult,
          () => 0.5,
        ),
      candidateBuilder,
    });

    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    assert(
      result.evaluations?.some((entry) => entry.kind === "candidate"),
      "candidates with undefined expectedErrorReduction should be included for evaluation",
    );
  },
);

// NOTE: Test "DiscoveryRunner excludes zero-impact candidates when multiplier is 0" removed.
// Rust is the single source of truth for candidate filtering (DRY principle).

Deno.test(
  "DiscoveryRunner logs sub-basis deltas with at least three significant digits",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "DELTA_PRECISION",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const baseCreature = makeBaseCreature();
    const tinyDelta = 1e-8;

    const candidateBuilder = (
      _creature: Creature,
      _discovery: DiscoverResult,
    ): DiscoveryCandidate[] => {
      const json = cloneCreatureJSON(baseCreature);
      json.synapses = json.synapses.map((synapse) =>
        synapse.fromId === ID_HIDDEN_1 && synapse.toId === -1
          ? { ...synapse, weight: synapse.weight + tinyDelta }
          : synapse
      );
      const candidate = Creature.fromJSON(json);
      candidate.validate();
      CreatureUtil.makeUUID(candidate);
      return [{
        creature: candidate,
        change: {
          type: "add-synapses",
          description: "tiny delta",
          expectedErrorReduction: tinyDelta,
        },
      }];
    };

    const baselineError = 0.5;
    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const hasTinyUpdate = json.synapses.some((synapse) =>
        synapse.fromId === ID_HIDDEN_1 && synapse.toId === -1 &&
        Math.abs(synapse.weight - (0.5 + tinyDelta)) < 1e-10
      );
      return hasTinyUpdate ? baselineError - tinyDelta : baselineError;
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () =>
        new FakeWorker(
          discoveryResult,
          computeError,
        ),
      candidateBuilder,
    });

    const captured: string[] = [];
    const originalInfo = console.info.bind(console);
    console.info = (...args: unknown[]) => {
      captured.push(args.map((arg) => String(arg)).join(" "));
      originalInfo(...args);
    };

    try {
      await runner.discoverDir({
        creature: baseCreature,
        dataDir: "/tmp/data",
        options: makeOptions({ costOfGrowth: 0 }),
      });
    } finally {
      console.info = originalInfo;
    }

    const candidateLine = captured.find((line) =>
      line.includes("[DiscoveryRunner]   Candidate")
    );
    assert(candidateLine, "expected candidate log line to be recorded");
    assert(
      !candidateLine.includes("+0.000%"),
      `non-zero deltas must show significant digits, got: ${candidateLine}`,
    );
  },
);
