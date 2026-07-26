/**
 * Benchmark for per-generation father-selection ranking reuse (Issue #3474).
 *
 * `findFather` runs once per parent pair — roughly population-size times per
 * generation. The legacy path rebuilt a `FitnessRanking` (a full score Map
 * plus a sort) on every call, giving O(n² log n) ranking work per generation.
 * The optimised path reuses one raw-fitness ranking per generation via a
 * `FatherSelectionCache` (whole-population plus one per species).
 *
 * This benchmark measures a whole "generation" of father selection — one
 * findFather call per mother across the population — with and without the
 * cache, at production population size.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi \
 *     bench/FatherSelectionRanking.ts
 */
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Genus } from "@neat/Genus.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Selection } from "../mod.ts";
import { findFather } from "@breed/ParentSelection.ts";
import { FitnessRanking } from "@breed/FitnessRanking.ts";
import { FatherSelectionCache } from "@breed/FatherSelectionCache.ts";

/**
 * Builds a small creature. `hiddenCount` is varied so the population spreads
 * across several species (species keys incorporate topology), exercising the
 * per-species ranking cache as well as the global-population one.
 */
function createCreature(hiddenCount: number, index: number): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      type: "hidden",
      uuid: `h-${index}-${i}`,
      squash: "LOGISTIC",
      bias: 0.1 * ((i + index) % 7),
    });
    synapses.push({
      fromUUID: "input-0",
      toUUID: `h-${index}-${i}`,
      weight: 0.3 + ((i + index) % 5) / 10,
    });
    synapses.push({
      fromUUID: `h-${index}-${i}`,
      toUUID: "output-0",
      weight: 0.2 + ((i + index) % 3) / 10,
    });
  }
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons,
    synapses,
  });
  CreatureUtil.makeUUID(creature);
  // Deterministic pseudo-random score spread so the ranking must sort.
  creature.score = ((index * 2654435761) % 1000) / 1000;
  return creature;
}

function buildGenus(populationSize: number): Genus {
  const genus = new Genus();
  for (let i = 0; i < populationSize; i++) {
    // 6 distinct topologies → ~6 species.
    genus.addCreature(createCreature(2 + (i % 6), i));
  }
  return genus;
}

const POPULATION = 500;
const genus = buildGenus(POPULATION);
const config = createNeatConfig({
  selection: Selection.POWER,
  // Force the global-breeding path so the whole-population ranking is the hot
  // path (worst case for per-call FitnessRanking rebuilds).
  globalBreedingRate: 1,
  diversityBreedingRate: 0,
});

console.log(
  `Population=${genus.population.length}, species=${genus.speciesMap.size}`,
);

// Legacy behaviour: no cache → one FitnessRanking rebuild per findFather call.
Deno.bench({
  name: "findFather x population — no cache (rebuild per call)",
  group: "generation",
  baseline: true,
  fn() {
    for (const mum of genus.population) {
      findFather(mum, genus, config);
    }
  },
});

// Optimised behaviour: one cache per generation → rankings built at most once.
Deno.bench({
  name: "findFather x population — cached ranking (Issue #3474)",
  group: "generation",
  fn() {
    const cache = new FatherSelectionCache(
      genus.population,
      new FitnessRanking(genus.population),
    );
    for (const mum of genus.population) {
      findFather(mum, genus, config, undefined, cache);
    }
  },
});
