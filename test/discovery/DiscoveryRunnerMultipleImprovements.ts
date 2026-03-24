/**
 * Tests for returning multiple successful discoveries from DiscoveryRunner.
 *
 * Issue #1732: When multiple candidates improve on the original, all
 * improvements should be returned — not just the single best one.
 * The primary/best improvement remains in `improvement` for backward
 * compatibility, while `additionalImprovements` holds the rest sorted
 * by score descending.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";

// Integer ID for hidden-1 neuron in makeBaseCreature() (explicit id in fixture)
const ID_HIDDEN_1 = 5001;
import { DEFAULT_COST_OF_GROWTH } from "../../src/config/NeatConfig.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import type { Creature } from "../../src/Creature.ts";
import type { DiscoveryRunnerWorker } from "../../src/discovery/DiscoveryRunner.ts";
import { DiscoveryRunner } from "../../src/discovery/DiscoveryRunner.ts";
import { makeBaseCreature } from "../fixtures/SimpleCreatures.ts";

class FakeWorker implements DiscoveryRunnerWorker {
  #discoverResult: DiscoverResult;
  #computeError: (creature: Creature) => number;

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
    const error = this.#computeError(creature);
    return Promise.resolve({
      taskID: 2,
      duration: 5,
      evaluate: { error },
    });
  }

  terminate(): void {
    // no-op
  }
}

function makeOptions(overrides: NeatOptions = {}): NeatOptions {
  return {
    discoveryRecordTimeOutMinutes: 0.05,
    discoveryAnalysisTimeoutMinutes: 0.05,
    threads: 1,
    costOfGrowth: DEFAULT_COST_OF_GROWTH,
    costName: "MSE",
    ...overrides,
  };
}

// Base creature synapses:
//   input-0 → hidden-1 (0.5)
//   hidden-1 → output-0 (0.5)
//   input-1 → output-0 (-0.25)
// Use input-0 → output-0 for add-synapse (doesn't already exist).

Deno.test(
  "DiscoveryRunner returns additionalImprovements when multiple candidates improve",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "MULTI_IMPROVE",
      addHelpfulSynapses: [{
        fromNeuronId: 0,
        toNeuronId: -1,
        weight: 0.6,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.2,
        improvedCount: 5,
        totalCount: 7,
      }],
      removeHarmfulSynapse: {
        fromNeuronId: 1,
        toNeuronId: -1,
        weight: -0.25,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.1,
        improvedCount: 3,
        totalCount: 7,
      },
      candidateSquashes: [{
        neuronId: ID_HIDDEN_1,
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

    // All candidate types improve; each has a different error
    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const synapses = json.synapses;
      const hidden1Squash = json.neurons.find((n) => n.id === ID_HIDDEN_1)
        ?.squash;

      const hasHelpful = synapses.some((synapse) =>
        synapse.fromId === 0 && synapse.toId === -1 &&
        Math.abs(synapse.weight - 0.6) < 1e-6
      );
      const removedHarmful = synapses.every((synapse) =>
        !(synapse.fromId === 1 && synapse.toId === -1)
      );
      const changedSquash = hidden1Squash === "TANH";

      // Combo candidates (Phase 2)
      if (hasHelpful && removedHarmful && changedSquash) return 0.15;
      if (hasHelpful && removedHarmful) return 0.2;
      if (hasHelpful && changedSquash) return 0.22;

      // Single candidates (Phase 1) — all improve on original (0.5)
      if (hasHelpful) return 0.3; // add-synapse: best single
      if (removedHarmful) return 0.35; // remove-synapse: second single
      if (changedSquash) return 0.4; // change-squash: third single

      return 0.5; // original
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () => new FakeWorker(discoveryResult, computeError),
    });

    const result = await runner.discoverDir({
      creature: makeBaseCreature(),
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    // The best improvement should still be in `improvement`
    assertExists(result.improvement, "Primary improvement should exist");
    assert(
      result.improvement.scoreDelta > 0,
      "Primary improvement should have positive score delta",
    );

    // Additional improvements should also be present
    assertExists(
      result.additionalImprovements,
      "additionalImprovements should exist when multiple candidates improve",
    );
    assert(
      result.additionalImprovements.length > 0,
      "Should have at least one additional improvement",
    );

    // All additional improvements should have positive score deltas
    for (const imp of result.additionalImprovements) {
      assert(
        imp.scoreDelta > 0,
        `Additional improvement should have positive scoreDelta, got ${imp.scoreDelta}`,
      );
    }

    // The primary improvement should be better than all additional ones
    for (const imp of result.additionalImprovements) {
      assert(
        result.improvement.score >= imp.score,
        "Primary improvement should have the highest score",
      );
    }

    // Additional improvements should be sorted by score descending
    for (let i = 1; i < result.additionalImprovements.length; i++) {
      assert(
        result.additionalImprovements[i - 1].score >=
          result.additionalImprovements[i].score,
        "Additional improvements should be sorted by score descending",
      );
    }
  },
);

Deno.test(
  "DiscoveryRunner returns no additionalImprovements when only one candidate improves",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "SINGLE_IMPROVE",
      addHelpfulSynapses: [{
        fromNeuronId: 0,
        toNeuronId: -1,
        weight: 0.6,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.2,
        improvedCount: 5,
        totalCount: 7,
      }],
      candidateSquashes: [{
        neuronId: ID_HIDDEN_1,
        previousSquash: "IDENTITY",
        squash: "TANH",
        expectedCreatureScoreGain: 0.3,
        improvedError: 0.05,
        currentError: 0.1,
      }],
      removeHarmfulSynapse: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
    };

    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const synapses = json.synapses;

      const hasHelpful = synapses.some((synapse) =>
        synapse.fromId === 0 && synapse.toId === -1 &&
        Math.abs(synapse.weight - 0.6) < 1e-6
      );

      // Only add-synapse improves; squash change does not
      if (hasHelpful) return 0.3;
      return 0.5; // original and squash change both get this
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () => new FakeWorker(discoveryResult, computeError),
    });

    const result = await runner.discoverDir({
      creature: makeBaseCreature(),
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    assertExists(result.improvement, "Primary improvement should exist");
    assertEquals(
      result.additionalImprovements,
      undefined,
      "No additional improvements when only one candidate improves",
    );
  },
);

Deno.test(
  "DiscoveryRunner returns no additionalImprovements when no candidates improve",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "NO_IMPROVE",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () => new FakeWorker(discoveryResult, () => 1.0),
    });

    const result = await runner.discoverDir({
      creature: makeBaseCreature(),
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    assertEquals(result.improvement, undefined);
    assertEquals(result.additionalImprovements, undefined);
  },
);

Deno.test(
  "DiscoveryRunner additionalImprovements contain correct fields",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "FIELD_CHECK",
      addHelpfulSynapses: [{
        fromNeuronId: 0,
        toNeuronId: -1,
        weight: 0.6,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.2,
        improvedCount: 5,
        totalCount: 7,
      }],
      candidateSquashes: [{
        neuronId: ID_HIDDEN_1,
        previousSquash: "IDENTITY",
        squash: "TANH",
        expectedCreatureScoreGain: 0.3,
        improvedError: 0.05,
        currentError: 0.1,
      }],
      removeHarmfulSynapse: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
    };

    // Both candidates improve
    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const synapses = json.synapses;
      const hidden1Squash = json.neurons.find((n) => n.id === ID_HIDDEN_1)
        ?.squash;

      const hasHelpful = synapses.some((synapse) =>
        synapse.fromId === 0 && synapse.toId === -1 &&
        Math.abs(synapse.weight - 0.6) < 1e-6
      );
      const changedSquash = hidden1Squash === "TANH";

      if (hasHelpful) return 0.3;
      if (changedSquash) return 0.4;
      return 0.5;
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () => new FakeWorker(discoveryResult, computeError),
    });

    const result = await runner.discoverDir({
      creature: makeBaseCreature(),
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    assertExists(result.improvement);
    assertExists(result.additionalImprovements);
    assert(
      result.additionalImprovements.length >= 1,
      "Should have at least one additional improvement",
    );

    const additional = result.additionalImprovements[0];

    // Verify all required fields are present
    assert(typeof additional.changeType === "string", "changeType required");
    assert(typeof additional.error === "number", "error required");
    assert(typeof additional.score === "number", "score required");
    assert(typeof additional.scoreDelta === "number", "scoreDelta required");
    assert(typeof additional.message === "string", "message required");
    assertExists(additional.creature, "creature export required");
    assert(
      additional.creature.neurons.length > 0,
      "creature should have neurons",
    );
  },
);

Deno.test(
  "DiscoveryRunner primary improvement is excluded from additionalImprovements",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "NO_DUPE",
      addHelpfulSynapses: [{
        fromNeuronId: 0,
        toNeuronId: -1,
        weight: 0.6,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.2,
        improvedCount: 5,
        totalCount: 7,
      }],
      candidateSquashes: [{
        neuronId: ID_HIDDEN_1,
        previousSquash: "IDENTITY",
        squash: "TANH",
        expectedCreatureScoreGain: 0.3,
        improvedError: 0.05,
        currentError: 0.1,
      }],
      removeHarmfulSynapse: {
        fromNeuronId: 1,
        toNeuronId: -1,
        weight: -0.25,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.1,
        improvedCount: 3,
        totalCount: 7,
      },
      addHelpfulNeurons: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
    };

    // All three single candidates improve
    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const synapses = json.synapses;
      const hidden1Squash = json.neurons.find((n) => n.id === ID_HIDDEN_1)
        ?.squash;

      const hasHelpful = synapses.some((synapse) =>
        synapse.fromId === 0 && synapse.toId === -1 &&
        Math.abs(synapse.weight - 0.6) < 1e-6
      );
      const removedHarmful = synapses.every((synapse) =>
        !(synapse.fromId === 1 && synapse.toId === -1)
      );
      const changedSquash = hidden1Squash === "TANH";

      // Combo candidates
      if (hasHelpful && removedHarmful && changedSquash) return 0.1;
      if (hasHelpful && removedHarmful) return 0.15;
      if (hasHelpful && changedSquash) return 0.18;

      // Singles
      if (hasHelpful) return 0.25;
      if (removedHarmful) return 0.3;
      if (changedSquash) return 0.35;

      return 0.5; // original
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () => new FakeWorker(discoveryResult, computeError),
    });

    const result = await runner.discoverDir({
      creature: makeBaseCreature(),
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    assertExists(result.improvement);
    assertExists(result.additionalImprovements);

    // The primary improvement's score should NOT appear in additionalImprovements
    const primaryScore = result.improvement.score;
    const primaryChangeType = result.improvement.changeType;

    // Verify no duplicate of the primary in additional
    const hasDuplicate = result.additionalImprovements.some(
      (imp) =>
        imp.score === primaryScore && imp.changeType === primaryChangeType,
    );
    assertEquals(
      hasDuplicate,
      false,
      "Primary improvement should not be duplicated in additionalImprovements",
    );
  },
);
