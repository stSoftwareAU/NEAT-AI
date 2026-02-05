/**
 * Tests for ensemble diversity scoring for species.
 *
 * Issue #1310: Reduce brittleness: Ensemble diversity scoring for species.
 *
 * TDD: These tests define the expected behaviour for measuring and encouraging
 * species diversity to reduce reliance on brittle high-performers.
 */

import {
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
  assertNotEquals,
} from "@std/assert";
import { Creature, CreatureUtil } from "../../mod.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import {
  DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
  type EnsembleDiversityConfig,
  EnsembleDiversityScoring,
} from "../../src/breed/EnsembleDiversityScoring.ts";

/**
 * Helper to create a creature from internal format with UUID.
 */
function makeCreature(internal: CreatureInternal): Creature {
  const creature = Creature.fromJSON(internal);
  CreatureUtil.makeUUID(creature);
  return creature;
}

/**
 * Helper to create a simple creature with specified weights and squash.
 */
function createTestCreature(
  weights: number[],
  squash: string = "LOGISTIC",
  extraNeurons: number = 0,
): Creature {
  const neurons: CreatureInternal["neurons"] = [
    {
      index: 1,
      type: "hidden",
      squash,
      bias: weights[0] ?? 0,
    },
    {
      index: 2,
      type: "output",
      squash: "IDENTITY",
      bias: 0,
    },
  ];

  // Add extra hidden neurons for topology diversity tests
  for (let i = 0; i < extraNeurons; i++) {
    neurons.splice(1, 0, {
      index: 2 + i,
      type: "hidden",
      squash: squash,
      bias: weights[4 + i] ?? 0.1 * i,
    });
  }

  // Reindex neurons after insertion
  for (let i = 0; i < neurons.length; i++) {
    neurons[i].index = i + 1;
  }

  const synapses: CreatureInternal["synapses"] = [
    { from: 0, to: 1, weight: weights[1] ?? 0.5 },
    { from: 1, to: neurons.length, weight: weights[3] ?? 1.0 },
  ];

  // Add more connections for larger networks
  if (extraNeurons > 0) {
    synapses.push({ from: 0, to: 2, weight: weights[2] ?? 0.5 });
    for (let i = 0; i < extraNeurons; i++) {
      synapses.push({
        from: 2 + i,
        to: neurons.length,
        weight: 0.5 + i * 0.1,
      });
    }
  }

  return makeCreature({
    input: 1,
    output: 1,
    neurons,
    synapses,
  });
}

/**
 * Helper to create creatures with varying architectures.
 */
function createDiverseCreatures(): Creature[] {
  return [
    createTestCreature([0.1, 0.2, 0.3, 0.4], "LOGISTIC"),
    createTestCreature([0.5, 0.6, 0.7, 0.8], "TANH"),
    createTestCreature([-0.1, -0.2, -0.3, -0.4], "RELU"),
    createTestCreature([0.9, 0.1, 0.9, 0.1], "LOGISTIC"),
  ];
}

/**
 * Helper to create homogeneous creatures (similar architectures).
 */
function createHomogeneousCreatures(): Creature[] {
  return [
    createTestCreature([0.1, 0.2, 0.3, 0.4], "LOGISTIC"),
    createTestCreature([0.11, 0.21, 0.31, 0.41], "LOGISTIC"),
    createTestCreature([0.12, 0.22, 0.32, 0.42], "LOGISTIC"),
    createTestCreature([0.09, 0.19, 0.29, 0.39], "LOGISTIC"),
  ];
}

// =============================================================================
// Core Diversity Metrics Tests
// =============================================================================

Deno.test("EnsembleDiversityScoring - calculates weight variance for species", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
  };

  const scoring = new EnsembleDiversityScoring(config);

  const diverseCreatures = createDiverseCreatures();
  const homogeneousCreatures = createHomogeneousCreatures();

  const diverseVariance = scoring.calculateWeightVariance(diverseCreatures);
  const homogeneousVariance = scoring.calculateWeightVariance(
    homogeneousCreatures,
  );

  // Diverse creatures should have higher weight variance
  assertGreater(diverseVariance, homogeneousVariance);
  // Both should be non-negative
  assertGreater(diverseVariance, 0);
  assertGreater(homogeneousVariance, 0);
});

