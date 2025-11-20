import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertRejects,
} from "@std/assert";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Creature } from "../../src/Creature.ts";
import type { DiscoveryRunnerWorker } from "../../src/discovery/DiscoveryRunner.ts";
import { DiscoveryRunner } from "../../src/discovery/DiscoveryRunner.ts";

function makeBaseCreature() {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: -0.25 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
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
    discoveryTimeOutMinutes: 1,
    discoveryAnalysisTimeoutMinutes: 1,
    threads: 1,
    costOfGrowth: 0,
    costName: "MSE",
    ...overrides,
  };
}

Deno.test("DiscoveryRunner throws when Rust discovery is disabled", async () => {
  try {
    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => false,
      workerFactory: () => {
        throw new Error("worker should not be created");
      },
    });

    await assertRejects(
      () =>
        runner.discoverDir({
          creature: makeBaseCreature(),
          dataDir: "/tmp/data",
          options: makeOptions(),
        }),
      Error,
      "Discovery requires the NEAT-AI-Discovery Rust library",
    );
  } finally {
    // nothing
  }
});

Deno.test("DiscoveryRunner enables verbose discovery logging when verbose option is set", async () => {
  const discoveryResult: DiscoverResult = {
    ID: "VERBOSE",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
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
    await runner.discoverDir({
      creature: makeBaseCreature(),
      dataDir: "/tmp/data",
      options: makeOptions({ verbose: true }),
    });

    assert(worker.lastDiscoverOptions);
    assertEquals(worker.lastDiscoverOptions.verbose, true);
    assertEquals(worker.lastDiscoverOptions.log, 1);
  } finally {
    // nothing
  }
});

