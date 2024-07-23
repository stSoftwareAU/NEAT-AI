import { assert } from "@std/assert";
import type { Creature } from "../../src/Creature.ts";
import { generate as generateV5Sync } from "../architecture/SyncV5.ts";

export class Species {
  private static TE = new TextEncoder();
  private static NAMESPACE_UUID = "1b671a64-40d5-491e-99b0-ac01ff1f5641";

  creatures: Creature[];
  lastCreature: Creature | undefined;

  readonly speciesKey: string;

  constructor(speciesKey: string) {
    this.speciesKey = speciesKey;
    this.creatures = [];
  }

  addCreature(creature: Creature) {
    this.lastCreature = creature;
    this.creatures.push(creature);
  }

  static calculateKey(creature: Creature): string {
    const squashNames = creature.neurons.map((neuron) => neuron.squash).join(
      ":",
    );

    const data = Species.TE.encode(squashNames);

    const uuid: string = generateV5Sync(Species.NAMESPACE_UUID, data);
    return uuid;
  }
}
