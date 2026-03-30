import { assert, assertEquals } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { DiscoverResult } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { DEFAULT_COST_OF_GROWTH } from "@config/NeatConfig.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Creature } from "@creature";
import type { DiscoveryRunnerWorker } from "@discovery/DiscoveryRunner.ts";
import { DiscoveryRunner } from "@discovery/DiscoveryRunner.ts";
import type { DiscoveryCandidate } from "@discovery/DiscoveryCandidates.ts";
import { makeBaseCreature } from "../fixtures/SimpleCreatures.ts";

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

Deno.test(
  "DiscoveryRunner evaluates removal candidates and includes them in evaluation summaries",
  async () => {
    // Create a creature with a hidden neuron that has near-zero weight synapses
    // (low impact but valid structure)
    const baseCreature = Creature.fromJSON({
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-low-impact",
          squash: "RELU",
          bias: 0.5,
        },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-low-impact", weight: 1e-12 },
        { fromUUID: "hidden-low-impact", toUUID: "output-0", weight: 1e-12 },
        { fromUUID: "input-1", toUUID: "output-0", weight: 1.0 },
      ],
    });
    baseCreature.validate();
    CreatureUtil.makeUUID(baseCreature);

    // Discovery result with a removal candidate from Rust
    const discoveryResult: DiscoverResult = {
      ID: "REMOVAL_TEST",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: [
        {
          neuronUuid: "hidden-low-impact",
          totalError: 5.0,
          impact: 0.001, // Very low impact (0.1%)
          reason: "High error but very low impact - candidate for removal",
        },
      ],
      candidateSquashes: undefined,
    };

    // Error function - removal should improve score via complexity reduction
    const baselineError = 0.5;
    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const hasHiddenNeuron = json.neurons.some(
        (n) => n.uuid === "hidden-low-impact",
      );
      // Removal may slightly increase error, but improves score via complexity reduction
      return hasHiddenNeuron ? baselineError : baselineError + 0.001;
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () =>
        new FakeWorker(
          discoveryResult,
          computeError,
        ),
      // Use default candidateBuilder (buildDiscoveryCandidates) to test full flow
    });

    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options: makeOptions({ costOfGrowth: 0.01 }), // Set costOfGrowth so removal has benefit
    });

    // Verify evaluation summaries include the removal candidate
    const candidateEvaluations =
      result.evaluations?.filter((entry) => entry.kind === "candidate") ?? [];

    // Should have at least one removal candidate evaluated
    const removalCandidates = candidateEvaluations.filter(
      (entry) => entry.changeType === "remove-low-impact",
    );

    assertEquals(
      removalCandidates.length,
      1,
      `Expected 1 remove-low-impact candidate in evaluations, got ${removalCandidates.length}. ` +
        `All candidate types: ${
          candidateEvaluations.map((e) => e.changeType).join(", ")
        }`,
    );

    // Verify the removal candidate has the expected description
    const removalCandidate = removalCandidates[0];
    assert(
      removalCandidate.description?.includes("Removed neuron") &&
        removalCandidate.description?.includes("impact:"),
      `Expected description to mention 'Removed neuron' and 'impact:', got: ${removalCandidate.description}`,
    );
  },
);

Deno.test(
  "DiscoveryRunner reserves slots for removal candidates even when many other candidates exist",
  async () => {
    const baseCreature = makeBaseCreature();

    // Discovery result - we'll use custom candidateBuilder to control candidates
    const discoveryResult: DiscoverResult = {
      ID: "REMOVAL_SLOT_RESERVATION",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    // Custom candidate builder that creates many add-neuron candidates
    // and several removal candidates
    const candidateBuilder = (
      _creature: Creature,
      _discovery: DiscoverResult,
    ): DiscoveryCandidate[] => {
      const candidates: DiscoveryCandidate[] = [];

      // Create 20 add-neuron candidates with high expected impact
      for (let i = 0; i < 20; i++) {
        const candidate = Creature.fromJSON(cloneCreatureJSON(baseCreature));
        candidate.validate();
        CreatureUtil.makeUUID(candidate);
        candidates.push({
          creature: candidate,
          change: {
            type: "add-neurons",
            description: `add-neuron-${i}`,
            expectedErrorReduction: 0.1 - i * 0.001, // Descending from 10% to 8.1%
          },
        });
      }

      // Create 10 removal candidates (undefined expected impact)
      for (let i = 0; i < 10; i++) {
        const candidate = Creature.fromJSON(cloneCreatureJSON(baseCreature));
        candidate.validate();
        CreatureUtil.makeUUID(candidate);
        candidates.push({
          creature: candidate,
          change: {
            type: "remove-low-impact",
            description: `removal-${i}`,
            // No expectedErrorReduction - removal candidates have undefined
          },
        });
      }

      return candidates;
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

    // Use only 2 threads to get max 4 candidates (tight budget forces selection)
    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options: makeOptions({ threads: 2 }), // max 4 candidates
    });

    const candidateEvaluations =
      result.evaluations?.filter((entry) => entry.kind === "candidate") ?? [];

    // With max 4 candidates:
    // - Removal slots = min(10, max(3, floor(4*0.25))) = min(10, 3) = 3
    // - Other slots = 4 - 3 = 1
    // So we should see at least 1 removal candidate evaluated
    const removalEvaluations = candidateEvaluations.filter(
      (e) => e.changeType === "remove-low-impact",
    );

    assert(
      removalEvaluations.length >= 1,
      `Expected at least 1 removal candidate to be evaluated even with many add-neuron candidates. ` +
        `Got ${removalEvaluations.length} removal evaluations out of ${candidateEvaluations.length} total. ` +
        `All evaluations: ${
          candidateEvaluations.map((e) => e.changeType).join(", ")
        }`,
    );
  },
);