Deno.test("EnsembleDiversityScoring - calculates squash function entropy", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
  };

  const scoring = new EnsembleDiversityScoring(config);

  const diverseCreatures = createDiverseCreatures();
  const homogeneousCreatures = createHomogeneousCreatures();

  const diverseEntropy = scoring.calculateSquashEntropy(diverseCreatures);
  const homogeneousEntropy = scoring.calculateSquashEntropy(
    homogeneousCreatures,
  );

  // Diverse creatures (3 different squashes) should have higher entropy
  assertGreater(diverseEntropy, homogeneousEntropy);
  // Homogeneous creatures (all LOGISTIC + IDENTITY) should have low entropy
  assertLess(homogeneousEntropy, diverseEntropy);
});

Deno.test("EnsembleDiversityScoring - calculates topology diversity", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
  };

  const scoring = new EnsembleDiversityScoring(config);

  // Create creatures with different topologies
  const creature1 = createTestCreature([0.1, 0.2, 0.3, 0.4], "LOGISTIC", 0);
  const creature2 = createTestCreature([0.1, 0.2, 0.3, 0.4], "LOGISTIC", 2);

  const diverseTopology = [creature1, creature2];
  const sameTopology = [
    creature1,
    createTestCreature([0.15, 0.25, 0.35, 0.45], "LOGISTIC", 0),
  ];

  const diverseScore = scoring.calculateTopologyDiversity(diverseTopology);
  const sameScore = scoring.calculateTopologyDiversity(sameTopology);

  // Different topologies should score higher
  assertGreater(diverseScore, sameScore);
});

Deno.test("EnsembleDiversityScoring - calculates overall diversity score", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
    weightVarianceWeight: 0.4,
    squashEntropyWeight: 0.3,
    topologyDiversityWeight: 0.3,
  };

  const scoring = new EnsembleDiversityScoring(config);

  const diverseCreatures = createDiverseCreatures();
  const homogeneousCreatures = createHomogeneousCreatures();

  const diverseScore = scoring.calculateDiversityScore(diverseCreatures);
  const homogeneousScore = scoring.calculateDiversityScore(
    homogeneousCreatures,
  );

  // Diverse creatures should have higher overall diversity score
  assertGreater(diverseScore, homogeneousScore);
  // Scores should be in [0, 1] range
  assertGreater(diverseScore, 0);
  assertLess(diverseScore, 1.01); // Allow small floating point tolerance
  assertGreater(homogeneousScore, -0.01);
  assertLess(homogeneousScore, 1.01);
});

// =============================================================================
// Fitness Adjustment Tests
// =============================================================================

Deno.test("EnsembleDiversityScoring - adjusts fitness based on diversity", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
    diversityWeight: 0.2, // 20% weight to diversity
  };

  const scoring = new EnsembleDiversityScoring(config);

  const baseFitness = 0.8;
  const highDiversity = 0.9;
  const lowDiversity = 0.1;

  const highDiversityFitness = scoring.getAdjustedFitness(
    baseFitness,
    highDiversity,
  );
  const lowDiversityFitness = scoring.getAdjustedFitness(
    baseFitness,
    lowDiversity,
  );

  // Higher diversity should result in higher adjusted fitness
  assertGreater(highDiversityFitness, lowDiversityFitness);
  // Both should still be based on the base fitness
  assertGreater(highDiversityFitness, 0);
  assertGreater(lowDiversityFitness, 0);
});

Deno.test("EnsembleDiversityScoring - disabled returns base fitness", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: false,
    diversityWeight: 0.3,
  };

  const scoring = new EnsembleDiversityScoring(config);

  const baseFitness = 0.8;
  const diversity = 0.9;

  const adjustedFitness = scoring.getAdjustedFitness(baseFitness, diversity);

  // When disabled, should return base fitness unchanged
  assertAlmostEquals(adjustedFitness, baseFitness, 0.0001);
});

// =============================================================================
// Culling Protection Tests
// =============================================================================

Deno.test("EnsembleDiversityScoring - protects diverse low-performers from culling", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
    protectDiverseLowPerformers: true,
    diversityProtectionThreshold: 0.7, // Protect if diversity > 0.7
  };

  const scoring = new EnsembleDiversityScoring(config);

  const highDiversity = 0.9;
  const lowDiversity = 0.3;

  // High diversity creatures should be protected
  assertEquals(scoring.shouldProtectFromCulling(highDiversity), true);
  // Low diversity creatures should not be protected
  assertEquals(scoring.shouldProtectFromCulling(lowDiversity), false);
});

