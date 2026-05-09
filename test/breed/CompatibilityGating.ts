/**
 * Tests for the soft compatibility-gated cross-species breeding
 * probability (Issue #2455).
 *
 * Verifies that diversity-driven father selection uses a soft
 * probabilistic gate: candidates are accepted with probability
 * `compatibility ^ power`, so similar architectures dominate while
 * rare exploratory hybrids still pass through. After `maxDraws`
 * rejections the gate falls back to the lowest-compatibility
 * candidate.
 */
import { assert, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import {
  Creature,
  type CreatureExport,
  CreatureUtil,
  Selection,
} from "../../mod.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Genus } from "@neat/Genus.ts";
import { findFather, softCompatibilityGate } from "@breed/ParentSelection.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";
import { DEFAULT_COMPATIBILITY_GATING_CONFIG } from "@config/CompatibilityGatingConfig.ts";
import {
  createSeededRng,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

/**
 * Builds a creature whose hidden-neuron set matches the given UUIDs.
 * The shared UUIDs control the compatibility score with the mother.
 */
function createCreatureWithHidden(
  score: number,
  hiddenUUIDs: string[],
): Creature {
  const neurons: CreatureExport["neurons"] = hiddenUUIDs.map((uuid) => ({
    type: "hidden" as const,
    uuid,
    squash: "LOGISTIC",
    bias: 0.1,
  }));
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  const synapses = [
    { fromUUID: "input-0", toUUID: hiddenUUIDs[0], weight: 0.5 },
  ];
  for (let i = 0; i < hiddenUUIDs.length - 1; i++) {
    synapses.push({
      fromUUID: hiddenUUIDs[i],
      toUUID: hiddenUUIDs[i + 1],
      weight: 0.3,
    });
  }
  synapses.push({
    fromUUID: hiddenUUIDs[hiddenUUIDs.length - 1],
    toUUID: "output-0",
    weight: 0.8,
  });

  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons,
    synapses,
  };
  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  creature.score = score;
  addTag(creature, "score", score.toString());
  return creature;
}

function createGenus(creatures: Creature[]): Genus {
  const genus = new Genus();
  for (const creature of creatures) {
    genus.addCreature(creature);
  }
  return genus;
}

Deno.test(
  "compatibilityGating - default config has gate enabled with power 1.5 and maxDraws 3",
  () => {
    const config = createNeatConfig({ seed: 1 });
    assertEquals(config.compatibilityGating.enabled, true);
    assertEquals(config.compatibilityGating.power, 1.5);
    assertEquals(config.compatibilityGating.maxDraws, 3);
  },
);

Deno.test(
  "compatibilityGating - exported defaults match NeatConfig defaults",
  () => {
    const config = createNeatConfig({ seed: 1 });
    assertEquals(
      config.compatibilityGating,
      DEFAULT_COMPATIBILITY_GATING_CONFIG,
    );
  },
);

Deno.test(
  "compatibilityGating - power: 0 distribution matches today's lowest-compat behaviour (regression)",
  () => {
    // Build a mother and a candidate pool whose compatibility scores
    // span 0..1. With `power: 0` the soft gate is bypassed and
    // diversity-driven selection falls back to the legacy
    // lowest-compatibility pick — the prior selection distribution.
    const motherHidden = [crypto.randomUUID(), crypto.randomUUID()];
    const mother = createCreatureWithHidden(0.95, motherHidden);

    const fullMatch = createCreatureWithHidden(0.9, [...motherHidden]);
    const halfMatch = createCreatureWithHidden(0.6, [
      motherHidden[0],
      crypto.randomUUID(),
    ]);
    const lowestMatch = createCreatureWithHidden(0.4, [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ]);
    const candidates = [fullMatch, halfMatch, lowestMatch];

    const genus = createGenus([mother, ...candidates]);

    const config = createNeatConfig({
      selection: Selection.POWER,
      globalBreedingRate: 1,
      diversityBreedingRate: 1,
      compatibilityGating: { enabled: true, power: 0, maxDraws: 3 },
      seed: 13,
    });

    // Run repeatedly — every call must select the lowest-compat
    // candidate, exactly matching the prior behaviour.
    //
    // Issue #2614: createCompatibleFatherFromCreatures now applies
    // synthetic-UUID alignment when the real-UUID overlap is below
    // `syntheticAlignmentThreshold` (default 0.2). For the lowest-compat
    // candidate (3 hidden neurons, 0 shared UUIDs) this aligns father
    // neurons to mother UUIDs, so post-alignment compatibility is no
    // longer a stable proxy. We therefore identify the chosen candidate
    // by hidden-neuron count (lowestMatch has 3; others have 2).
    const lowestMatchHiddenCount = 3;
    for (let i = 0; i < 25; i++) {
      const dad = findFather(mother, genus, config);
      assert(dad, "Father should be found");
      const hiddenCount = dad.neurons.filter((n) => n.type === "hidden").length;
      assertEquals(
        hiddenCount,
        lowestMatchHiddenCount,
        `Iteration ${i}: power 0 must pick lowestMatch (hidden=${hiddenCount})`,
      );
    }
  },
);

Deno.test(
  "compatibilityGating - enabled: false also restores prior lowest-compat behaviour",
  () => {
    const motherHidden = [crypto.randomUUID(), crypto.randomUUID()];
    const mother = createCreatureWithHidden(0.95, motherHidden);

    const fullMatch = createCreatureWithHidden(0.9, [...motherHidden]);
    const lowestMatch = createCreatureWithHidden(0.4, [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ]);

    const genus = createGenus([mother, fullMatch, lowestMatch]);
    const config = createNeatConfig({
      selection: Selection.POWER,
      globalBreedingRate: 1,
      diversityBreedingRate: 1,
      compatibilityGating: { enabled: false, power: 1.5, maxDraws: 3 },
      seed: 21,
    });

    // Issue #2614: see note on the previous test — identify the chosen
    // candidate by hidden-neuron count rather than post-alignment compat.
    const lowestMatchHiddenCount = 3;
    for (let i = 0; i < 20; i++) {
      const dad = findFather(mother, genus, config);
      assert(dad, "Father should be found");
      const hiddenCount = dad.neurons.filter((n) => n.type === "hidden").length;
      assertEquals(
        hiddenCount,
        lowestMatchHiddenCount,
        `Disabled gate must reproduce legacy lowest-compat pick`,
      );
    }
  },
);

Deno.test(
  "compatibilityGating - power: 2 selects high-compatibility fathers ≥3× more often than low",
  () => {
    // Build a candidate pool covering the high band (compatibility = 1)
    // and the low band (compatibility = 0). Use enough candidates per
    // band that the empirical ratio is statistically meaningful.
    const motherHidden = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const mother = createCreatureWithHidden(0.95, motherHidden);

    const highBand: Creature[] = [];
    const lowBand: Creature[] = [];
    for (let i = 0; i < 8; i++) {
      // High-compat creatures share the mother's full hidden set
      // (compatibility = 1.0 ≥ 0.7).
      highBand.push(
        createCreatureWithHidden(0.5 + i * 0.01, [...motherHidden]),
      );
      // Low-compat creatures use entirely fresh UUIDs
      // (compatibility = 0 ≤ 0.3).
      lowBand.push(
        createCreatureWithHidden(0.5 + i * 0.01, [
          crypto.randomUUID(),
          crypto.randomUUID(),
          crypto.randomUUID(),
        ]),
      );
    }
    const candidates = [...highBand, ...lowBand];

    let highHits = 0;
    let lowHits = 0;
    const trials = 600;
    // Seed the global RNG deterministically so the empirical ratio
    // is reproducible across machines and runs.
    setRandomNumberGenerator(createSeededRng(20455));
    // Use the soft gate directly to isolate the gating distribution
    // from upstream stochastic decisions in findFather.
    for (let i = 0; i < trials; i++) {
      const dad = softCompatibilityGate(mother, candidates, 2, 3);
      const compat = geneticCompatibility(mother, dad);
      if (compat >= 0.7) {
        highHits++;
      } else if (compat <= 0.3) {
        lowHits++;
      }
    }

    assert(
      highHits >= 3 * Math.max(lowHits, 1),
      `power: 2 should select high-compat fathers ≥3× more than low-compat. ` +
        `highHits=${highHits} lowHits=${lowHits}`,
    );
  },
);

Deno.test(
  "compatibilityGating - maxDraws fallback returns lowest-compat candidate when no high-compat exists",
  () => {
    // All candidates have compatibility 0 with the mother, so no draw
    // can pass the gate (`0 ^ power = 0` for any power > 0). The gate
    // must exhaust `maxDraws` and return the lowest-compat candidate.
    const mother = createCreatureWithHidden(0.95, [
      crypto.randomUUID(),
      crypto.randomUUID(),
    ]);
    const c1 = createCreatureWithHidden(0.5, [
      crypto.randomUUID(),
      crypto.randomUUID(),
    ]);
    const c2 = createCreatureWithHidden(0.5, [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ]);
    const c3 = createCreatureWithHidden(0.5, [crypto.randomUUID()]);
    const candidates = [c1, c2, c3];

    // Sanity check: every candidate has compatibility 0
    for (const c of candidates) {
      assertEquals(
        geneticCompatibility(mother, c),
        0,
        "Setup: every candidate must have compatibility 0",
      );
    }

    setRandomNumberGenerator(createSeededRng(11));
    const dad = softCompatibilityGate(mother, candidates, 2, 3);
    // Fallback: must be one of the candidates (the lowest-compat
    // pick — which here is whichever candidate selectMostDiverseFather
    // returns when all compatibilities tie at 0).
    assert(
      candidates.some((c) => c.uuid === dad.uuid),
      "Fallback should return one of the original candidates",
    );
    assertEquals(
      geneticCompatibility(mother, dad),
      0,
      "Fallback must select a lowest-compat (compat=0) candidate",
    );
  },
);
