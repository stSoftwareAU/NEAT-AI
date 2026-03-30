import { assert, assertEquals } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { DiscoverResult } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { DEFAULT_COST_OF_GROWTH } from "../../src/config/NeatConfig.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Creature } from "../../src/Creature.ts";
import type { DiscoveryRunnerWorker } from "../../src/discovery/DiscoveryRunner.ts";
import { DiscoveryRunner } from "../../src/discovery/DiscoveryRunner.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
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

Deno.test(
  "DiscoveryRunner respects discoveryMinCandidatesPerCategory for removal candidates",
  async () => {
    // Create a creature with 10 hidden neurons that can be removed
    const neurons: Array<{
      type: "hidden" | "output";
      uuid: string;
      squash: string;
      bias: number;
    }> = Array.from({ length: 10 }, (_, i) => ({
      type: "hidden" as const,
      uuid: `hidden-${i}`,
      squash: "RELU",
      bias: 0.1,
    }));
    neurons.push({
      type: "output",
      uuid: "output-0",
      squash: "IDENTITY",
      bias: 0,
    });

    const synapses = [
      ...Array.from({ length: 10 }, (_, i) => [
        { fromUUID: "input-0", toUUID: `hidden-${i}`, weight: 1e-12 },
        { fromUUID: `hidden-${i}`, toUUID: "output-0", weight: 1e-12 },
      ]).flat(),
      { fromUUID: "input-1", toUUID: "output-0", weight: 1.0 },
    ];

    const baseCreature = Creature.fromJSON({
      input: 2,
      output: 1,
      neurons,
      synapses,
    });
    baseCreature.validate();
    CreatureUtil.makeUUID(baseCreature);

    const baseNeuronCount = baseCreature.exportJSON().neurons.length;

    // Track which candidates are evaluated
    let removalEvaluated = 0;

    const discoveryResult: DiscoverResult = {
      ID: "MIN_REMOVAL_CANDIDATES_TEST",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      // Create 10 removal candidates (matching our creature's hidden neurons)
      removalCandidates: Array.from({ length: 10 }, (_, i) => ({
        neuronUuid: `hidden-${i}`,
        totalError: 0.1,
        impact: 1e-15 * (i + 1), // Different impacts for sorting
        reason: "low-impact",
      })),
      candidateSquashes: undefined,
    };

    const computeError = (_creature: Creature) => 0.5;

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () => {
        const worker = new FakeWorker(discoveryResult, computeError);
        // Wrap evaluate to track removal candidates
        const originalEvaluate = worker.evaluate.bind(worker);
        worker.evaluate = async (creature, feedbackLoop) => {
          const json = creature.exportJSON();
          // Check if it's a removal candidate (fewer neurons than base)
          if (json.neurons.length < baseNeuronCount) {
            removalEvaluated++;
          }
          return await originalEvaluate(creature, feedbackLoop);
        };
        return worker;
      },
    });

    // Test with custom minimum of 5 removal candidates instead of default 3
    const options = makeOptions({
      discoveryMinCandidatesPerCategory: {
        removeLowImpact: 5,
      },
    });

    await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options,
    });

    // Phase 1 evaluates 5 single removal candidates (configured minimum)
    // Phase 2 generates combination candidates from successful singles (up to maxCandidates = 2)
    // Total: 5 single + 2 combinations = 7
    assertEquals(
      removalEvaluated,
      7,
      `Expected 7 removal evaluations (5 single + 2 combos), got ${removalEvaluated}`,
    );
  },
);

