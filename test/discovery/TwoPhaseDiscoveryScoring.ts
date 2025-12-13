/**
 * Tests for two-phase discovery scoring.
 *
 * The two-phase approach:
 * 1. Phase 1: Score all SINGLE candidates first
 * 2. Phase 2: Only combine candidates that improved (score > original)
 *
 * This ensures combined creatures are only built from proven successful candidates,
 * rather than combining changes that individually don't work.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
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
  evaluationCallCount = 0;

  constructor(
    discoverResult: DiscoverResult,
    computeError: (creature: Creature) => number,
  ) {
    this.#discoverResult = discoverResult;
    this.#computeError = computeError;
  }

  discover(
    _creature: Creature,
    _options: NeatOptions,
  ): Promise<Awaited<ReturnType<DiscoveryRunnerWorker["discover"]>>> {
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
    this.evaluationCallCount++;
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
    discoveryRecordTimeOutMinutes: 0.05,
    discoveryAnalysisTimeoutMinutes: 0.05,
    threads: 4, // Use multiple threads for parallel scoring
    costOfGrowth: 0,
    costName: "MSE",
    ...overrides,
  };
}

Deno.test(
  "DiscoveryRunner two-phase scoring: only combines successful candidates",
  async () => {
    // Scenario:
    // - Candidate A (synapse) - successful (reduces error)
    // - Candidate B (neuron) - successful (reduces error)
    // - Combined A+B - should be even better
    // - Candidate C (squash) - NOT successful (increases error)
    //
    // Combined creature should only combine A + B (not C).

    const helpfulSynapse = {
      fromNeuronUUID: "input-1",
      toNeuronUUID: "hidden-1",
      weight: 0.45,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.2,
      improvedCount: 4,
      totalCount: 6,
    };
    const helpfulNeuron = {
      fromNeuronUUID: "input-0",
      toNeuronUUID: "hidden-1",
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
    // This squash change doesn't actually help in this scenario
    const unhelpfulSquash = {
      neuronUUID: "hidden-1",
      previousSquash: "IDENTITY",
      squash: "STEP",
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.18,
      improvedError: 0.03,
      currentError: 0.07,
    };

    const discoveryResult: DiscoverResult = {
      ID: "TWO_PHASE_TEST",
      addHelpfulSynapses: [helpfulSynapse],
      addHelpfulNeurons: [helpfulNeuron],
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: [unhelpfulSquash],
    };

    const baseError = 0.5;

    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const synapses = json.synapses;
      const neurons = json.neurons;

      // Check for helpful synapse
      const hasHelpfulSynapse = synapses.some((synapse) =>
        synapse.fromUUID === helpfulSynapse.fromNeuronUUID &&
        synapse.toUUID === helpfulSynapse.toNeuronUUID &&
        Math.abs(synapse.weight - helpfulSynapse.weight) < 1e-6
      );

      // Check for helpful neuron (look for a new hidden neuron with TANH squash)
      const incomingDiscoverySynapse = synapses.find((synapse) =>
        synapse.fromUUID === helpfulNeuron.fromNeuronUUID &&
        Math.abs(synapse.weight - helpfulNeuron.incomingWeight) < 1e-6
      );
      const discoveredNeuronUUID = incomingDiscoverySynapse?.toUUID;
      const hasHelpfulNeuron = Boolean(
        discoveredNeuronUUID &&
          neurons.some((neuron) =>
            neuron.uuid === discoveredNeuronUUID && neuron.squash === "TANH"
          ),
      );

      // Check for unhelpful squash (hidden-1 changed to STEP)
      const hidden1 = neurons.find((neuron) => neuron.uuid === "hidden-1");
      const hasUnhelpfulSquash = hidden1?.squash === "STEP";

      // Assign errors based on what changes are present:
      // - Both helpful changes: best result (0.3)
      // - Just helpful synapse: 0.4
      // - Just helpful neuron: 0.4
      // - Unhelpful squash: WORSE (0.55)
      // - Original: 0.5

      if (hasHelpfulSynapse && hasHelpfulNeuron && !hasUnhelpfulSquash) {
        return 0.3; // Best - combined successful candidates
      }
      if (hasHelpfulSynapse && hasHelpfulNeuron && hasUnhelpfulSquash) {
        return 0.35; // Combined with bad squash - still okay but not best
      }
      if (hasHelpfulSynapse && !hasUnhelpfulSquash) {
        return 0.4; // Good improvement from synapse
      }
      if (hasHelpfulNeuron && !hasUnhelpfulSquash) {
        return 0.4; // Good improvement from neuron
      }
      if (hasUnhelpfulSquash) {
        return 0.55; // Worse than original - squash hurts
      }
      return baseError;
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

    // Should have an improvement
    assertExists(result.improvement, "Should find an improvement");

    // The best result should be the combined successful candidates (error=0.3)
    // not including the unhelpful squash change
    assertEquals(
      result.improvement.error < 0.35,
      true,
      `Best improvement should have error < 0.35 (combined successful), got ${result.improvement.error}`,
    );

    // Check evaluations
    assertExists(result.evaluations, "Should have evaluation summaries");

    // The squash-only candidate should show no improvement
    const squashOnlyEval = result.evaluations.find(
      (e) => e.changeType === "change-squash" && e.kind === "candidate",
    );
    if (squashOnlyEval) {
      assertEquals(
        squashOnlyEval.improved,
        false,
        "Squash-only candidate should show no improvement",
      );
    }

    // Verify the improvement message includes an emoji
    assert(
      /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(
        result.improvement.message,
      ),
      `Improvement message should include an emoji, got: ${result.improvement.message}`,
    );
  },
);

Deno.test(
  "DiscoveryRunner two-phase scoring: returns single candidate when no combinations improve",
  async () => {
    // Scenario: Only one candidate improves, so no combination phase

    const helpfulSynapse = {
      fromNeuronUUID: "input-1",
      toNeuronUUID: "hidden-1",
      weight: 0.45,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.2,
      improvedCount: 4,
      totalCount: 6,
    };

    const discoveryResult: DiscoverResult = {
      ID: "SINGLE_SUCCESS",
      addHelpfulSynapses: [helpfulSynapse],
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const hasHelpful = json.synapses.some((synapse) =>
        synapse.fromUUID === helpfulSynapse.fromNeuronUUID &&
        synapse.toUUID === helpfulSynapse.toNeuronUUID &&
        Math.abs(synapse.weight - helpfulSynapse.weight) < 1e-6
      );
      return hasHelpful ? 0.4 : 0.5;
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

    assertExists(result.improvement, "Should find single improvement");
    assertEquals(
      result.improvement.changeType.includes("combo"),
      false,
      "Should be a single candidate improvement, not a combo",
    );
  },
);

Deno.test(
  "DiscoveryRunner two-phase scoring: no combination phase when only one candidate succeeds",
  async () => {
    // Only one of multiple candidates improves, so no combination should be attempted

    const helpfulSynapse = {
      fromNeuronUUID: "input-1",
      toNeuronUUID: "hidden-1",
      weight: 0.45,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.2,
      improvedCount: 4,
      totalCount: 6,
    };
    // This neuron doesn't help
    const unhelpfulNeuron = {
      fromNeuronUUID: "input-0",
      toNeuronUUID: "hidden-1",
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

    const discoveryResult: DiscoverResult = {
      ID: "ONE_SUCCESS_ONLY",
      addHelpfulSynapses: [helpfulSynapse],
      addHelpfulNeurons: [unhelpfulNeuron],
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const synapses = json.synapses;
      const neurons = json.neurons;

      // Check for synapse (improves)
      const hasHelpfulSynapse = synapses.some((synapse) =>
        synapse.fromUUID === helpfulSynapse.fromNeuronUUID &&
        synapse.toUUID === helpfulSynapse.toNeuronUUID &&
        Math.abs(synapse.weight - helpfulSynapse.weight) < 1e-6
      );

      // Check for neuron (doesn't improve, makes it worse)
      const incomingDiscoverySynapse = synapses.find((synapse) =>
        synapse.fromUUID === unhelpfulNeuron.fromNeuronUUID &&
        Math.abs(synapse.weight - unhelpfulNeuron.incomingWeight) < 1e-6
      );
      const discoveredNeuronUUID = incomingDiscoverySynapse?.toUUID;
      const hasUnhelpfulNeuron = Boolean(
        discoveredNeuronUUID &&
          neurons.some((neuron) =>
            neuron.uuid === discoveredNeuronUUID && neuron.squash === "TANH"
          ),
      );

      if (hasHelpfulSynapse && hasUnhelpfulNeuron) {
        return 0.45; // Combined - neuron adds overhead
      }
      if (hasHelpfulSynapse) {
        return 0.4; // Best result - synapse alone
      }
      if (hasUnhelpfulNeuron) {
        return 0.55; // Worse - neuron alone hurts
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

    assertExists(result.improvement, "Should find an improvement");
    // The best should be synapse-only (error=0.4), not combined (error=0.45)
    assertEquals(
      result.improvement.error,
      0.4,
      "Best improvement should be synapse-only with error 0.4",
    );

    // Verify it's not a combo type
    assertEquals(
      result.improvement.changeType.includes("combo"),
      false,
      `Should be a single candidate, not combo. Got: ${result.improvement.changeType}`,
    );
  },
);

Deno.test(
  "DiscoveryRunner two-phase scoring: combination outperforms individual candidates",
  async () => {
    // Two candidates individually improve, and combined they're even better

    const helpfulSynapse = {
      fromNeuronUUID: "input-1",
      toNeuronUUID: "hidden-1",
      weight: 0.45,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.2,
      improvedCount: 4,
      totalCount: 6,
    };
    const helpfulSquash = {
      neuronUUID: "hidden-1",
      previousSquash: "IDENTITY",
      squash: "TANH",
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.15,
      improvedError: 0.03,
      currentError: 0.07,
    };

    const discoveryResult: DiscoverResult = {
      ID: "COMBO_WINS",
      addHelpfulSynapses: [helpfulSynapse],
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: [helpfulSquash],
    };

    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();

      const hasHelpfulSynapse = json.synapses.some((synapse) =>
        synapse.fromUUID === helpfulSynapse.fromNeuronUUID &&
        synapse.toUUID === helpfulSynapse.toNeuronUUID &&
        Math.abs(synapse.weight - helpfulSynapse.weight) < 1e-6
      );

      const hidden1 = json.neurons.find((neuron) => neuron.uuid === "hidden-1");
      const hasHelpfulSquash = hidden1?.squash === "TANH";

      // Combined is best
      if (hasHelpfulSynapse && hasHelpfulSquash) {
        return 0.3; // Combined - best
      }
      if (hasHelpfulSynapse) {
        return 0.4; // Synapse alone
      }
      if (hasHelpfulSquash) {
        return 0.42; // Squash alone
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

    assertExists(result.improvement, "Should find an improvement");

    // The best should be the combination (error=0.3)
    assertEquals(
      result.improvement.error,
      0.3,
      `Best improvement should be combined with error 0.3, got ${result.improvement.error}`,
    );

    // The change type should indicate it's a combination of successful candidates
    assert(
      result.improvement.changeType.includes("combo"),
      `Should be a combo type, got: ${result.improvement.changeType}`,
    );
  },
);
