/**
 * PopulationSeeding.ts - Seed initial populations with pre-trained creatures.
 *
 * Issue #1861: Allows seeding a NEAT population with one or more pre-trained
 * creatures alongside randomly initialised ones. Pre-trained creatures act as
 * starting points for evolution on a new task.
 */

import { Creature } from "../Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

/**
 * Options for creating a seeded population.
 */
export interface PopulationSeedingOptions {
  /** Number of inputs for the target task */
  inputCount: number;

  /** Number of outputs for the target task */
  outputCount: number;

  /** Target population size (including seeds) */
  populationSize: number;

  /**
   * Pre-trained creature exports to use as seeds.
   * Each will be included in the initial population.
   */
  seeds: CreatureExport[];

  /**
   * Optional layer configuration for randomly initialised creatures.
   * If not provided, direct input-to-output connections are used.
   */
  layers?: { squash?: string; count: number }[];
}

/**
 * Creates a seeded population mixing pre-trained and random creatures.
 *
 * The returned array has pre-trained creatures first, followed by randomly
 * initialised creatures to fill the remaining population slots.
 *
 * @returns Array of creatures ready for evolution
 */
export function createSeededPopulation(
  options: PopulationSeedingOptions,
): CreatureExport[] {
  const { inputCount, outputCount, populationSize, seeds, layers } = options;
  const population: CreatureExport[] = [];

  // Add seed creatures (capped at population size)
  const seedCount = Math.min(seeds.length, populationSize);
  for (let i = 0; i < seedCount; i++) {
    population.push(seeds[i]);
  }

  // Fill remaining slots with randomly initialised creatures
  const remainingSlots = populationSize - seedCount;
  for (let i = 0; i < remainingSlots; i++) {
    const creature = new Creature(inputCount, outputCount, { layers });
    population.push(creature.exportJSON());
  }

  return population;
}
