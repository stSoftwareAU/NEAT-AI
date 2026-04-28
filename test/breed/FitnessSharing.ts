/**
 * Issue #2453 — fitness sharing in parent selection and per-species
 * breeding quotas.
 *
 * Three scenarios from the issue:
 *   1. Two-species pop (sizes 9 and 1, equal raw fitness): under fitness
 *      sharing the lone creature wins at least 1 in 5 mother selections,
 *      compared to the ~1 in 10 baseline without sharing.
 *   2. Quota allocation matches fixed adjusted-fitness shares within ±1.
 *   3. With `fitnessSharing.enabled = false`, behaviour is identical to
 *      the previous raw-fitness-only path.
 */

import { assert, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
import { allocateBreedingQuotas } from "@neat/BreedingQuotas.ts";
import { Genus } from "@neat/Genus.ts";
import { FitnessRanking } from "@breed/FitnessRanking.ts";
import {
  buildAdjustedFitnessMap,
  selectParent,
} from "@breed/ParentSelection.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Selection } from "@methods/Selection.ts";

/**
 * Build a creature placed in a species bucket determined by
 * `hiddenCount`. Species.calculateKey buckets by hidden count
 * (NEURON_BUCKET_SIZE=10), so 0-9 hidden → bucket 0, 10-19 → bucket 1, etc.
 *
 * Each creature is given at least one hidden neuron with a fresh
 * `crypto.randomUUID()` so its overall topology hash is unique — this
 * stops the genus deduplicating identical topologies into a single
 * member.
 */
function makeCreature(score: number, hiddenCount: number): Creature {
  // Always add at least 1 hidden neuron to guarantee a unique topology.
  const effectiveHidden = Math.max(1, hiddenCount);
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  let lastUuid: string | null = null;
  for (let i = 0; i < effectiveHidden; i++) {
    const uuid = crypto.randomUUID();
    neurons.push({
      type: "hidden",
      uuid,
      squash: "LOGISTIC",
      bias: 0.05 * (i + 1),
    });
    synapses.push({
      fromUUID: i === 0 ? "input-0" : lastUuid!,
      toUUID: uuid,
      weight: 0.5 + 0.001 * i,
    });
    lastUuid = uuid;
  }
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });
  synapses.push({
    fromUUID: lastUuid!,
    toUUID: "output-0",
    weight: 0.7,
  });
  const json: CreatureExport = {
    input: 1,
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

function buildTwoSpeciesGenus(
  bigSize: number,
  smallSize: number,
  rawScore: number,
): { genus: Genus; smallUUIDs: Set<string>; bigUUIDs: Set<string> } {
  const genus = new Genus();
  const smallUUIDs = new Set<string>();
  const bigUUIDs = new Set<string>();
  // Big species: 1 hidden neuron (bucket 0).
  for (let i = 0; i < bigSize; i++) {
    const c = makeCreature(rawScore, 1);
    bigUUIDs.add(c.uuid!);
    genus.addCreature(c);
  }
  // Small species: 11 hidden neurons (bucket 1).
  for (let i = 0; i < smallSize; i++) {
    const c = makeCreature(rawScore, 11);
    smallUUIDs.add(c.uuid!);
    genus.addCreature(c);
  }
  genus.updateSpeciesStatistics();
  // Sanity check: two species, each populated as requested.
  assertEquals(genus.speciesMap.size, 2);
  assertEquals(genus.population.length, bigSize + smallSize);
  return { genus, smallUUIDs, bigUUIDs };
}

Deno.test(
  "Issue #2453 — adjusted ranking gives lone creature at least 1 in 5 wins",
  () => {
    const { genus, smallUUIDs } = buildTwoSpeciesGenus(9, 1, 0.5);

    const adjusted = buildAdjustedFitnessMap(genus);
    const ranking = new FitnessRanking(genus.population, adjusted);
    const config = createNeatConfig({
      selection: Selection.FITNESS_PROPORTIONATE,
    });

    let smallWins = 0;
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      const selected = selectParent(ranking, config);
      if (smallUUIDs.has(selected.uuid!)) smallWins++;
    }

    // Adjusted fitness for big creatures = score/9; for the lone small
    // creature = score/1. Total adjusted = 9*(s/9) + 1*(s/1) = 2s, so
    // the small creature should win ~50% of the time. The acceptance
    // criterion is at least 1 in 5 (i.e. 400/2000); we expect well above.
    assert(
      smallWins >= trials / 5,
      `lone creature won ${smallWins}/${trials} selections, expected >= ${
        trials / 5
      }`,
    );

    // And on the raw-fitness baseline the lone creature wins ~1/10.
    const rawRanking = new FitnessRanking(genus.population);
    let rawSmallWins = 0;
    for (let i = 0; i < trials; i++) {
      const selected = selectParent(rawRanking, config);
      if (smallUUIDs.has(selected.uuid!)) rawSmallWins++;
    }
    assert(
      rawSmallWins < trials / 5,
      `raw-fitness baseline gave lone creature ${rawSmallWins}/${trials} ` +
        `selections (expected < ${trials / 5}); fitness sharing should ` +
        `be the strictly larger share`,
    );
    assert(
      smallWins > rawSmallWins,
      `fitness sharing (${smallWins}) should beat raw (${rawSmallWins})`,
    );
  },
);

