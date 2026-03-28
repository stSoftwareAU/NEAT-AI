/**
 * Tests for Phase 2 combination threshold lowered to 1 successful single.
 *
 * Issue #1734: When Phase 1 produces only 1 successful single candidate,
 * supplement with historically successful candidates from the success cache
 * to enable Phase 2 combination building.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";

import { DEFAULT_COST_OF_GROWTH } from "../../src/config/NeatConfig.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Creature } from "../../src/Creature.ts";
import type { DiscoveryRunnerWorker } from "../../src/discovery/DiscoveryRunner.ts";
import { DiscoveryRunner } from "../../src/discovery/DiscoveryRunner.ts";
import { recordSuccessSync } from "../../src/discovery/SuccessCache.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
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

Deno.test({
  name:
    "DiscoveryRunner Phase 2 triggers with 1 successful single when cache supplements available",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tmpDir = Deno.makeTempDirSync();
    try {
      const base = makeBaseCreature();

      // Record a squash change in the success cache (simulates a previous
      // discovery run that found changing squash to TANH improved score).
      const cacheJson = base.exportJSON();
      const cacheNeuron = cacheJson.neurons.find(
        (n) => n.uuid === "hidden-1",
      );
      if (!cacheNeuron) throw new Error("hidden-1 not found");
      cacheNeuron.squash = "TANH";

      const cacheCreature = Creature.fromJSON(cacheJson);
      cacheCreature.validate();

      const cacheCandidate: DiscoveryCandidate = {
        creature: cacheCreature,
        change: {
          type: "change-squash",
          description: "Change squash on hidden-1 to TANH",
          squashCandidate: {
            neuronUuid: "hidden-1",
            previousSquash: "IDENTITY",
            squash: "TANH",
            expectedCreatureScoreGain: 0.1,
            improvedError: 0.05,
            currentError: 0.1,
          },
        },
      };

      recordSuccessSync(tmpDir, cacheCandidate, {
        originalScore: -0.5,
        candidateScore: -0.4,
        scoreDelta: 0.1,
        error: 0.4,
      }, base);

      // Discovery suggests an add-synapse candidate only.
      // Only the add-synapse will improve; creating exactly 1 Phase 1 success.
      const discoveryResult: DiscoverResult = {
        ID: "SUPPLEMENT_TEST",
        addHelpfulSynapses: [{
          fromNeuronUuid: "input-0",
          toNeuronUuid: "output-0",
          weight: 0.6,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.2,
          improvedCount: 5,
          totalCount: 7,
        }],
        addHelpfulNeurons: undefined,
        coordinatedStructuralCandidates: undefined,
        removeHarmfulSynapse: undefined,
        removeHarmfulNeurons: undefined,
        removalCandidates: undefined,
        candidateSquashes: undefined,
      };

      const computeError = (creature: Creature) => {
        const json = creature.exportJSON();
        const synapses = json.synapses;
        const hidden1Squash = json.neurons.find((n) => n.uuid === "hidden-1")
          ?.squash;

        const hasHelpful = synapses.some((synapse) =>
          synapse.fromUUID === "input-0" && synapse.toUUID === "output-0" &&
          Math.abs(synapse.weight - 0.6) < 1e-6
        );
        const changedSquash = hidden1Squash === "TANH";

        // Phase 2 combo: add-synapse + squash change
        if (hasHelpful && changedSquash) return 0.15;
        // Phase 1 singles
        if (hasHelpful) return 0.3;
        // Squash-only (not a Phase 1 candidate, but could appear as combo)
        if (changedSquash) return 0.45;

        return 0.5; // original
      };

      const runner = new DiscoveryRunner({
        rustDiscoveryEnabled: () => true,
        workerFactory: () => new FakeWorker(discoveryResult, computeError),
      });

      const result = await runner.discoverDir({
        creature: base,
        dataDir: "/tmp/data",
        options: makeOptions({
          discoverySuccessCacheDir: tmpDir,
        }),
      });

      // Should have an improvement (at minimum the Phase 1 single)
      assertExists(
        result.improvement,
        "Should have at least the Phase 1 improvement",
      );
      assert(
        result.improvement.scoreDelta > 0,
        "Improvement should have positive score delta",
      );

      // Phase 2 combo candidates should have been evaluated because the
      // runner supplemented the 1 Phase 1 success with the cache entry.
      const comboCandidates = result.evaluations?.filter(
        (e) => e.kind === "candidate" && e.changeType === "combo-successful",
      ) ?? [];
      assert(
        comboCandidates.length > 0,
        "Phase 2 should produce combo-successful candidates when " +
          "1 Phase 1 success is supplemented by cache data",
      );
    } finally {
      Deno.removeSync(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "DiscoveryRunner Phase 2 unchanged when 2+ Phase 1 successes exist",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // This test verifies the existing behaviour: when 2+ Phase 1 singles
    // succeed, Phase 2 builds combos from those singles without
    // supplementing from the cache.
    const discoveryResult: DiscoverResult = {
      ID: "TWO_SUCCESSES",
      addHelpfulSynapses: [{
        fromNeuronUuid: "input-0",
        toNeuronUuid: "output-0",
        weight: 0.6,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.2,
        improvedCount: 5,
        totalCount: 7,
      }],
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
      addHelpfulNeurons: undefined,
      coordinatedStructuralCandidates: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const synapses = json.synapses;

      const hasHelpful = synapses.some((synapse) =>
        synapse.fromUUID === "input-0" && synapse.toUUID === "output-0" &&
        Math.abs(synapse.weight - 0.6) < 1e-6
      );
      const removedHarmful = synapses.every((synapse) =>
        !(synapse.fromUUID === "input-1" && synapse.toUUID === "output-0")
      );

      // Combo
      if (hasHelpful && removedHarmful) return 0.2;
      // Singles
      if (hasHelpful) return 0.3;
      if (removedHarmful) return 0.35;
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

    assertExists(result.improvement, "Should have improvement");
    assert(
      result.improvement.scoreDelta > 0,
      "Should have positive score delta",
    );

    // Phase 2 combos should have been evaluated
    const comboCandidates = result.evaluations?.filter(
      (e) => e.kind === "candidate" && e.changeType === "combo-successful",
    ) ?? [];
    assert(
      comboCandidates.length > 0,
      "Should have combo-successful candidates evaluated",
    );
  },
});

Deno.test({
  name: "DiscoveryRunner Phase 2 skipped when 0 Phase 1 successes and no cache",
  async fn() {
    const discoveryResult: DiscoverResult = {
      ID: "ZERO_SUCCESSES",
      addHelpfulSynapses: [{
        fromNeuronUuid: "input-0",
        toNeuronUuid: "output-0",
        weight: 0.6,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.2,
        improvedCount: 5,
        totalCount: 7,
      }],
      addHelpfulNeurons: undefined,
      coordinatedStructuralCandidates: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    // No candidate improves
    const computeError = () => 0.5;

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () => new FakeWorker(discoveryResult, computeError),
    });

    const result = await runner.discoverDir({
      creature: makeBaseCreature(),
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    assertEquals(result.improvement, undefined, "No improvement expected");

    // Phase 2 combos should NOT have been evaluated
    const comboCandidates = result.evaluations?.filter(
      (e) => e.kind === "candidate" && e.changeType === "combo-successful",
    ) ?? [];
    assertEquals(
      comboCandidates.length,
      0,
      "Should not have combo candidates when 0 Phase 1 successes",
    );
  },
});
