import { assert } from "@std/assert";
import type { Creature } from "../../src/Creature.ts";
import { generate as generateV5 } from "@std/uuid/v5";

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
    assert(creature, "Creature must be defined");
    assert(creature.uuid, "Creature must have a uuid");

    this.lastCreature = creature;
    this.creatures.push(creature);
  }

  static async calculateKey(creature: Creature): Promise<string> {
    const squashNames = creature.neurons.map((neuron) => neuron.squash).join(
      ":",
    );

    const data = Species.TE.encode(squashNames);

    const uuid: string = await generateV5(Species.NAMESPACE_UUID, data);
    return uuid;
  }
}