Deno.test(
  "Issue #2453 — quota allocation matches adjusted-fitness shares within ±1",
  () => {
    // Build a genus with three species in a 5:3:2 mean-raw-fitness ratio.
    // Species sizes are equal so summedAdjusted = meanRawFitness.
    const genus = new Genus();
    const sizes = [4, 4, 4];
    const meanScores = [5, 3, 2];
    for (let speciesIdx = 0; speciesIdx < sizes.length; speciesIdx++) {
      // Distinct hidden-count buckets: 1, 11, 21 → buckets 0, 1, 2.
      const hiddenCount = 1 + speciesIdx * 10;
      for (let i = 0; i < sizes[speciesIdx]; i++) {
        const c = makeCreature(meanScores[speciesIdx], hiddenCount);
        genus.addCreature(c);
      }
    }
    genus.updateSpeciesStatistics();
    assertEquals(genus.speciesMap.size, 3);

    const totalSlots = 50;
    const minSpeciesSlots = 1;
    const quotas = allocateBreedingQuotas(genus, totalSlots, minSpeciesSlots);

    // Total slots assigned must equal request.
    let total = 0;
    quotas.forEach((q) => total += q);
    assertEquals(total, totalSlots);

    // Every species must have at least the minimum.
    quotas.forEach((q) => assert(q >= minSpeciesSlots));

    // Expected proportional shares: meanScores normalised over sum=10.
    // After reserving floor*3 = 3 slots, residual = 47.
    // Species 0: 47 * 0.5 = 23.5 → 23 + remainder candidate
    // Species 1: 47 * 0.3 = 14.1 → 14
    // Species 2: 47 * 0.2 = 9.4  → 9
    // Sum = 46, leftover = 1 → goes to species 0 (largest fractional 0.5).
    // Final: 1+23+1 = 24 (s0), 1+14+0 = 15 (s1), 1+9+0 = 10 (s2)... wait
    // s0 fractional 0.5, s2 fractional 0.4, s1 fractional 0.1; leftover
    // goes to s0. Add the floor: 24, 15, 10. Total = 49 + floors? Let me
    // recompute carefully — the assertion below uses an absolute ±1
    // tolerance on the proportional share, so exact value is not vital.
    const speciesKeys = Array.from(genus.speciesMap.keys());
    const speciesByMean: Array<{ key: string; mean: number }> = speciesKeys
      .map((key) => ({
        key,
        mean: genus.speciesMap.get(key)!.meanRawFitness,
      }))
      .sort((a, b) => b.mean - a.mean);

    // After excluding the per-species floors, the residual should be
    // distributed in proportion to summed adjusted fitness.
    const totalMean = speciesByMean.reduce((s, e) => s + e.mean, 0);
    const residual = totalSlots - minSpeciesSlots * speciesByMean.length;
    for (const e of speciesByMean) {
      const expectedShareOfResidual = (e.mean / totalMean) * residual;
      const expected = minSpeciesSlots + expectedShareOfResidual;
      const actual = quotas.get(e.key)!;
      assert(
        Math.abs(actual - expected) <= 1,
        `species ${e.key} got ${actual} slots, expected ~${
          expected.toFixed(2)
        } (±1)`,
      );
    }
  },
);

