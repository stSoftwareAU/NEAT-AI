/**
 * Shared parent selection utilities for breeding.
 *
 * Issue #1392: Extracted from Breed.ts and ParallelBreeding.ts to
 * eliminate DRY violation where getDad() and selectParent() were
 * independently defined with identical logic.
 */

import { assert } from "@std/assert";
import { Creature, Selection } from "../../mod.ts";
import type { NeatConfig } from "../config/NeatConfig.ts";
import type { Genus } from "../NEAT/Genus.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
import { calculateAdaptiveTournamentSize } from "./AdaptiveTournamentSize.ts";
import { createCompatibleFatherFromCreatures } from "./Father.ts";
import { FitnessRanking } from "./FitnessRanking.ts";

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
      throw new Error(`Unknown selection: ${config.selection}`);
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

  // Create a new FitnessRanking for the filtered father population
  const fatherRanking = new FitnessRanking(possibleFathers);
  const father = selectParent(fatherRanking, config);
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