Deno.test(
  "DiscoveryRunner respects discoveryMinCandidatesPerCategory for add-neurons",
  async () => {
    // Track how many add-neurons candidates are evaluated
    let addNeuronsEvaluated = 0;

    // Create discovery result with many add-neurons candidates.
    // Use hidden-${i} as fromNeuronUuid — each candidate needs a unique from→to key.
    const addHelpfulNeurons = Array.from({ length: 10 }, (_, i) => ({
      fromNeuronUuid: `hidden-${i}`,
      toNeuronUuid: "output-0",
      squash: "RELU" as const,
      incomingWeight: 0.5 + i * 0.01,
      outgoingWeight: 0.5 + i * 0.01,
      bias: 0.1 + i * 0.001,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.01 - i * 0.0001, // Decreasing improvement
      improvedCount: 8 - i,
      totalCount: 10,
    }));

    const discoveryResult: DiscoverResult = {
      ID: "MIN_ADD_NEURONS_TEST",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    // Build a creature with 10 hidden neurons (hidden-0..hidden-9) so that
    // all 10 addHelpfulNeurons candidates have valid fromNeuronUuid endpoints.
    const neurons: Array<{
      type: "hidden" | "output";
      uuid: string;
      squash: string;
      bias: number;
    }> = Array.from({ length: 10 }, (_, i) => ({
      type: "hidden" as const,
      uuid: `hidden-${i}`,
      squash: "RELU",
      bias: 0.1,
    }));
    neurons.push({
      type: "output",
      uuid: "output-0",
      squash: "IDENTITY",
      bias: 0,
    });
    const synapses = [
      ...Array.from({ length: 10 }, (_, i) => [
        { fromUUID: "input-0", toUUID: `hidden-${i}`, weight: 1e-12 },
        { fromUUID: `hidden-${i}`, toUUID: "output-0", weight: 1e-12 },
      ]).flat(),
      { fromUUID: "input-1", toUUID: "output-0", weight: 1.0 },
    ];
    const baseCreature = Creature.fromJSON({
      input: 2,
      output: 1,
      neurons,
      synapses,
    });
    baseCreature.validate();
    CreatureUtil.makeUUID(baseCreature);

    const baseNeuronCount = baseCreature.exportJSON().neurons.length;

    const computeError = (_creature: Creature) => 0.5;

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () => {
        const worker = new FakeWorker(discoveryResult, computeError);
        const originalEvaluate = worker.evaluate.bind(worker);
        worker.evaluate = async (creature, feedbackLoop) => {
          const json = creature.exportJSON();
          // Check if it's an add-neurons candidate (more neurons than base)
          if (json.neurons.length > baseNeuronCount) {
            addNeuronsEvaluated++;
          }
          return await originalEvaluate(creature, feedbackLoop);
        };
        return worker;
      },
    });

    // Test with custom minimum of 5 add-neurons candidates instead of default 1
    const options = makeOptions({
      discoveryMinCandidatesPerCategory: {
        addNeurons: 5,
      },
    });

    await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options,
    });

    // Should evaluate at least 5 (the configured minimum) from add-neurons category
    // May evaluate more if there are available slots
    assert(
      addNeuronsEvaluated >= 5,
      `Expected at least 5 add-neurons candidates to be evaluated (configured minimum), got ${addNeuronsEvaluated}`,
    );
  },
);

Deno.test(
  "DiscoveryRunner uses default values when discoveryMinCandidatesPerCategory is not set",
  async () => {
    // Create a creature with 10 hidden neurons that can be removed
    const neurons: Array<{
      type: "hidden" | "output";
      uuid: string;
      squash: string;
      bias: number;
    }> = Array.from({ length: 10 }, (_, i) => ({
      type: "hidden" as const,
      uuid: `hidden-${i}`,
      squash: "RELU",
      bias: 0.1,
    }));
    neurons.push({
      type: "output",
      uuid: "output-0",
      squash: "IDENTITY",
      bias: 0,
    });

    const synapses = [
      ...Array.from({ length: 10 }, (_, i) => [
        { fromUUID: "input-0", toUUID: `hidden-${i}`, weight: 1e-12 },
        { fromUUID: `hidden-${i}`, toUUID: "output-0", weight: 1e-12 },
      ]).flat(),
      { fromUUID: "input-1", toUUID: "output-0", weight: 1.0 },
    ];

    const baseCreature = Creature.fromJSON({
      input: 2,
      output: 1,
      neurons,
      synapses,
    });
    baseCreature.validate();
    CreatureUtil.makeUUID(baseCreature);

    const baseNeuronCount = baseCreature.exportJSON().neurons.length;

    // Track removal candidates evaluated
    let removalEvaluated = 0;

    const discoveryResult: DiscoverResult = {
      ID: "DEFAULT_MIN_CANDIDATES_TEST",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      // Create 10 removal candidates (matching our creature's hidden neurons)
      removalCandidates: Array.from({ length: 10 }, (_, i) => ({
        neuronUuid: `hidden-${i}`,
        totalError: 0.1,
        impact: 1e-15 * (i + 1),
        reason: "low-impact",
      })),
      candidateSquashes: undefined,
    };

    const computeError = (_creature: Creature) => 0.5;

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () => {
        const worker = new FakeWorker(discoveryResult, computeError);
        const originalEvaluate = worker.evaluate.bind(worker);
        worker.evaluate = async (creature, feedbackLoop) => {
          const json = creature.exportJSON();
          if (json.neurons.length < baseNeuronCount) {
            removalEvaluated++;
          }
          return await originalEvaluate(creature, feedbackLoop);
        };
        return worker;
      },
    });

    // Use default options (no discoveryMinCandidatesPerCategory override)
    const options = makeOptions({});

    await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options,
    });

    // Default for removeLowImpact is 3 single candidates
    // Phase 2 generates combination candidates from successful singles (up to maxCandidates = 2)
    // Total: 3 single + 2 combinations = 5
    assertEquals(
      removalEvaluated,
      5,
      `Expected 5 removal evaluations (3 single + 2 combos), got ${removalEvaluated}`,
    );
  },
);