Deno.test("EnsembleDiversityScoring - protection disabled returns false", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
    protectDiverseLowPerformers: false,
  };

  const scoring = new EnsembleDiversityScoring(config);

  // Even high diversity should not be protected when protection is disabled
  assertEquals(scoring.shouldProtectFromCulling(0.99), false);
});

// =============================================================================
// Cross-Species Breeding Tests
// =============================================================================

Deno.test("EnsembleDiversityScoring - recommends cross-species breeding when diversity is low", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
    crossSpeciesBreedingThreshold: 0.3, // Trigger cross-species if diversity < 0.3
  };

  const scoring = new EnsembleDiversityScoring(config);

  // Low diversity should recommend cross-species breeding
  assertEquals(scoring.shouldTriggerCrossSpeciesBreeding(0.2), true);
  // High diversity should not recommend cross-species breeding
  assertEquals(scoring.shouldTriggerCrossSpeciesBreeding(0.5), false);
});

// =============================================================================
// Species-Level Diversity Metrics Tests
// =============================================================================

Deno.test("EnsembleDiversityScoring - calculates species diversity metrics", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
  };

  const scoring = new EnsembleDiversityScoring(config);

  const creatures = createDiverseCreatures();

  const metrics = scoring.getSpeciesDiversityMetrics(creatures);

  // Metrics should be populated
  assertNotEquals(metrics.weightVariance, undefined);
  assertNotEquals(metrics.squashEntropy, undefined);
  assertNotEquals(metrics.topologyDiversity, undefined);
  assertNotEquals(metrics.overallDiversity, undefined);

  // All metrics should be non-negative
  assertGreater(metrics.weightVariance, -0.01);
  assertGreater(metrics.squashEntropy, -0.01);
  assertGreater(metrics.topologyDiversity, -0.01);
  assertGreater(metrics.overallDiversity, -0.01);
});

Deno.test("EnsembleDiversityScoring - identifies low diversity species", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
    lowDiversityThreshold: 0.15, // Species below 0.15 are considered low diversity
  };

  const scoring = new EnsembleDiversityScoring(config);

  const homogeneousCreatures = createHomogeneousCreatures();
  const diverseCreatures = createDiverseCreatures();

  const homogeneousMetrics = scoring.getSpeciesDiversityMetrics(
    homogeneousCreatures,
  );
  const diverseMetrics = scoring.getSpeciesDiversityMetrics(diverseCreatures);

  // Homogeneous species should be identified as low diversity
  assertEquals(
    scoring.isLowDiversitySpecies(homogeneousMetrics.overallDiversity),
    true,
  );
  // Diverse species should not be identified as low diversity (higher than threshold)
  assertEquals(
    scoring.isLowDiversitySpecies(diverseMetrics.overallDiversity),
    false,
  );
  // Verify diverse has higher diversity than homogeneous
  assertGreater(
    diverseMetrics.overallDiversity,
    homogeneousMetrics.overallDiversity,
  );
});

// =============================================================================
// Parent Selection Diversity Tests
// =============================================================================

Deno.test("EnsembleDiversityScoring - calculates genetic distance between creatures", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
  };

  const scoring = new EnsembleDiversityScoring(config);

  const creature1 = createTestCreature([0.1, 0.2, 0.3, 0.4], "LOGISTIC");
  const creature2 = createTestCreature([0.9, 0.8, 0.7, 0.6], "TANH", 2);
  const creature3 = createTestCreature([0.11, 0.21, 0.31, 0.41], "LOGISTIC");

  const distance1to2 = scoring.calculateGeneticDistance(creature1, creature2);
  const distance1to3 = scoring.calculateGeneticDistance(creature1, creature3);

  // Distance to very different creature should be larger
  assertGreater(distance1to2, distance1to3);
  // Distances should be non-negative
  assertGreater(distance1to2, 0);
  assertGreater(distance1to3, -0.01);
});

