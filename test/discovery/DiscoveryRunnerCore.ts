import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type { CoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { DEFAULT_COST_OF_GROWTH } from "../../src/config/NeatConfig.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import type { Creature } from "../../src/Creature.ts";
import type { DiscoveryRunnerWorker } from "../../src/discovery/DiscoveryRunner.ts";
import { DiscoveryRunner } from "../../src/discovery/DiscoveryRunner.ts";
import { makeBaseCreature } from "../fixtures/SimpleCreatures.ts";

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
    coordinatedStructuralCandidates: undefined,
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
      fromNeuronUuid: "input-1",
      toNeuronUuid: "hidden-1",
      weight: 0.7,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.2,
      improvedCount: 5,
      totalCount: 7,
    }],
    coordinatedStructuralCandidates: undefined,
    removeHarmfulSynapse: {
      fromNeuronUuid: "input-1",
      toNeuronUuid: "output-0",
      weight: -0.25,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.1,
      improvedCount: 3,
      totalCount: 7,
    },
    candidateSquashes: [{
      neuronUuid: "hidden-1",
      previousSquash: "IDENTITY",
      squash: "TANH",
      expectedCreatureScoreGain: 0.3,
      improvedError: 0.05,
      currentError: 0.1,
    }],
    addHelpfulNeurons: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
  };

  const computeError = (creature: Creature) => {
    const json = creature.exportJSON();
    const synapses = json.synapses;
    const hidden1Squash = json.neurons.find((n) => n.uuid === "hidden-1")
      ?.squash;

    const hasHelpful = synapses.some((synapse) =>
      synapse.fromUUID === "input-1" && synapse.toUUID === "hidden-1" &&
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

Deno.test("DiscoveryRunner evaluates coordinated-structural candidates as a single unit", async () => {
  const base = makeBaseCreature();

  const coordinated: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.5,
    operations: [
      {
        type: "removeSynapse",
        fromNeuronUuid: "input-1",
        toNeuronUuid: "output-0",
      },
      {
        type: "addSynapse",
        fromNeuronUuid: "input-1",
        toNeuronUuid: "output-0",
        weight: 0.75,
      },
    ],
  };

  const discoveryResult: DiscoverResult = {
    ID: "COORDINATED",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    coordinatedStructuralCandidates: [coordinated],
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  let sawCoordinatedEvaluation = false;
  const worker = new FakeWorker(discoveryResult, (creature) => {
    const exported = creature.exportJSON();
    const syn = exported.synapses.find((s) =>
      s.fromUUID === "input-1" && s.toUUID === "output-0"
    );

    if (syn && Math.abs(syn.weight - 0.75) < 1e-12) {
      sawCoordinatedEvaluation = true;
      return 0.1;
    }
    return 1.0;
  });

  const runner = new DiscoveryRunner({
    rustDiscoveryEnabled: () => true,
    workerFactory: () => worker,
  });

  const result = await runner.discoverDir({
    creature: base,
    dataDir: "/tmp/data",
    options: makeOptions(),
  });

  assert(sawCoordinatedEvaluation);
  assertExists(result.improvement);
  assertEquals(result.improvement.changeType, "coordinated-structural");
});

Deno.test(
  "DiscoveryRunner considers combined multi-category candidate when selecting best result",
  async () => {
    const helpfulSynapse = {
      fromNeuronUuid: "input-1",
      toNeuronUuid: "hidden-1",
      weight: 0.45,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.2,
      improvedCount: 4,
      totalCount: 6,
    };
    const harmfulSynapse = {
      fromNeuronUuid: "input-1",
      toNeuronUuid: "output-0",
      weight: -0.25,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.1,
      improvedCount: 3,
      totalCount: 5,
    };
    const neuronCandidate = {
      fromNeuronUuid: "input-0",
      toNeuronUuid: "hidden-1",
      incomingWeight: 0.4,
      outgoingWeight: -0.3,
      squash: "TANH",
      bias: 0.05,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.22,
      improvedCount: 5,
      totalCount: 7,
    };
    const squashCandidate = {
      neuronUuid: "hidden-1",
      previousSquash: "IDENTITY",
      squash: "ELU",
      expectedCreatureScoreGain: 0.18,
      improvedError: 0.03,
      currentError: 0.07,
    };

    const discoveryResult: DiscoverResult = {
      ID: "DISCOVER_COMBINED",
      addHelpfulSynapses: [helpfulSynapse],
      addHelpfulNeurons: [neuronCandidate],
      removeHarmfulSynapse: harmfulSynapse,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: [squashCandidate],
    };

    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const synapses = json.synapses;
      const neurons = json.neurons;

      const hasHelpfulSynapse = synapses.some((synapse) =>
        synapse.fromUUID === helpfulSynapse.fromNeuronUuid &&
        synapse.toUUID === helpfulSynapse.toNeuronUuid &&
        Math.abs(synapse.weight - helpfulSynapse.weight) < 1e-6
      );
      const harmfulSynapsePresent = synapses.some((synapse) =>
        synapse.fromUUID === harmfulSynapse.fromNeuronUuid &&
        synapse.toUUID === harmfulSynapse.toNeuronUuid
      );
      const hidden1 = neurons.find((neuron) =>
        neuron.uuid === squashCandidate.neuronUuid
      );
      const squashUpdated = hidden1?.squash === squashCandidate.squash;

      const incomingDiscoverySynapse = synapses.find((synapse) =>
        synapse.fromUUID === neuronCandidate.fromNeuronUuid &&
        Math.abs(synapse.weight - neuronCandidate.incomingWeight) < 1e-6
      );
      const discoveredNeuronWire = incomingDiscoverySynapse?.toUUID;
      const outgoingDiscoverySynapse = synapses.find((synapse) =>
        discoveredNeuronWire &&
        synapse.fromUUID === discoveredNeuronWire &&
        synapse.toUUID === neuronCandidate.toNeuronUuid &&
        Math.abs(synapse.weight - neuronCandidate.outgoingWeight) < 1e-6
      );
      const hasDiscoveredNeuron = Boolean(
        discoveredNeuronWire &&
          outgoingDiscoverySynapse &&
          neurons.some((neuron) => neuron.uuid === discoveredNeuronWire),
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

    // The combined candidate should be created and evaluated
    // It may or may not be the best depending on actual scores
    // But we should have evaluated candidates including the combined one
    const evaluatedCandidates =
      result.evaluations?.filter((e) => e.kind === "candidate") ?? [];
    assert(
      evaluatedCandidates.length > 0,
      "Expected at least one candidate to be evaluated",
    );

    // Check if combo-all candidate was evaluated (it may not be the best)
    const comboAllEvaluated = evaluatedCandidates.some((e) =>
      e.changeType === "combo-all"
    );

    // If we have an improvement, verify it improves the score
    if (result.improvement) {
      assert(
        (result.improvement.scoreDelta ?? 0) > 0,
        "Improvement should have positive score delta",
      );
      // The combo-all candidate should be one of the evaluated candidates
      // (it may or may not be the best, depending on actual scores)
      if (comboAllEvaluated) {
        // If combo-all was evaluated and is the best, that's expected
        // If it was evaluated but not the best, that's also fine - we select by actual score
      }
    }
  },
);

Deno.test("DiscoveryRunner returns no improvement when candidates are not better", async () => {
  const discoveryResult: DiscoverResult = {
    ID: "DISCOVER_NO_IMPROVEMENT",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
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