Deno.test({
  name:
    "DiscoveryRunner logs specific candidate types when skipped due to cache",
  // Uses Rust FFI via recordFailure -> getDiscoveryVersion
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const cacheDir = `${tempDir}/failure-cache`;

    try {
      // Create discovery result with both synapse and squash candidates
      const discoveryResult: DiscoverResult = {
        ID: "CACHE_TYPE_LOGGING_TEST",
        addHelpfulSynapses: [{
          fromNeuronUuid: "input-1",
          toNeuronUuid: "hidden-1",
          weight: 0.45,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.2,
          improvedCount: 5,
          totalCount: 6,
        }],
        addHelpfulNeurons: undefined,
        removeHarmfulSynapse: undefined,
        removeHarmfulNeurons: undefined,
        removalCandidates: undefined,
        candidateSquashes: [{
          neuronUuid: "hidden-1",
          previousSquash: "IDENTITY",
          squash: "TANH",
          expectedCreatureScoreGain: 0.3,
          improvedError: 0.03,
          currentError: 0.1,
        }],
      };

      // All candidates will fail (worse than original)
      const computeError = (_creature: Creature) => 0.6;

      const runner = new DiscoveryRunner({
        rustDiscoveryEnabled: () => true,
        workerFactory: () =>
          new FakeWorker(
            discoveryResult,
            computeError,
          ),
      });

      // First run - cache failures
      await runner.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options: makeOptions({ discoveryFailureCacheDir: cacheDir }),
      });

      // Capture console output for second run
      const captured: string[] = [];
      const originalInfo = console.info.bind(console);
      console.info = (...args: unknown[]) => {
        captured.push(args.map((arg) => String(arg)).join(" "));
        originalInfo(...args);
      };

      try {
        // Second run - should log specific types being skipped
        await runner.discoverDir({
          creature: makeBaseCreature(),
          dataDir: "/tmp/data",
          options: makeOptions({ discoveryFailureCacheDir: cacheDir }),
        });
      } finally {
        console.info = originalInfo;
      }

      // Find the skip log line
      const skipLine = captured.find((line) =>
        line.includes("[DiscoveryRunner]") && line.includes("Skipped") &&
        line.includes("previous failure")
      );

      assert(
        skipLine,
        "Expected a log line about skipped candidates due to previous failure",
      );

      // Verify the log includes specific types, not just "other candidates"
      assert(
        skipLine.includes("add-synapses") || skipLine.includes("change-squash"),
        `Expected skip log to include specific candidate types, got: ${skipLine}`,
      );

      // Verify it does NOT just say "other candidates" without breakdown
      const hasTypeBreakdown = skipLine.includes("add-synapses") ||
        skipLine.includes("change-squash");
      assert(
        hasTypeBreakdown,
        `Expected type breakdown in skip log, got: ${skipLine}`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "DiscoveryRunner passes discoveryFailureCacheDir to candidate builder",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const cacheDir = `${tempDir}/failure-cache`;

    try {
      const discoveryResult: DiscoverResult = {
        ID: "CACHE_DIR_PASSTHROUGH_TEST",
        addHelpfulSynapses: [{
          fromNeuronUuid: "input-1",
          toNeuronUuid: "hidden-1",
          weight: 0.45,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.2,
          improvedCount: 5,
          totalCount: 6,
        }],
        addHelpfulNeurons: undefined,
        removeHarmfulSynapse: undefined,
        removeHarmfulNeurons: undefined,
        removalCandidates: undefined,
        candidateSquashes: undefined,
      };

      // Track what options were passed to the candidate builder
      let capturedOptions: { discoveryFailureCacheDir?: string } | undefined;

      const mockCandidateBuilder = (
        creature: Creature,
        _discovery: DiscoverResult,
        options?: {
          skipCombinedCandidates?: boolean;
          discoveryFailureCacheDir?: string;
        },
      ): DiscoveryCandidate[] => {
        // Capture the options for assertion
        capturedOptions = options;

        // Return a simple candidate
        const cloned = Creature.fromJSON(creature.exportJSON());
        CreatureUtil.makeUUID(cloned);
        return [{
          creature: cloned,
          change: {
            type: "add-synapses",
            description: "Test candidate",
          },
        }];
      };

      const runner = new DiscoveryRunner({
        rustDiscoveryEnabled: () => true,
        workerFactory: () =>
          new FakeWorker(
            discoveryResult,
            () => 0.5, // Fixed error
          ),
        candidateBuilder: mockCandidateBuilder,
      });

      await runner.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options: makeOptions({ discoveryFailureCacheDir: cacheDir }),
      });

      // Verify discoveryFailureCacheDir was passed to the candidate builder
      assertEquals(
        capturedOptions?.discoveryFailureCacheDir,
        cacheDir,
        "discoveryFailureCacheDir should be passed to candidate builder to enable issue recording",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// NOTE: Tests for TypeScript cost-of-growth filtering have been removed.
// Rust is the single source of truth for candidate filtering (DRY principle).
// See NEAT-AI-Discovery v0.1.133 for filtering logic.
