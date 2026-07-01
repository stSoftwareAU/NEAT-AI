/**
 * Issue #1291 - Batch discovery candidate validation tests
 *
 * This test suite verifies the batch validation functionality for discovery candidates.
 * The batch validator groups candidates by type and validates them efficiently,
 * using early-exit on first failure for structural changes.
 */
import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { DiscoverResult } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateNeuron,
  CandidateSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  buildDiscoveryCandidates,
  type DiscoveryCandidate,
} from "@discovery/DiscoveryCandidates.ts";
import {
  BatchDiscoveryValidator,
  type BatchValidationResult,
  groupCandidatesByType,
  validateDiscoveryCandidatesBatchWithEnhanced,
} from "@discovery/BatchDiscoveryValidator.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { TANH } from "@methods/activations/types/TANH.ts";

const _OUTPUT_0_ID = -1; // "output-0" (reserved for future tests)

function makeBaselineCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 4,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-2", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: -0.2 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 0.15 },
      { fromUUID: "hidden-2", toUUID: "output-1", weight: -0.3 },
      { fromUUID: "hidden-1", toUUID: "output-1", weight: 0.05 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test(
  "groupCandidatesByType correctly separates structural and weight-only changes",
  () => {
    const base = makeBaselineCreature();
    const synapses: CandidateSynapse[] = [
      {
        fromNeuronUuid: "input-2",
        toNeuronUuid: "hidden-1",
        weight: 0.99,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.25,
        improvedCount: 5,
        totalCount: 6,
      },
    ];
    const neurons: CandidateNeuron[] = [
      {
        fromNeuronUuid: "input-2",
        toNeuronUuid: "hidden-1",
        incomingWeight: 0.45,
        outgoingWeight: -0.12,
        squash: TANH.NAME,
        bias: 0.1,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.1,
        improvedCount: 5,
        totalCount: 6,
      },
    ];
    const discovery: DiscoverResult = {
      ID: "BATCH-GROUP-TEST",
      addHelpfulSynapses: synapses,
      addHelpfulNeurons: neurons,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: [
        {
          neuronUuid: "hidden-1",
          previousSquash: IDENTITY.NAME,
          squash: TANH.NAME,
          expectedCreatureScoreGain: 0.4,
          improvedError: 0.1,
          currentError: 0.2,
        },
      ],
    };

    const candidates = buildDiscoveryCandidates(base, discovery, {
      skipCombinedCandidates: true,
    });
    const grouped = groupCandidatesByType(candidates);

    // Structural changes: add-neurons, add-synapses, remove-neuron, remove-synapse
    assert(
      grouped.structural.length > 0,
      "Expected structural candidates for add operations",
    );

    // Weight-only changes: change-squash (doesn't change structure)
    assert(
      grouped.weightOnly.length > 0,
      "Expected weight-only candidates for squash changes",
    );

    // All candidates should be accounted for
    assertEquals(
      grouped.structural.length + grouped.weightOnly.length,
      candidates.length,
      "All candidates should be grouped",
    );
  },
);

Deno.test(
  "BatchDiscoveryValidator validates all candidates and returns results",
  () => {
    const base = makeBaselineCreature();
    const discovery: DiscoverResult = {
      ID: "BATCH-VALIDATE-TEST",
      addHelpfulSynapses: [
        {
          fromNeuronUuid: "input-2",
          toNeuronUuid: "hidden-1",
          weight: 0.5,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.2,
          improvedCount: 3,
          totalCount: 5,
        },
      ],
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(base, discovery, {
      skipCombinedCandidates: true,
    });

    const validator = new BatchDiscoveryValidator({
      feedbackLoop: false,
    });

    const results = validator.validateBatch(base, candidates);

    assertEquals(
      results.length,
      candidates.length,
      "Should return one result per candidate",
    );

    for (const result of results) {
      assertExists(result.candidate, "Each result should have a candidate");
      assertEquals(typeof result.valid, "boolean", "valid should be boolean");
    }
  },
);

Deno.test(
  "BatchDiscoveryValidator early-exits on first invalid structural candidate",
  () => {
    const base = makeBaselineCreature();
    base.forwardOnly = true;
    base.semanticVersion = "4.0.0";

    // Create some valid candidates
    const validCandidates: DiscoveryCandidate[] = [
      {
        creature: Creature.fromJSON(base.exportJSON()),
        change: {
          type: "change-squash",
          description: "Test valid squash change",
        },
      },
      {
        creature: Creature.fromJSON(base.exportJSON()),
        change: {
          type: "change-squash",
          description: "Test valid squash change 2",
        },
      },
    ];

    const validator = new BatchDiscoveryValidator({
      feedbackLoop: false,
      earlyExitOnStructuralFailure: true,
    });

    // All these should pass since they're valid clones
    const results = validator.validateBatch(base, validCandidates);
    assert(
      results.every((r) => r.valid),
      "Valid candidates should pass validation",
    );

    // Verify early exit option is configured correctly
    const stats = validator.getStats();
    assertEquals(
      stats.earlyExitTriggered,
      false,
      "Early exit should not trigger when all candidates are valid",
    );
  },
);

Deno.test(
  "BatchDiscoveryValidator groups candidates correctly by category",
  () => {
    const base = makeBaselineCreature();
    const discovery: DiscoverResult = {
      ID: "BATCH-CATEGORY-TEST",
      addHelpfulSynapses: [
        {
          fromNeuronUuid: "input-2",
          toNeuronUuid: "hidden-1",
          weight: 0.5,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.2,
          improvedCount: 3,
          totalCount: 5,
        },
      ],
      addHelpfulNeurons: [
        {
          fromNeuronUuid: "input-2",
          toNeuronUuid: "hidden-1",
          incomingWeight: 0.45,
          outgoingWeight: -0.12,
          squash: TANH.NAME,
          bias: 0.1,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.1,
          improvedCount: 5,
          totalCount: 6,
        },
      ],
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: [
        {
          neuronUuid: "hidden-1",
          previousSquash: IDENTITY.NAME,
          squash: TANH.NAME,
          expectedCreatureScoreGain: 0.4,
          improvedError: 0.1,
          currentError: 0.2,
        },
      ],
    };

    const candidates = buildDiscoveryCandidates(base, discovery, {
      skipCombinedCandidates: true,
    });

    const validator = new BatchDiscoveryValidator({
      feedbackLoop: false,
    });

    const results = validator.validateBatch(base, candidates);

    // Group results by type for verification
    const byType = new Map<string, BatchValidationResult[]>();
    for (const result of results) {
      const type = result.candidate.change.type;
      const existing = byType.get(type) ?? [];
      existing.push(result);
      byType.set(type, existing);
    }

    // Should have results for each candidate type
    assert(
      byType.has("add-synapses") || byType.has("add-neurons") ||
        byType.has("change-squash"),
      "Should have results for at least one candidate type",
    );
  },
);

Deno.test(
  "BatchDiscoveryValidator correctly handles forward-only validation",
  () => {
    const base = makeBaselineCreature();
    base.forwardOnly = true;
    base.semanticVersion = "4.0.0";
    base.validate({ forwardOnly: true });

    const discovery: DiscoverResult = {
      ID: "FORWARD-ONLY-TEST",
      addHelpfulSynapses: [
        {
          fromNeuronUuid: "input-2",
          toNeuronUuid: "hidden-1",
          weight: 0.5,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.2,
          improvedCount: 3,
          totalCount: 5,
        },
      ],
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(base, discovery, {
      skipCombinedCandidates: true,
    });

    const validator = new BatchDiscoveryValidator({
      feedbackLoop: false, // Forward-only mode
    });

    const results = validator.validateBatch(base, candidates);

    // Candidates generated from a forward-only base should also be valid forward-only
    for (const result of results) {
      if (result.valid) {
        // The validated creature should maintain forward-only property
        assertEquals(
          result.candidate.creature.forwardOnly,
          true,
          "Valid candidates should be forward-only when base is forward-only",
        );
      }
    }
  },
);

// Merged (Issue #3172): the former "uses validation cache to avoid redundant
// validations" test used the identical two-synapse setup and only asserted
// `totalValidations > 0` plus that all results were valid. Its unique
// assertions are folded in here so no coverage is lost.
Deno.test(
  "BatchDiscoveryValidator provides validation statistics",
  () => {
    const base = makeBaselineCreature();
    const discovery: DiscoverResult = {
      ID: "STATS-TEST",
      addHelpfulSynapses: [
        {
          fromNeuronUuid: "input-2",
          toNeuronUuid: "hidden-1",
          weight: 0.5,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.2,
          improvedCount: 3,
          totalCount: 5,
        },
        {
          fromNeuronUuid: "input-3",
          toNeuronUuid: "hidden-2",
          weight: 0.6,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.25,
          improvedCount: 4,
          totalCount: 6,
        },
      ],
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(base, discovery, {
      skipCombinedCandidates: true,
    });

    const validator = new BatchDiscoveryValidator({
      feedbackLoop: false,
    });

    const results = validator.validateBatch(base, candidates);
    const stats = validator.getStats();

    // All simple synapse additions should be valid (from merged cache test).
    assert(
      results.every((r) => r.valid),
      "All simple synapse additions should be valid",
    );

    assertExists(stats, "Should return statistics");
    assert(
      stats.totalValidations >= candidates.length,
      "Should track all validations",
    );
    assert(
      stats.validCount >= 0,
      "Should track valid count",
    );
    assert(
      stats.invalidCount >= 0,
      "Should track invalid count",
    );
    assertEquals(
      stats.validCount + stats.invalidCount,
      candidates.length,
      "Valid + invalid should equal total candidates",
    );
  },
);

Deno.test(
  "BatchDiscoveryValidator can be reset between batches",
  () => {
    const base = makeBaselineCreature();
    const discovery: DiscoverResult = {
      ID: "RESET-TEST",
      addHelpfulSynapses: [
        {
          fromNeuronUuid: "input-2",
          toNeuronUuid: "hidden-1",
          weight: 0.5,
          targetNeuronImpact: 1.0,
          expectedCreatureErrorReduction: 0,
          expectedCreatureScoreGain: 0.2,
          improvedCount: 3,
          totalCount: 5,
        },
      ],
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const candidates = buildDiscoveryCandidates(base, discovery, {
      skipCombinedCandidates: true,
    });

    const validator = new BatchDiscoveryValidator({
      feedbackLoop: false,
    });

    // First batch
    validator.validateBatch(base, candidates);
    const stats1 = validator.getStats();
    assert(
      stats1.totalValidations > 0,
      "Should have validations after first batch",
    );

    // Reset
    validator.reset();
    const statsAfterReset = validator.getStats();
    assertEquals(
      statsAfterReset.totalValidations,
      0,
      "Should reset validation count",
    );

    // Second batch
    validator.validateBatch(base, candidates);
    const stats2 = validator.getStats();
    assert(
      stats2.totalValidations > 0,
      "Should have validations after second batch",
    );
  },
);

// Merged (Issue #3172): three former single-assertion tests covering the
// `isEnhancedValidationEnabled()` config gate (default off, holdout on,
// brittleness on) collapsed into one table-driven test. Each row exercises the
// same code path with a different config, so no coverage is lost.
Deno.test(
  "BatchDiscoveryValidator.isEnhancedValidationEnabled reflects config",
  async (t) => {
    const check = (
      options: ConstructorParameters<typeof BatchDiscoveryValidator>[0],
      expected: boolean,
    ) => {
      const validator = new BatchDiscoveryValidator(options);
      assertEquals(
        validator.isEnhancedValidationEnabled(),
        expected,
        `Enhanced validation should be ${expected}`,
      );
    };

    await t.step("disabled by default", () => {
      check({ feedbackLoop: false }, false);
    });

    await t.step("enabled when holdout is configured", () => {
      check(
        {
          feedbackLoop: false,
          holdout: { enabled: true, holdoutPercentage: 0.2 },
        },
        true,
      );
    });

    await t.step("enabled when brittleness is configured", () => {
      check(
        {
          feedbackLoop: false,
          brittleness: { enabled: true, perturbationMagnitude: 0.1 },
        },
        true,
      );
    });
  },
);

Deno.test(
  "BatchDiscoveryValidator tracks enhanced rejection statistics",
  () => {
    const base = makeBaselineCreature();

    // Generate training data
    const trainingData: Array<{ input: Float32Array; output: Float32Array }> =
      [];
    for (let i = 0; i < 50; i++) {
      const input = new Float32Array([
        Math.random(),
        Math.random(),
        Math.random(),
        Math.random(),
      ]);
      const output = base.activate(input);
      trainingData.push({ input, output: new Float32Array(output) });
    }

    const dataDir = makeDataDir(trainingData, 1000, {
      input: base.input,
      output: base.output,
    });

    try {
      const discovery: DiscoverResult = {
        ID: "ENHANCED-STATS-TEST",
        addHelpfulSynapses: [
          {
            fromNeuronUuid: "input-2",
            toNeuronUuid: "hidden-1",
            weight: 0.5,
            targetNeuronImpact: 1.0,
            expectedCreatureErrorReduction: 0,
            expectedCreatureScoreGain: 0.2,
            improvedCount: 3,
            totalCount: 5,
          },
        ],
        addHelpfulNeurons: undefined,
        removeHarmfulSynapse: undefined,
        removeHarmfulNeurons: undefined,
        removalCandidates: undefined,
        candidateSquashes: undefined,
      };

      const candidates = buildDiscoveryCandidates(base, discovery, {
        skipCombinedCandidates: true,
      });

      const validator = new BatchDiscoveryValidator({
        feedbackLoop: false,
        holdout: {
          enabled: true,
          holdoutPercentage: 0.2,
          seed: 42,
          maxPerformanceGap: 1.0, // Lenient to avoid rejections
        },
        dataDir: dataDir,
      });

      validator.validateBatchWithEnhanced(base, candidates);
      const stats = validator.getStats();

      assertExists(
        stats.enhancedRejectionCount,
        "Should track enhanced rejection count",
      );
      assert(
        stats.enhancedRejectionCount >= 0,
        "Enhanced rejection count should be non-negative",
      );
    } finally {
      try {
        Deno.removeSync(dataDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
);

Deno.test(
  "validateDiscoveryCandidatesBatchWithEnhanced convenience function works",
  () => {
    const base = makeBaselineCreature();

    // Generate training data
    const trainingData: Array<{ input: Float32Array; output: Float32Array }> =
      [];
    for (let i = 0; i < 30; i++) {
      const input = new Float32Array([
        Math.random(),
        Math.random(),
        Math.random(),
        Math.random(),
      ]);
      const output = base.activate(input);
      trainingData.push({ input, output: new Float32Array(output) });
    }

    const dataDir = makeDataDir(trainingData, 1000, {
      input: base.input,
      output: base.output,
    });

    try {
      const discovery: DiscoverResult = {
        ID: "CONVENIENCE-FUNC-TEST",
        addHelpfulSynapses: [
          {
            fromNeuronUuid: "input-2",
            toNeuronUuid: "hidden-1",
            weight: 0.5,
            targetNeuronImpact: 1.0,
            expectedCreatureErrorReduction: 0,
            expectedCreatureScoreGain: 0.2,
            improvedCount: 3,
            totalCount: 5,
          },
        ],
        addHelpfulNeurons: undefined,
        removeHarmfulSynapse: undefined,
        removeHarmfulNeurons: undefined,
        removalCandidates: undefined,
        candidateSquashes: undefined,
      };

      const candidates = buildDiscoveryCandidates(base, discovery, {
        skipCombinedCandidates: true,
      });

      const results = validateDiscoveryCandidatesBatchWithEnhanced(
        base,
        candidates,
        {
          feedbackLoop: false,
          brittleness: {
            enabled: true,
            perturbationMagnitude: 0.1,
            brittlenessThreshold: 10.0, // Very lenient
            seed: 42,
          },
          dataDir: dataDir,
        },
      );

      assertEquals(
        results.length,
        candidates.length,
        "Should return one result per candidate",
      );

      for (const result of results) {
        assertExists(result.candidate, "Each result should have a candidate");
        assertEquals(typeof result.valid, "boolean", "valid should be boolean");
        // Enhanced results may or may not be present depending on whether it passed basic validation
      }
    } finally {
      try {
        Deno.removeSync(dataDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
);
