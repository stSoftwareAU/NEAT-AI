/**
 * Integration test for the failure-cache drought bypass (Issue #3072).
 *
 * Mirrors `DiscoveryRunnerFailureCache.ts` "skips cached candidates on
 * subsequent runs", but with a drought escalation signalled on the second run.
 * When `noveltyEscalationActive` is set, the previously-cached candidate must be
 * re-admitted and re-evaluated rather than skipped — proving a plateaued
 * creature with a full failure cache is no longer starved of all candidates.
 */

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
    return Promise.resolve({
      taskID: 2,
      duration: 5,
      evaluate: { error: this.#computeError(creature) },
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
    threads: 1,
    costOfGrowth: DEFAULT_COST_OF_GROWTH,
    costName: "MSE",
    ...overrides,
  };
}

function makeDiscoverResult(
  overrides: Partial<DiscoverResult> = {},
): DiscoverResult {
  return {
    ID: "DROUGHT_BYPASS_TEST",
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
    ...overrides,
  };
}

Deno.test({
  name:
    "DiscoveryRunner re-evaluates cached candidates during drought escalation",
  // Uses Rust FFI via recordFailure -> getDiscoveryVersion
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const cacheDir = `${tempDir}/failure-cache`;

    try {
      let evaluationCount = 0;
      const computeError = (creature: Creature) => {
        const json = creature.exportJSON();
        normaliseCreatureExport(json);
        const hasTestSynapse = json.synapses.some((s) =>
          s.fromUUID === "input-1" && s.toUUID === "hidden-1" &&
          Math.abs(s.weight - 0.45) < 1e-6
        );
        if (hasTestSynapse) evaluationCount++;
        return 0.6; // All worse → candidate is cached as a failure.
      };

      const options = makeOptions({ discoveryFailureCacheDir: cacheDir });

      // First run (no drought): populates the failure cache.
      const runner1 = new DiscoveryRunner({
        rustDiscoveryEnabled: () => true,
        workerFactory: () => new FakeWorker(makeDiscoverResult(), computeError),
      });
      await runner1.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options,
      });
      assert(evaluationCount >= 1, "First run should evaluate the candidate");

      // Second run WITHOUT drought: the cached candidate is skipped.
      evaluationCount = 0;
      const runner2 = new DiscoveryRunner({
        rustDiscoveryEnabled: () => true,
        workerFactory: () => new FakeWorker(makeDiscoverResult(), computeError),
      });
      await runner2.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options,
      });
      assertEquals(
        evaluationCount,
        0,
        "Without drought, cached candidate should be skipped",
      );

      // Third run WITH drought escalation: the cached candidate is re-admitted.
      evaluationCount = 0;
      const runner3 = new DiscoveryRunner({
        rustDiscoveryEnabled: () => true,
        workerFactory: () =>
          new FakeWorker(
            makeDiscoverResult({ noveltyEscalationActive: true }),
            computeError,
          ),
      });
      await runner3.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options,
      });
      assert(
        evaluationCount >= 1,
        `Drought escalation should re-evaluate the cached candidate, got ${evaluationCount}`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "DiscoveryRunner keeps failure-cache filter during drought when bypass disabled",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const cacheDir = `${tempDir}/failure-cache`;

    try {
      let evaluationCount = 0;
      const computeError = (creature: Creature) => {
        const json = creature.exportJSON();
        normaliseCreatureExport(json);
        const hasTestSynapse = json.synapses.some((s) =>
          s.fromUUID === "input-1" && s.toUUID === "hidden-1" &&
          Math.abs(s.weight - 0.45) < 1e-6
        );
        if (hasTestSynapse) evaluationCount++;
        return 0.6;
      };

      const options = makeOptions({
        discoveryFailureCacheDir: cacheDir,
        discoveryFailureCacheBypassOnDrought: false,
      });

      // First run: populate the cache.
      const runner1 = new DiscoveryRunner({
        rustDiscoveryEnabled: () => true,
        workerFactory: () => new FakeWorker(makeDiscoverResult(), computeError),
      });
      await runner1.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options,
      });
      assert(evaluationCount >= 1, "First run should evaluate the candidate");

      // Second run WITH drought but bypass disabled: still skipped.
      evaluationCount = 0;
      const runner2 = new DiscoveryRunner({
        rustDiscoveryEnabled: () => true,
        workerFactory: () =>
          new FakeWorker(
            makeDiscoverResult({ creatureDroughtAlarm: true }),
            computeError,
          ),
      });
      await runner2.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options,
      });
      assertEquals(
        evaluationCount,
        0,
        "Bypass disabled → cached candidate stays skipped even during drought",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});
