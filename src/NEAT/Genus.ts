import { assert } from "@std/assert";
import type { Creature } from "../../mod.ts";
import { Species } from "./Species.ts";

export class Genus {
  readonly speciesMap: Map<string, Species>;
  readonly creatureToSpeciesMap: Map<string, string>;

  readonly population: Creature[] = [];

  constructor() {
    this.speciesMap = new Map();
    this.creatureToSpeciesMap = new Map();
  }

  addCreature(creature: Creature): Species {
    assert(creature.uuid, "No creature UUID");

    const existingSpeciesKey = this.creatureToSpeciesMap.get(creature.uuid);
    if (existingSpeciesKey) {
      const existingSpecies = this.speciesMap.get(existingSpeciesKey);
      assert(existingSpecies, "Existing species not found");
      return existingSpecies;
    }

    this.population.push(creature);
    const key = Species.calculateKey(creature);

    let species = this.speciesMap.get(key);
    if (!species) {
      species = new Species(key);
      this.speciesMap.set(key, species);
    }
    species.addCreature(creature);

    this.creatureToSpeciesMap.set(creature.uuid, key);

    return species;
  }

  findSpeciesByCreatureUUID(uuid: string): Species {
    const speciesKey = this.creatureToSpeciesMap.get(uuid);

    assert(speciesKey);

    const species = this.speciesMap.get(speciesKey);

    assert(species);

    return species;
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