Deno.test("EnsembleDiversityScoring - prefers diverse parent combinations", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
    diverseParentPreferenceWeight: 0.3,
  };

  const scoring = new EnsembleDiversityScoring(config);

  const mother = createTestCreature([0.1, 0.2, 0.3, 0.4], "LOGISTIC");
  const similarFather = createTestCreature(
    [0.11, 0.21, 0.31, 0.41],
    "LOGISTIC",
  );
  const diverseFather = createTestCreature([0.9, 0.8, 0.7, 0.6], "TANH", 2);

  const baseFitness = 0.8;

  const similarPairScore = scoring.getParentPairScore(
    baseFitness,
    mother,
    similarFather,
  );
  const diversePairScore = scoring.getParentPairScore(
    baseFitness,
    mother,
    diverseFather,
  );

  // Diverse parent pair should score higher
  assertGreater(diversePairScore, similarPairScore);
});

// =============================================================================
// Configuration Tests
// =============================================================================

Deno.test("EnsembleDiversityScoring - respects configuration weights", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
    weightVarianceWeight: 1.0,
    squashEntropyWeight: 0.0,
    topologyDiversityWeight: 0.0,
  };

  const scoring = new EnsembleDiversityScoring(config);

  // With only weight variance enabled, squash entropy should not affect score
  const creaturesWithDifferentSquashes = [
    createTestCreature([0.5, 0.5, 0.5, 0.5], "LOGISTIC"),
    createTestCreature([0.5, 0.5, 0.5, 0.5], "TANH"),
    createTestCreature([0.5, 0.5, 0.5, 0.5], "RELU"),
  ];

  const creaturesWithSameSquash = [
    createTestCreature([0.5, 0.5, 0.5, 0.5], "LOGISTIC"),
    createTestCreature([0.5, 0.5, 0.5, 0.5], "LOGISTIC"),
    createTestCreature([0.5, 0.5, 0.5, 0.5], "LOGISTIC"),
  ];

  const score1 = scoring.calculateDiversityScore(
    creaturesWithDifferentSquashes,
  );
  const score2 = scoring.calculateDiversityScore(creaturesWithSameSquash);

  // Since only weight variance matters and weights are the same, scores should be similar
  assertAlmostEquals(score1, score2, 0.1);
});

Deno.test("EnsembleDiversityScoring - isEnabled returns correct value", () => {
  const enabledConfig: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
  };

  const disabledConfig: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: false,
  };

  const enabledScoring = new EnsembleDiversityScoring(enabledConfig);
  const disabledScoring = new EnsembleDiversityScoring(disabledConfig);

  assertEquals(enabledScoring.isEnabled(), true);
  assertEquals(disabledScoring.isEnabled(), false);
});

Deno.test("EnsembleDiversityScoring - getConfig returns copy of config", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
    diversityWeight: 0.5,
  };

  const scoring = new EnsembleDiversityScoring(config);
  const retrievedConfig = scoring.getConfig();

  assertEquals(retrievedConfig.enabled, true);
  assertEquals(retrievedConfig.diversityWeight, 0.5);
});

// =============================================================================
// Edge Cases Tests
// =============================================================================

Deno.test("EnsembleDiversityScoring - handles single creature species", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
  };

  const scoring = new EnsembleDiversityScoring(config);

  const singleCreature = [createTestCreature([0.1, 0.2, 0.3, 0.4], "LOGISTIC")];

  const metrics = scoring.getSpeciesDiversityMetrics(singleCreature);

  // Single creature should have zero diversity
  assertEquals(metrics.weightVariance, 0);
  assertEquals(metrics.squashEntropy, 0);
  assertEquals(metrics.topologyDiversity, 0);
  assertEquals(metrics.overallDiversity, 0);
});

Deno.test("EnsembleDiversityScoring - handles empty species gracefully", () => {
  const config: EnsembleDiversityConfig = {
    ...DEFAULT_ENSEMBLE_DIVERSITY_CONFIG,
    enabled: true,
  };

  const scoring = new EnsembleDiversityScoring(config);

  const metrics = scoring.getSpeciesDiversityMetrics([]);

  // Empty species should have zero diversity
  assertEquals(metrics.weightVariance, 0);
  assertEquals(metrics.squashEntropy, 0);
  assertEquals(metrics.topologyDiversity, 0);
  assertEquals(metrics.overallDiversity, 0);
});
