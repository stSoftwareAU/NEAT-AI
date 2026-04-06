/**
 * Shared parent selection utilities for breeding.
 *
 * Issue #1392: Extracted from Breed.ts and ParallelBreeding.ts to
 * eliminate DRY violation where getDad() and selectParent() were
 * independently defined with identical logic.
 */

import { assert } from "@std/assert";
import { Creature, Selection } from "../../mod.ts";
import type { NeatConfig } from "@config/NeatConfig.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import type { Genus } from "@neat/Genus.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { calculateAdaptiveTournamentSize } from "@breed/AdaptiveTournamentSize.ts";
import { createCompatibleFatherFromCreatures } from "@breed/Father.ts";
import { FitnessRanking } from "@breed/FitnessRanking.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";

/**
 * Selects a parent from a pre-computed fitness ranking based on the selection strategy.
 *
 * Uses the pre-computed FitnessRanking for O(1) or O(k) selection instead of
 * recalculating fitness metrics on every selection.
 *
 * @param ranking - Pre-computed fitness ranking
 * @param config - NEAT configuration
 * @returns The selected parent creature
 * @throws {Error} When selection fails or unknown selection strategy
 */
export function selectParent(
  ranking: FitnessRanking,
  config: NeatConfig,
): Creature {
  switch (config.selection) {
    case Selection.POWER: {
      return ranking.selectPower(Selection.POWER.power);
    }
    case Selection.FITNESS_PROPORTIONATE: {
      return ranking.selectFitnessProportionate();
    }
    case Selection.TOURNAMENT: {
      // Issue #1019: Use adaptive tournament size that scales with population
      // instead of fixed size of 5. This improves selection pressure for
      // large populations and reduces variance for small populations.
      const adaptiveSize = calculateAdaptiveTournamentSize(
        ranking.sortedPopulation.length,
      );

      return ranking.selectTournament(
        adaptiveSize,
        Selection.TOURNAMENT.probability,
      );
    }
    default: {
      throw new ValidationError(
        `Unknown selection: ${config.selection}`,
        "OTHER",
      );
    }
  }
}

/**
 * Selects a father for breeding with the given mother.
 *
 * Creates a FitnessRanking for the filtered father population to enable
 * efficient parent selection. Falls back through species-based selection,
 * closest species, and global population as needed.
 *
 * @param mum - The mother creature
 * @param genus - The genus containing the population
 * @param config - NEAT configuration
 * @returns A compatible father creature, or undefined if none found
 */
export function findFather(
  mum: Creature,
  genus: Genus,
  config: NeatConfig,
): Creature | undefined {
  assert(mum.uuid, "Mother UUID is undefined");

  let possibleFathers: Creature[] = [];

  if (config.globalBreedingRate > getRandomNumberGenerator().random()) {
    possibleFathers = genus.population.filter((creature) =>
      creature.uuid !== mum.uuid
    );
  }

  if (possibleFathers.length === 0) {
    const species = genus.findSpeciesByCreatureUUID(mum.uuid);

    possibleFathers = species.creatures.filter((creature) =>
      creature.uuid !== mum.uuid
    );

    if (possibleFathers.length === 0) {
      const closestSpecies = genus.findClosestMatchingSpecies(mum);
      if (closestSpecies) {
        possibleFathers = closestSpecies.creatures;

        if (possibleFathers.length === 0) {
          possibleFathers = genus.population.filter((creature) =>
            creature.uuid !== mum.uuid
          );
        }
      }
    }
  }

  if (possibleFathers.length === 0) {
    return undefined;
  }

  // Issue #2173: Diversity-driven breeding. When diversityBreedingRate triggers,
  // select the most genetically distant father instead of a fitness-biased one.
  // This ensures newcomers from isolated islands (e.g., Europa) periodically
  // breed with fitter creatures despite having low initial fitness.
  const father = selectFatherFromCandidates(mum, possibleFathers, config);
  assert(father !== undefined, "Father is undefined");

  // Issue #1034: Avoid JSON exports in parent selection compatibility check.
  // Uses optimised function that works directly with Creature objects.
  const fatherExport = createCompatibleFatherFromCreatures(mum, father);
  try {
    const compatibleFather = Creature.fromJSON(
      fatherExport,
    );

    return compatibleFather;
  } catch (e) {
    Deno.writeTextFileSync(
      "./.source_mother.json",
      JSON.stringify(mum.exportJSON(), null, 1),
    );
    Deno.writeTextFileSync(
      "./.source_father.json",
      JSON.stringify(father.exportJSON(), null, 1),
    );

    Deno.writeTextFileSync(
      "./.invalid_father.json",
      JSON.stringify(fatherExport, null, 1),
    );
    throw e;
  }
}

/**
 * Selects a father from candidate creatures, optionally using diversity-driven
 * selection (Issue #2173).
 *
 * When `config.diversityBreedingRate` triggers (random check), the most
 * genetically distant creature from the mother is selected. Otherwise,
 * standard fitness-biased selection is used via FitnessRanking.
 *
 * @param mum - The mother creature
 * @param candidates - Array of potential father creatures
 * @param config - NEAT configuration
 * @returns The selected father creature
 */
function selectFatherFromCandidates(
  mum: Creature,
  candidates: Creature[],
  config: NeatConfig,
): Creature {
  if (
    config.diversityBreedingRate > 0 &&
    config.diversityBreedingRate > getRandomNumberGenerator().random()
  ) {
    return selectMostDiverseFather(mum, candidates);
  }

  const fatherRanking = new FitnessRanking(candidates);
  return selectParent(fatherRanking, config);
}

/**
 * Selects the most genetically distant creature from the mother (Issue #2173).
 *
 * Iterates through all candidates and picks the one with the lowest genetic
 * compatibility score (i.e., maximum genetic distance). This ensures
 * newcomers from isolated populations breed with established creatures.
 *
 * @param mum - The mother creature
 * @param candidates - Array of potential father creatures
 * @returns The most genetically distant creature from the mother
 */
export function selectMostDiverseFather(
  mum: Creature,
  candidates: Creature[],
): Creature {
  let mostDiverse = candidates[0];
  let lowestCompatibility = 1;

  for (const candidate of candidates) {
    const compatibility = geneticCompatibility(mum, candidate);
    if (compatibility < lowestCompatibility) {
      lowestCompatibility = compatibility;
      mostDiverse = candidate;
    }
  }

  return mostDiverse;
}
