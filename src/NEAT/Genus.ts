import { Creature } from "../../mod.ts";
import { Species } from "./Species.ts";

export class Genus {
  readonly speciesMap: Map<string, Species>;
  readonly creatureToSpeciesMap: Map<string, string>;

  constructor() {
    this.speciesMap = new Map();
    this.creatureToSpeciesMap = new Map();
  }

  async addCreature(creature: Creature): Promise<Species> {
    if (creature === undefined || creature.uuid === undefined) {
      throw new Error(`creature ${creature.uuid} is undefined`);
    }

    const key = await Species.calculateKey(creature);

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

    if (!speciesKey) {
      throw new Error(`Could not find species for creature ${uuid}`);
    }
    const species = this.speciesMap.get(speciesKey);

    if (!species) {
      throw new Error(`Could not find species ${speciesKey}`);
    }

    return species;
  }
}
