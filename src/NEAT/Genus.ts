import { assert } from "@std/assert";
import type { Creature } from "../../mod.ts";
import { Species } from "@neat/Species.ts";

/**
 * Per-species summary suitable for emitting on the training event payload.
 * Issue #2452.
 */
export interface SpeciesSummary {
  readonly speciesKey: string;
  readonly size: number;
  readonly bestRawFitness: number;
  readonly meanRawFitness: number;
  /** Adjusted (fitness-shared) fitness: bestRawFitness / size. */
  readonly adjustedFitness: number;
}

export class Genus {
  readonly speciesMap: Map<string, Species>;
  readonly creatureToSpeciesMap: Map<string, string>;

  readonly population: Creature[] = [];

  constructor() {
    this.speciesMap = new Map();
    this.creatureToSpeciesMap = new Map();
  }

  validate() {
    for (let indx = this.population.length; indx--;) {
      const creature = this.population[indx];

      const uuid = creature.uuid;
      assert(uuid);

      const existingSpeciesKey = this.creatureToSpeciesMap.get(uuid);
      assert(existingSpeciesKey, `No species for creature ${uuid}`);
      const existingSpecies = this.speciesMap.get(existingSpeciesKey);
      assert(existingSpecies, "Existing species not found");

      let found = false;
      for (let j = existingSpecies.creatures.length; j--;) {
        if (existingSpecies.creatures[j].uuid === uuid) {
          found = true;
          break;
        }
      }

      assert(found, "Not found in the species");
    }
  }
  addCreature(creature: Creature): Species {
    return this.addCreatureWithTask(creature, undefined);
  }

  /**
   * Issue #2530: Add a creature, optionally pre-binding it to a specialist
   * sub-task. When `specialistTaskId` is set, the creature joins (or
   * creates) a species whose key includes the task tag, so specialist
   * species are kept structurally separate from generalist species even
   * when their topologies match. The species's own `specialistTaskId`
   * field is set to track the binding.
   *
   * `specialistTaskId === undefined` is identical to {@link addCreature}.
   */
  addCreatureWithTask(
    creature: Creature,
    specialistTaskId: string | undefined,
  ): Species {
    assert(creature.uuid, "No creature UUID");

    const existingSpeciesKey = this.creatureToSpeciesMap.get(creature.uuid);
    if (existingSpeciesKey) {
      const existingSpecies = this.speciesMap.get(existingSpeciesKey);
      assert(existingSpecies, "Existing species not found");
      return existingSpecies;
    }

    this.population.push(creature);
    const topologyKey = Species.calculateKey(creature);
    // Tag the species key with the sub-task so specialist species do not
    // collide with same-topology generalists.
    const speciesKey = specialistTaskId === undefined
      ? topologyKey
      : `task:${specialistTaskId}|${topologyKey}`;

    let species = this.speciesMap.get(speciesKey);
    if (!species) {
      species = new Species(speciesKey);
      if (specialistTaskId !== undefined) {
        species.specialistTaskId = specialistTaskId;
      }
      this.speciesMap.set(speciesKey, species);
    }
    species.addCreature(creature);

    this.creatureToSpeciesMap.set(creature.uuid, speciesKey);

    return species;
  }

  findSpeciesByCreatureUUID(uuid: string): Species {
    const speciesKey = this.creatureToSpeciesMap.get(uuid);

    assert(speciesKey);

    const species = this.speciesMap.get(speciesKey);

    assert(species);

    return species;
  }

  /**
   * Issue #2452: Recompute per-species statistics across every species in
   * this genus. Call once per generation, after fitness evaluation and
   * before parent selection runs.
   */
  updateSpeciesStatistics(): void {
    this.speciesMap.forEach((species) => {
      species.computeStatistics();
    });
  }

  /**
   * Issue #2452: Build a stable, plain-data summary of every species for
   * inclusion on the training event payload. Sorted by species key for
   * deterministic ordering across calls.
   */
  speciesSummary(): SpeciesSummary[] {
    const summary: SpeciesSummary[] = [];
    this.speciesMap.forEach((species) => {
      summary.push({
        speciesKey: species.speciesKey,
        size: species.size,
        bestRawFitness: species.bestRawFitness,
        meanRawFitness: species.meanRawFitness,
        adjustedFitness: species.adjustedFitness,
      });
    });
    summary.sort((a, b) => a.speciesKey.localeCompare(b.speciesKey));
    return summary;
  }

  findClosestMatchingSpecies(creature: Creature): Species | null {
    assert(creature.uuid, "creature.uuid is undefined");
    const creatureSpeciesKey = this.creatureToSpeciesMap.get(creature.uuid);
    const creatureNeuronCount = creature.neurons.length;
    let closestSpecies: Species | null = null;
    let smallestDifference = Infinity;
    let largestPopulation = 0;

    this.speciesMap.forEach((species, key) => {
      if (key === creatureSpeciesKey) return; // Skip the creature's current species
      const exampleCreature = species.creatures[0]; // Assume at least one creature per species
      const difference = Math.abs(
        creatureNeuronCount - exampleCreature.neurons.length,
      );

      // Check if this species is closer or if it's equally close but more populated
      if (
        difference < smallestDifference ||
        (difference === smallestDifference &&
          species.creatures.length > largestPopulation)
      ) {
        closestSpecies = species;
        smallestDifference = difference;
        largestPopulation = species.creatures.length;
      }
    });

    return closestSpecies;
  }
}