Deno.test("DiscoveryRunner returns best improvement with informative message", async () => {
  const discoveryResult: DiscoverResult = {
    ID: "DISCOVER",
    addHelpfulSynapses: [{
      fromNeuronUUID: "hidden-1",
      toNeuronUUID: "output-0",
      weight: 0.7,
      expectedImprovementPercentage: 0.2,
      improvedCount: 5,
      totalCount: 7,
    }],
    removeHarmfulSynapse: {
      fromNeuronUUID: "input-1",
      toNeuronUUID: "output-0",
      weight: -0.25,
      expectedImprovementPercentage: 0.1,
      improvedCount: 3,
      totalCount: 7,
    },
    candidateSquashes: [{
      neuronUUID: "hidden-1",
      previousSquash: "IDENTITY",
      squash: "TANH",
      expectedImprovementPercentage: 0.3,
      improvedError: 0.05,
      currentError: 0.1,
    }],
    addHelpfulNeurons: undefined,
  };

  const computeError = (creature: Creature) => {
    const json = creature.exportJSON();
    const synapses = json.synapses;
    const hidden1Squash = json.neurons.find((n) => n.uuid === "hidden-1")
      ?.squash;

    const hasHelpful = synapses.some((synapse) =>
      synapse.fromUUID === "hidden-1" && synapse.toUUID === "output-0" &&
      Math.abs(synapse.weight - 0.7) < 1e-6
    );
    const removedHarmful = synapses.every((synapse) =>
      !(synapse.fromUUID === "input-1" && synapse.toUUID === "output-0")
    );
    const changedSquash = hidden1Squash === "TANH";

    if (hasHelpful && removedHarmful && changedSquash) {
      return 0.2;
    }
    if (hasHelpful && changedSquash) {
      return 0.25;
    }
    if (hasHelpful && removedHarmful) {
      return 0.3;
    }
    if (hasHelpful) {
      return 0.35;
    }
    if (removedHarmful) {
      return 0.4;
    }
    if (changedSquash) {
      return 0.45;
    }
    return 0.5;
  };

  const runner = new DiscoveryRunner({
    rustDiscoveryEnabled: () => true,
    workerFactory: () =>
      new FakeWorker(
        discoveryResult,
        computeError,
      ),
  });

  try {
    const result = await runner.discoverDir({
      creature: makeBaseCreature(),
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    assertEquals(result.original.score > 0, true);
    assert(result.improvement);
    assertEquals(result.improvement.score > result.original.score, true);
    assert(
      result.improvement.message.includes("Score"),
      "message should identify the change type",
    );
    assert(
      result.improvement.message.includes(result.discovery.ID),
      "message should include discovery identifier",
    );
    assert(
      result.improvement.scoreDelta >
        0,
    );
    assert(
      result.improvement.creature.neurons.length > 0,
    );
  } finally {
    // nothing
  }
});

Deno.test(
  "DiscoveryRunner considers combined multi-category candidate when selecting best result",
  async () => {
    const helpfulSynapse = {
      fromNeuronUUID: "input-1",
      toNeuronUUID: "hidden-1",
      weight: 0.45,
      expectedImprovementPercentage: 0.2,
      improvedCount: 4,
      totalCount: 6,
    };
    const harmfulSynapse = {
      fromNeuronUUID: "input-1",
      toNeuronUUID: "output-0",
      weight: -0.25,
      expectedImprovementPercentage: 0.1,
      improvedCount: 3,
      totalCount: 5,
    };
    const neuronCandidate = {
      fromNeuronUUID: "input-0",
      toNeuronUUID: "hidden-1",
      incomingWeight: 0.4,
      outgoingWeight: -0.3,
      squash: "TANH",
      bias: 0.05,
      expectedImprovementPercentage: 0.22,
      improvedCount: 5,
      totalCount: 7,
    };
    const squashCandidate = {
      neuronUUID: "hidden-1",
      previousSquash: "IDENTITY",
      squash: "ELU",
      expectedImprovementPercentage: 0.18,
      improvedError: 0.03,
      currentError: 0.07,
    };

    const discoveryResult: DiscoverResult = {
      ID: "DISCOVER_COMBINED",
      addHelpfulSynapses: [helpfulSynapse],
      addHelpfulNeurons: [neuronCandidate],
      removeHarmfulSynapse: harmfulSynapse,
      candidateSquashes: [squashCandidate],
    };

    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const synapses = json.synapses;
      const neurons = json.neurons;

      const hasHelpfulSynapse = synapses.some((synapse) =>
        synapse.fromUUID === helpfulSynapse.fromNeuronUUID &&
        synapse.toUUID === helpfulSynapse.toNeuronUUID &&
        Math.abs(synapse.weight - helpfulSynapse.weight) < 1e-6
      );
      const harmfulSynapsePresent = synapses.some((synapse) =>
        synapse.fromUUID === harmfulSynapse.fromNeuronUUID &&
        synapse.toUUID === harmfulSynapse.toNeuronUUID
      );
      const hidden1 = neurons.find((neuron) =>
        neuron.uuid === squashCandidate.neuronUUID
      );
      const squashUpdated = hidden1?.squash === squashCandidate.squash;

      const incomingDiscoverySynapse = synapses.find((synapse) =>
        synapse.fromUUID === neuronCandidate.fromNeuronUUID &&
        Math.abs(synapse.weight - neuronCandidate.incomingWeight) < 1e-6
      );
      const discoveredNeuronUUID = incomingDiscoverySynapse?.toUUID;
      const outgoingDiscoverySynapse = synapses.find((synapse) =>
        discoveredNeuronUUID &&
        synapse.fromUUID === discoveredNeuronUUID &&
        synapse.toUUID === neuronCandidate.toNeuronUUID &&
        Math.abs(synapse.weight - neuronCandidate.outgoingWeight) < 1e-6
      );
      const hasDiscoveredNeuron = Boolean(
        discoveredNeuronUUID &&
          outgoingDiscoverySynapse &&
          neurons.some((neuron) => neuron.uuid === discoveredNeuronUUID),
      );

      if (
        hasHelpfulSynapse && !harmfulSynapsePresent && squashUpdated &&
        hasDiscoveredNeuron
      ) {
        return 0.15;
      }
      if (hasHelpfulSynapse && !harmfulSynapsePresent && squashUpdated) {
        return 0.2;
      }
      if (hasHelpfulSynapse && !harmfulSynapsePresent) {
        return 0.25;
      }
      if (hasHelpfulSynapse && squashUpdated) {
        return 0.28;
      }
      if (hasHelpfulSynapse) {
        return 0.32;
      }
      if (!harmfulSynapsePresent) {
        return 0.4;
      }
      if (squashUpdated) {
        return 0.45;
      }
      return 0.5;
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () =>
        new FakeWorker(
          discoveryResult,
          computeError,
        ),
    });

    const result = await runner.discoverDir({
      creature: makeBaseCreature(),
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    assert(result.improvement, "Expected an improvement to be recorded.");
    assertEquals(
      result.improvement?.changeType,
      "combo-all",
      "Combined candidate should be considered the best improvement.",
    );
    assert(
      (result.improvement?.scoreDelta ?? 0) > 0,
      "Combined candidate should improve the score.",
    );
  },
);

Deno.test("DiscoveryRunner returns no improvement when candidates are not better", async () => {
  const discoveryResult: DiscoverResult = {
    ID: "DISCOVER_NO_IMPROVEMENT",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    candidateSquashes: undefined,
  };

  const runner = new DiscoveryRunner({
    rustDiscoveryEnabled: () => true,
    workerFactory: () =>
      new FakeWorker(
        discoveryResult,
        () => 1.0,
      ),
  });

  try {
    const result = await runner.discoverDir({
      creature: makeBaseCreature(),
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    assertEquals(result.improvement, undefined);
  } finally {
    // nothing
  }
});

Deno.test("DiscoveryRunner records evaluation summaries and archives candidates", async () => {
  const discoveryResult: DiscoverResult = {
    ID: "ARCHIVE_TEST",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
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
      change: { type: "add-neurons", description: "test candidate" },
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

Deno.test("DiscoveryRunner flags expectation mismatch when predictions diverge", async () => {
  const discoveryResult: DiscoverResult = {
    ID: "EXPECT_MISMATCH",
    addHelpfulSynapses: [{
      fromNeuronUUID: "input-1",
      toNeuronUUID: "hidden-1",
      weight: 0.45,
      expectedImprovementPercentage: 0.6,
      improvedCount: 9,
      totalCount: 10,
    }],
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    candidateSquashes: undefined,
  };

  const worker = new FakeWorker(
    discoveryResult,
    (creature: Creature) => {
      const json = creature.exportJSON();
      const hasHelpful = json.synapses.some((synapse) =>
        synapse.fromUUID === "input-1" && synapse.toUUID === "hidden-1" &&
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
    creature: makeBaseCreature(),
    dataDir: "/tmp/data",
    options: makeOptions(),
  });

  const candidateEval = result.evaluations?.find((entry) =>
    entry.kind === "candidate" && entry.changeType === "add-synapses"
  );
  assert(candidateEval, "expected add-synapses candidate evaluation");
  assert(
    candidateEval.expectationMismatch,
    "expected mismatch metadata when results diverge",
  );
  assertAlmostEquals(
    candidateEval.expectationMismatch.expectedPct,
    60,
    1e-6,
  );
  assertAlmostEquals(
    candidateEval.expectationMismatch.actualPct,
    1,
    1e-6,
  );
  assert(
    Math.abs(candidateEval.expectationMismatch.gapPct) > 50,
    "expected large gap signal",
  );
});

Deno.test("DiscoveryRunner passes discovery focus neurons to worker", async () => {
  const discoveryResult: DiscoverResult = {
    ID: "DISCOVER_FOCUS",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
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
      "hidden-target",
      "hidden-support",
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
      ["hidden-target", "hidden-support"],
    );
  } finally {
    // nothing
  }
});
