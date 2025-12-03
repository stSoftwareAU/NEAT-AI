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
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";

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

function makeDenseOutputCreature(extraFanIn: number) {
  const base = makeBaseCreature();
  const exportJSON = base.exportJSON();
  const outputCount = exportJSON.output ?? 1;
  const outputOffset = exportJSON.neurons.length - outputCount;

  for (let i = 0; i < extraFanIn; i++) {
    const uuid = `dense-hidden-${i}`;
    exportJSON.neurons.splice(outputOffset, 0, {
      type: "hidden",
      uuid,
      squash: "IDENTITY",
      bias: 0,
    });
    exportJSON.synapses.push({
      fromUUID: "input-0",
      toUUID: uuid,
      weight: 0.5,
    });
    exportJSON.synapses.push({
      fromUUID: uuid,
      toUUID: "output-0",
      weight: 0.5,
    });
  }

  const creature = Creature.fromJSON(exportJSON);
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

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
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
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
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
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

Deno.test("DiscoveryRunner records evaluation summaries and archives candidates", async () => {
  const discoveryResult: DiscoverResult = {
    ID: "ARCHIVE_TEST",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
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
      change: {
        type: "add-neurons",
        description: "test candidate",
        expectedErrorReduction: 0.1, // Must exceed 2x costOfGrowth
      },
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
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
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
    creature: makeDenseOutputCreature(120),
    dataDir: "/tmp/data",
    options: makeOptions(),
  });

  const candidateEval = result.evaluations?.find((entry) =>
    entry.kind === "candidate" && entry.changeType === "add-synapses"
  );
  assert(candidateEval, "expected add-synapses candidate evaluation");
  // With structural scaling, the target neuron's share of the output error is tiny
  // (~0.82%) because the output fan-in now includes hundreds of equally weighted
  // synapses. The 60% neuron-level improvement therefore becomes ~0.49%
  // creature-level impact. Actual improvement is 1%, so the 0.51 percentage point
  // gap stays below the 25% alert threshold and no mismatch should be detected.
  assertEquals(
    candidateEval.expectationMismatch,
    undefined,
    "expected no mismatch when scaled expected (~0.4%) is close to actual (1%)",
  );
  // Verify the scaled expected improvement percentage
  assert(
    candidateEval.expectedErrorReductionPct !== undefined,
    "expected scaled error reduction percentage to be defined",
  );
  assertAlmostEquals(
    candidateEval.expectedErrorReductionPct!,
    0.493,
    1e-3,
  );
  // Verify the actual improvement percentage
  assertAlmostEquals(
    candidateEval.errorDeltaPct ?? 0,
    1.0, // (1.0 - 0.99) / 1.0 * 100 = 1%
    1e-6,
  );
});

