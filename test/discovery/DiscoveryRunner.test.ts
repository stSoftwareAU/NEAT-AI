import { assert, assertEquals, assertRejects } from "@std/assert";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { Creature } from "../../src/Creature.ts";
import { DiscoveryRunner } from "../../src/discovery/DiscoveryRunner.ts";
import type { DiscoveryRunnerWorker } from "../../src/discovery/DiscoveryRunner.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";

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
      result.improvement.message.includes(result.improvement.changeType),
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

Deno.test("DiscoveryRunner returns no improvement when candidates are not better", async () => {
  const discoveryResult: DiscoverResult = {
    ID: "DISCOVER_NO_IMPROVEMENT",
    addHelpfulSynapses: undefined,
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
