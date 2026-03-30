import { assert, assertEquals } from "@std/assert";
import type { DiscoverResult } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { DEFAULT_COST_OF_GROWTH } from "@config/NeatConfig.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { Creature } from "@creature";
import type { DiscoveryRunnerWorker } from "@discovery/DiscoveryRunner.ts";
import { DiscoveryRunner } from "@discovery/DiscoveryRunner.ts";
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

Deno.test({
  name:
    "DiscoveryRunner caches failed candidates when discoveryFailureCacheDir is set",
  // Uses Rust FFI via recordFailure -> getDiscoveryVersion
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const cacheDir = `${tempDir}/failure-cache`;

    try {
      const discoveryResult: DiscoverResult = {
        ID: "CACHE_FAILURES_TEST",
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

      // All candidates will fail (worse than original)
      const computeError = (_creature: Creature) => 0.6; // All worse

      const runner = new DiscoveryRunner({
        rustDiscoveryEnabled: () => true,
        workerFactory: () =>
          new FakeWorker(
            discoveryResult,
            computeError,
          ),
      });

      await runner.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options: makeOptions({ discoveryFailureCacheDir: cacheDir }),
      });

      // Verify cache directory was created and has content
      const typeDir = `${cacheDir}/add-synapses`;
      const entries: Deno.DirEntry[] = [];
      for await (const entry of Deno.readDir(typeDir)) {
        entries.push(entry);
      }

      assert(
        entries.length > 0,
        "Cache directory should contain at least one entry for failed candidate",
      );

      // Verify the cache file contains expected metadata
      const cacheFile = entries[0];
      const cacheContent = JSON.parse(
        await Deno.readTextFile(`${typeDir}/${cacheFile.name}`),
      );
      assertEquals(
        cacheContent.changeType,
        "add-synapses",
        "Cache entry should have correct change type",
      );
      assert(
        cacheContent.timestamp,
        "Cache entry should have timestamp",
      );
      assert(
        cacheContent.scoreDelta < 0 || cacheContent.scoreDelta === 0,
        "Cache entry should show non-positive score delta (failure)",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "DiscoveryRunner skips cached candidates on subsequent runs",
  // Uses Rust FFI via recordFailure -> getDiscoveryVersion
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const cacheDir = `${tempDir}/failure-cache`;

    try {
      const discoveryResult: DiscoverResult = {
        ID: "SKIP_CACHED_TEST",
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

      let evaluationCount = 0;
      const computeError = (creature: Creature) => {
        // Count evaluations (excluding original which has no candidate)
        const json = creature.exportJSON();
        normaliseCreatureExport(json);
        const hasTestSynapse = json.synapses.some((s) =>
          s.fromUUID === "input-1" && s.toUUID === "hidden-1" &&
          Math.abs(s.weight - 0.45) < 1e-6
        );
        if (hasTestSynapse) {
          evaluationCount++;
        }
        return 0.6; // All worse
      };

      const runner = new DiscoveryRunner({
        rustDiscoveryEnabled: () => true,
        workerFactory: () =>
          new FakeWorker(
            discoveryResult,
            computeError,
          ),
      });

      const options = makeOptions({ discoveryFailureCacheDir: cacheDir });

      // First run - should evaluate the candidate
      await runner.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options,
      });

      const firstRunEvaluations = evaluationCount;
      assert(
        firstRunEvaluations >= 1,
        `First run should evaluate at least one synapse candidate, got ${firstRunEvaluations}`,
      );

      // Reset counter
      evaluationCount = 0;

      // Second run - should skip cached candidates
      const result2 = await runner.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options,
      });

      // The synapse candidate should not be evaluated again (cached)
      assertEquals(
        evaluationCount,
        0,
        "Second run should not evaluate cached candidates",
      );

      // Verify no improvement (since we skipped all candidates)
      assertEquals(
        result2.improvement,
        undefined,
        "Should have no improvement when all candidates are cached",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "DiscoveryRunner skips cached Phase 2 combined candidates on subsequent runs",
  // Uses Rust FFI via recordFailure -> getDiscoveryVersion
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const cacheDir = `${tempDir}/failure-cache`;

    try {
      // Use one add-synapse and one squash change. Both improve individually,
      // but their phase-2 combination is worse and should be cached as a failed
      // combined candidate on the first run.
      const discoveryResult: DiscoverResult = {
        ID: "PHASE2_CACHE_TEST",
        addHelpfulSynapses: [{
          fromNeuronUuid: "input-0",
          toNeuronUuid: "output-0",
          weight: 0.6,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.3,
          improvedCount: 5,
          totalCount: 7,
        }],
        addHelpfulNeurons: undefined,
        removeHarmfulSynapse: undefined,
        removeHarmfulNeurons: undefined,
        removalCandidates: undefined,
        candidateSquashes: [
          {
            neuronUuid: "hidden-1",
            previousSquash: "IDENTITY",
            squash: "TANH",
            expectedCreatureScoreGain: 0.3,
            improvedError: 0.4,
            currentError: 0.5,
          },
        ],
      };

      let phase2EvaluationCount = 0;

      const computeError = (creature: Creature) => {
        const json = creature.exportJSON();
        normaliseCreatureExport(json);

        const hasHelpfulSynapse = json.synapses.some((s) =>
          s.fromUUID === "input-0" && s.toUUID === "output-0" &&
          Math.abs(s.weight - 0.6) < 1e-6
        );
        const hasTanh = json.neurons.some((n) =>
          n.uuid === "hidden-1" && n.squash === "TANH"
        );

        if (hasHelpfulSynapse && hasTanh) {
          phase2EvaluationCount++;
          return 0.6; // Combined candidate is worse
        }

        if (hasHelpfulSynapse || hasTanh) {
          return 0.4; // Individual candidates improve
        }

        return 0.5; // Original
      };

      const runner = new DiscoveryRunner({
        rustDiscoveryEnabled: () => true,
        workerFactory: () =>
          new FakeWorker(
            discoveryResult,
            computeError,
          ),
      });

      const options = makeOptions({ discoveryFailureCacheDir: cacheDir });

      // First run - Phase 2 combined candidate should be evaluated and cached
      await runner.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options,
      });

      const firstRunPhase2Evaluations = phase2EvaluationCount;
      assert(
        firstRunPhase2Evaluations >= 1,
        `First run should evaluate combined candidate, got ${firstRunPhase2Evaluations}`,
      );

      // Reset counter
      phase2EvaluationCount = 0;

      // Second run - Phase 2 combined candidate should be skipped (cached failure)
      await runner.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options,
      });

      assertEquals(
        phase2EvaluationCount,
        0,
        "Second run should skip cached combined candidates",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "DiscoveryRunner does not cache successful candidates",
  // Uses Rust FFI via recordFailure -> getDiscoveryVersion
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const cacheDir = `${tempDir}/failure-cache`;

    try {
      const discoveryResult: DiscoverResult = {
        ID: "NO_CACHE_SUCCESS_TEST",
        addHelpfulSynapses: [{
          fromNeuronUuid: "input-1",
          toNeuronUuid: "hidden-1",
          weight: 0.45,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.5,
          improvedCount: 9,
          totalCount: 10,
        }],
        addHelpfulNeurons: undefined,
        removeHarmfulSynapse: undefined,
        removeHarmfulNeurons: undefined,
        removalCandidates: undefined,
        candidateSquashes: undefined,
      };

      // The candidate will improve things
      const computeError = (creature: Creature) => {
        const json = creature.exportJSON();
        normaliseCreatureExport(json);
        const hasTestSynapse = json.synapses.some((s) =>
          s.fromUUID === "input-1" && s.toUUID === "hidden-1" &&
          Math.abs(s.weight - 0.45) < 1e-6
        );
        return hasTestSynapse ? 0.3 : 0.5; // Synapse improves things
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
        options: makeOptions({ discoveryFailureCacheDir: cacheDir }),
      });

      // Verify we got an improvement
      assert(
        result.improvement,
        "Should have found an improvement",
      );

      // Verify cache directory either doesn't exist or has no add-synapses entries
      // (successful candidates should not be cached)
      try {
        const typeDir = `${cacheDir}/add-synapses`;
        const entries: Deno.DirEntry[] = [];
        for await (const entry of Deno.readDir(typeDir)) {
          entries.push(entry);
        }
        assertEquals(
          entries.length,
          0,
          "Successful candidates should not be cached",
        );
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        }
        // Directory doesn't exist, which is fine (no failures to cache)
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});