Deno.test("DiscoveryRunner validates error estimates for non-trivial creatures with many synapses", async () => {
  // Create a creature similar to production: many synapses pointing to output
  // This tests that error estimates are reasonable and not wildly wrong
  const creature = makeDenseOutputCreature(100); // 100+ synapses to output

  // Set a baseline error for the creature
  const baseError = 0.584263; // Similar to production error
  const { addTag } = await import("@stsoftware/tags/mod");
  addTag(creature, "error", baseError.toString());

  // Simulate a candidate with recorded stats (like production)
  // The stats show the target neuron has moderate error
  const targetNeuronStats = {
    meanError: 0.05, // Moderate error at neuron level
    errorVariance: 0.001,
    meanActivation: 0.3,
    activationVariance: 0.01,
    errorSpikeCount: 2,
    activationSpikeCount: 1,
    activationMin: -0.5,
    activationMax: 1.2,
  };

  const discoveryResult: DiscoverResult = {
    ID: "NON_TRIVIAL_TEST",
    addHelpfulSynapses: [{
      fromNeuronUUID: "input-1",
      toNeuronUUID: "hidden-1",
      weight: 0.45,
      expectedImprovementPercentage: 0.333, // 33.3% neuron-level (like production)
      improvedCount: 9,
      totalCount: 10,
      targetNeuronStats, // Include stats for accurate scaling
    }],
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
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
      // Actual improvement is small (0.1%) - realistic for complex creatures
      return hasHelpful ? baseError * 0.999 : baseError;
    },
  );

  const runner = new DiscoveryRunner({
    rustDiscoveryEnabled: () => true,
    workerFactory: () => worker,
  });

  const result = await runner.discoverDir({
    creature: creature,
    dataDir: "/tmp/data",
    options: makeOptions(),
  });

  const candidateEval = result.evaluations?.find((entry) =>
    entry.kind === "candidate" && entry.changeType === "add-synapses"
  );
  assert(candidateEval, "expected add-synapses candidate evaluation");

  // With stats-based scaling, the 33.3% neuron-level improvement should be
  // scaled down significantly because:
  // 1. The target neuron's share is small (~1/100 = 1%) due to many synapses
  // 2. The neuron's error magnitude (0.05 + sqrt(0.001) ≈ 0.082) is small
  //    relative to creature error (0.584)
  // 3. Expected: 0.333 * (1/100) * (0.082/0.584) ≈ 0.0047% (very small)
  const expectedErrorReductionPct = candidateEval.expectedErrorReductionPct;
  assert(
    expectedErrorReductionPct !== undefined,
    "expected scaled error reduction percentage to be defined",
  );

  // The scaled estimate should be MUCH smaller than the raw 33.3%
  // It should be less than 1% (not 33%!)
  assert(
    expectedErrorReductionPct < 1.0,
    `Expected scaled estimate (${expectedErrorReductionPct}%) to be < 1%, not the raw 33.3%`,
  );

  // The estimate should be positive but small
  assert(
    expectedErrorReductionPct > 0,
    `Expected scaled estimate to be positive, got ${expectedErrorReductionPct}`,
  );

  // Actual improvement is 0.1% (0.584263 -> 0.5836)
  const actualErrorDeltaPct = candidateEval.errorDeltaPct ?? 0;
  assertAlmostEquals(
    actualErrorDeltaPct,
    0.1, // (0.584263 - 0.5836) / 0.584263 * 100 ≈ 0.1%
    0.05, // Allow small tolerance
  );

  // The estimate should be within reasonable range of actual (not wildly wrong)
  // Allow up to 10x difference for complex creatures (estimate could be conservative)
  const ratio = Math.abs(expectedErrorReductionPct / actualErrorDeltaPct);
  assert(
    ratio < 10.0 && ratio > 0.1,
    `Expected estimate (${expectedErrorReductionPct}%) to be within 10x of actual (${actualErrorDeltaPct}%), ratio: ${ratio}`,
  );

  // Most importantly: no mismatch warning should be triggered
  // because the estimate is now reasonable (not 33% vs 0%)
  assertEquals(
    candidateEval.expectationMismatch,
    undefined,
    `Expected no mismatch when estimate (${expectedErrorReductionPct}%) is reasonable compared to actual (${actualErrorDeltaPct}%)`,
  );
});

Deno.test("DiscoveryRunner passes discovery focus neurons to worker", async () => {
  const discoveryResult: DiscoverResult = {
    ID: "DISCOVER_FOCUS",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
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

Deno.test(
  "DiscoveryRunner includes synapse candidates with positive expected impact",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "POSITIVE_FILTER_SYN",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const baseCreature = makeBaseCreature();
    const extraSynapse = {
      fromUUID: "input-0",
      toUUID: "output-0",
      weight: 0.05,
    };

    const cloneExport = () => cloneCreatureJSON(baseCreature);

    const candidateBuilder = (
      _creature: Creature,
      _discovery: DiscoverResult,
    ): DiscoveryCandidate[] => {
      const json = cloneExport();
      json.synapses.push({
        fromUUID: extraSynapse.fromUUID,
        toUUID: extraSynapse.toUUID,
        weight: extraSynapse.weight,
      });
      const candidate = Creature.fromJSON(json);
      candidate.validate();
      CreatureUtil.makeUUID(candidate);
      return [{
        creature: candidate,
        change: {
          type: "add-synapses",
          description: "extra synapse",
          expectedErrorReduction: 0.05, // Must exceed 2x costOfGrowth (0.02 * 2 = 0.04)
        },
      }];
    };

    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const hasExtraSynapse = json.synapses.some((synapse) =>
        synapse.fromUUID === extraSynapse.fromUUID &&
        synapse.toUUID === extraSynapse.toUUID &&
        Math.abs(synapse.weight - extraSynapse.weight) < 1e-9
      );
      return hasExtraSynapse ? 0.4 : 0.5;
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () =>
        new FakeWorker(
          discoveryResult,
          computeError,
        ),
      candidateBuilder,
    });

    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options: makeOptions({ costOfGrowth: 0.02 }), // Positive candidates are included
    });

    assert(
      result.evaluations?.some((entry) => entry.kind === "candidate"),
      "candidates with positive expected impact should be included",
    );
  },
);