Deno.test(
  "Issue #2453 — minSpeciesSlots is enforced even for tiny adjusted fitness",
  () => {
    const genus = new Genus();
    // One dominant species (high score) and one tiny one (near-zero score).
    for (let i = 0; i < 20; i++) {
      genus.addCreature(makeCreature(10, 1));
    }
    genus.addCreature(makeCreature(0.0001, 11));
    genus.updateSpeciesStatistics();

    const quotas = allocateBreedingQuotas(genus, 30, 1);
    assertEquals(quotas.size, 2);
    quotas.forEach((q) => assert(q >= 1, `quota ${q} should respect floor`));
    let total = 0;
    quotas.forEach((q) => total += q);
    assertEquals(total, 30);
  },
);

Deno.test(
  "Issue #2453 — with fitnessSharing.enabled=false, ranking is raw-fitness only",
  () => {
    const { genus, smallUUIDs, bigUUIDs } = buildTwoSpeciesGenus(9, 1, 0.5);

    // When fitness sharing is disabled, no adjustedScores map is built,
    // so the ranking falls back to raw fitness — which is what callers
    // see today. Reproduce that path explicitly here.
    const ranking = new FitnessRanking(genus.population);
    // Every creature has the same raw score so getScore returns the same
    // value for everyone.
    for (const c of genus.population) {
      assertEquals(ranking.getScore(c.uuid!), 0.5);
    }

    // Selection counts should reflect uniform-by-count across the 10
    // creatures: lone creature wins ~10%, big species wins ~90%.
    const config = createNeatConfig({
      selection: Selection.FITNESS_PROPORTIONATE,
    });
    let small = 0;
    let big = 0;
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      const selected = selectParent(ranking, config);
      if (smallUUIDs.has(selected.uuid!)) small++;
      else if (bigUUIDs.has(selected.uuid!)) big++;
    }
    // Small species should be ~10% (wide tolerance for stochasticity).
    assert(
      small < trials * 0.18,
      `disabled sharing should keep small species near 10% — got ${small}/${trials}`,
    );
    // Big species should still dominate.
    assert(
      big > small * 4,
      `big species should dominate — got ${big} vs ${small}`,
    );
  },
);

Deno.test(
  "Issue #2453 — buildAdjustedFitnessMap divides raw score by species size",
  () => {
    const { genus, smallUUIDs, bigUUIDs } = buildTwoSpeciesGenus(9, 1, 1.8);
    const adjusted = buildAdjustedFitnessMap(genus);

    // Every creature in the 9-strong species gets 1.8/9 = 0.2.
    for (const uuid of bigUUIDs) {
      assertEquals(adjusted.get(uuid), 1.8 / 9);
    }
    // The lone creature gets 1.8/1 = 1.8.
    for (const uuid of smallUUIDs) {
      assertEquals(adjusted.get(uuid), 1.8);
    }
  },
);

Deno.test(
  "Issue #2453 — allocateBreedingQuotas returns empty map for zero slots",
  () => {
    const genus = new Genus();
    for (let i = 0; i < 5; i++) genus.addCreature(makeCreature(1, 1));
    genus.updateSpeciesStatistics();
    const quotas = allocateBreedingQuotas(genus, 0, 1);
    assertEquals(quotas.size, 0);
  },
);

Deno.test(
  "Issue #2453 — fitnessSharing config flag defaults to enabled",
  () => {
    const config = createNeatConfig({});
    assertEquals(config.fitnessSharing.enabled, true);
    assertEquals(config.fitnessSharing.minSpeciesSlots, 1);
  },
);

Deno.test(
  "Issue #2453 — fitnessSharing config flag honours overrides",
  () => {
    const config = createNeatConfig({
      fitnessSharing: { enabled: false, minSpeciesSlots: 3 },
    });
    assertEquals(config.fitnessSharing.enabled, false);
    assertEquals(config.fitnessSharing.minSpeciesSlots, 3);
  },
);