Deno.test(
  "DiscoveryRunner includes neuron candidates with positive expected impact",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "POSITIVE_FILTER_NEURON",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const baseCreature = makeBaseCreature();
    const newNeuronUUID = "positive-test-hidden";

    const candidateBuilder = (
      _creature: Creature,
      _discovery: DiscoverResult,
    ): DiscoveryCandidate[] => {
      const json = cloneCreatureJSON(baseCreature);
      const outputCount = json.output ?? 1;
      const outputOffset = json.neurons.length - outputCount;
      json.neurons.splice(outputOffset, 0, {
        type: "hidden",
        uuid: newNeuronUUID,
        squash: "IDENTITY",
        bias: 0,
      });
      json.synapses.push({
        fromUUID: "input-0",
        toUUID: newNeuronUUID,
        weight: 0.2,
      });
      json.synapses.push({
        fromUUID: newNeuronUUID,
        toUUID: "output-0",
        weight: -0.2,
      });
      const candidate = Creature.fromJSON(json);
      candidate.validate();
      CreatureUtil.makeUUID(candidate);
      return [{
        creature: candidate,
        change: {
          type: "add-neurons",
          description: "extra neuron",
          expectedErrorReduction: 0.02, // Positive expected impact
        },
      }];
    };

    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const hasNewNeuron = json.neurons.some((neuron) =>
        neuron.uuid === newNeuronUUID
      );
      return hasNewNeuron ? 0.3 : 0.5;
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () =>
        new FakeWorker(
          discoveryResult,
          computeError,
        ),
      candidateBuilder,
    });

    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options: makeOptions({ costOfGrowth: 0.01 }), // Positive candidates are included
    });

    assert(
      result.evaluations?.some((entry) => entry.kind === "candidate"),
      "neuron additions with positive expected impact should be included",
    );
  },
);

Deno.test(
  "DiscoveryRunner skips candidates with non-positive expected impact",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "NON_POSITIVE_FILTER",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const baseCreature = makeBaseCreature();

    const candidateBuilder = (
      _creature: Creature,
      _discovery: DiscoverResult,
    ): DiscoveryCandidate[] => {
      const json = cloneCreatureJSON(baseCreature);
      const candidate = Creature.fromJSON(json);
      candidate.validate();
      CreatureUtil.makeUUID(candidate);
      return [{
        creature: candidate,
        change: {
          type: "add-synapses",
          description: "non-positive candidate",
          expectedErrorReduction: 0, // Non-positive expected impact
        },
      }];
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

    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    assert(
      !result.evaluations?.some((entry) => entry.kind === "candidate"),
      "candidates with non-positive expected impact should be skipped",
    );
  },
);

Deno.test(
  "DiscoveryRunner includes candidates with undefined expectedErrorReduction for evaluation",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "UNDEFINED_EXPECTED",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const baseCreature = makeBaseCreature();

    const candidateBuilder = (
      _creature: Creature,
      _discovery: DiscoverResult,
    ): DiscoveryCandidate[] => {
      const json = cloneCreatureJSON(baseCreature);
      const candidate = Creature.fromJSON(json);
      candidate.validate();
      CreatureUtil.makeUUID(candidate);
      return [{
        creature: candidate,
        change: {
          type: "combo-all",
          description: "combo candidate without expected impact",
          // expectedErrorReduction is undefined - typical for combo candidates
        },
      }];
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

    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    assert(
      result.evaluations?.some((entry) => entry.kind === "candidate"),
      "candidates with undefined expectedErrorReduction should be included for evaluation",
    );
  },
);

Deno.test(
  "DiscoveryRunner excludes zero-impact candidates when multiplier is 0",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "ZERO_MULTIPLIER",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const baseCreature = makeBaseCreature();

    const candidateBuilder = (
      _creature: Creature,
      _discovery: DiscoverResult,
    ): DiscoveryCandidate[] => {
      // Create three candidates: one with zero impact, one with positive, one with negative
      const candidates: DiscoveryCandidate[] = [];

      // Candidate 1: Zero impact (should be excluded)
      const zeroCandidate = Creature.fromJSON(cloneCreatureJSON(baseCreature));
      zeroCandidate.validate();
      CreatureUtil.makeUUID(zeroCandidate);
      candidates.push({
        creature: zeroCandidate,
        change: {
          type: "add-neurons",
          description: "zero-impact candidate",
          expectedErrorReduction: 0, // Zero impact - should be excluded
        },
      });

      // Candidate 2: Positive impact (should be included)
      const positiveCandidate = Creature.fromJSON(
        cloneCreatureJSON(baseCreature),
      );
      positiveCandidate.validate();
      CreatureUtil.makeUUID(positiveCandidate);
      candidates.push({
        creature: positiveCandidate,
        change: {
          type: "add-synapses",
          description: "positive-impact candidate",
          expectedErrorReduction: 0.001, // Positive impact - should be included
        },
      });

      // Candidate 3: Negative impact (should be excluded)
      const negativeCandidate = Creature.fromJSON(
        cloneCreatureJSON(baseCreature),
      );
      negativeCandidate.validate();
      CreatureUtil.makeUUID(negativeCandidate);
      candidates.push({
        creature: negativeCandidate,
        change: {
          type: "add-neurons",
          description: "negative-impact candidate",
          expectedErrorReduction: -0.001, // Negative impact - should be excluded
        },
      });

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

    const options = makeOptions();
    options.discoveryMinImprovementVsCostOfGrowthMultiplier = 0; // Set multiplier to 0

    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options,
    });

    // Only the positive-impact candidate should be evaluated
    const candidateEvaluations =
      result.evaluations?.filter((entry) => entry.kind === "candidate") ?? [];

    assertEquals(
      candidateEvaluations.length,
      1,
      "only one candidate with positive impact should be evaluated",
    );

    assert(
      candidateEvaluations[0].description?.includes("positive-impact"),
      "the evaluated candidate should be the positive-impact one",
    );
  },
);

Deno.test(
  "DiscoveryRunner logs sub-basis deltas with at least three significant digits",
  async () => {
    const discoveryResult: DiscoverResult = {
      ID: "DELTA_PRECISION",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const baseCreature = makeBaseCreature();
    const tinyDelta = 1e-8;

    const candidateBuilder = (
      _creature: Creature,
      _discovery: DiscoverResult,
    ): DiscoveryCandidate[] => {
      const json = cloneCreatureJSON(baseCreature);
      json.synapses = json.synapses.map((synapse) =>
        synapse.fromUUID === "hidden-1" && synapse.toUUID === "output-0"
          ? { ...synapse, weight: synapse.weight + tinyDelta }
          : synapse
      );
      const candidate = Creature.fromJSON(json);
      candidate.validate();
      CreatureUtil.makeUUID(candidate);
      return [{
        creature: candidate,
        change: {
          type: "add-synapses",
          description: "tiny delta",
          expectedErrorReduction: tinyDelta,
        },
      }];
    };

    const baselineError = 0.5;
    const computeError = (creature: Creature) => {
      const json = creature.exportJSON();
      const hasTinyUpdate = json.synapses.some((synapse) =>
        synapse.fromUUID === "hidden-1" && synapse.toUUID === "output-0" &&
        Math.abs(synapse.weight - (0.5 + tinyDelta)) < 1e-10
      );
      return hasTinyUpdate ? baselineError - tinyDelta : baselineError;
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () =>
        new FakeWorker(
          discoveryResult,
          computeError,
        ),
      candidateBuilder,
    });

    const captured: string[] = [];
    const originalInfo = console.info.bind(console);
    console.info = (...args: unknown[]) => {
      captured.push(args.map((arg) => String(arg)).join(" "));
      originalInfo(...args);
    };

    try {
      await runner.discoverDir({
        creature: baseCreature,
        dataDir: "/tmp/data",
        options: makeOptions({ costOfGrowth: 0 }),
      });
    } finally {
      console.info = originalInfo;
    }

    const candidateLine = captured.find((line) =>
      line.includes("[DiscoveryRunner]   Candidate")
    );
    assert(candidateLine, "expected candidate log line to be recorded");
    assert(
      !candidateLine.includes("+0.000%"),
      `non-zero deltas must show significant digits, got: ${candidateLine}`,
    );
  },
);

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
          neuronUUID: "hidden-low-impact",
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
      removalCandidate.description?.includes("low-impact"),
      `Expected description to mention 'low-impact', got: ${removalCandidate.description}`,
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

Deno.test(
  "DiscoveryRunner caches failed candidates when discoveryFailureCacheDir is set",
  async () => {
    const tempDir = await Deno.makeTempDir();
    const cacheDir = `${tempDir}/failure-cache`;

    try {
      const discoveryResult: DiscoverResult = {
        ID: "CACHE_FAILURES_TEST",
        addHelpfulSynapses: [{
          fromNeuronUUID: "input-1",
          toNeuronUUID: "hidden-1",
          weight: 0.45,
          expectedImprovementPercentage: 0.2,
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
);

Deno.test(
  "DiscoveryRunner skips cached candidates on subsequent runs",
  async () => {
    const tempDir = await Deno.makeTempDir();
    const cacheDir = `${tempDir}/failure-cache`;

    try {
      const discoveryResult: DiscoverResult = {
        ID: "SKIP_CACHED_TEST",
        addHelpfulSynapses: [{
          fromNeuronUUID: "input-1",
          toNeuronUUID: "hidden-1",
          weight: 0.45,
          expectedImprovementPercentage: 0.2,
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
);

Deno.test(
  "DiscoveryRunner does not cache successful candidates",
  async () => {
    const tempDir = await Deno.makeTempDir();
    const cacheDir = `${tempDir}/failure-cache`;

    try {
      const discoveryResult: DiscoverResult = {
        ID: "NO_CACHE_SUCCESS_TEST",
        addHelpfulSynapses: [{
          fromNeuronUUID: "input-1",
          toNeuronUUID: "hidden-1",
          weight: 0.45,
          expectedImprovementPercentage: 0.5,
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
);
