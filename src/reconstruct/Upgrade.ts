import { assert } from "https://deno.land/std@0.221.0/assert/mod.ts";
import { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { Creature } from "../Creature.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";

export class Upgrade {
  static correct(
    json: CreatureExport,
    input: number,
  ): Creature {
    assert(Number.isInteger(input) && input > 0, `Invalid input size ${input}`);

    const json2 = JSON.parse(JSON.stringify(json));

    const adjIndex = input - json.input;
    assert(adjIndex >= 0, `Can only expand models ${json.input} -> ${input}`);

    json2.input = input;
    const creature = Creature.fromJSON(json2);

    creature.fix();
    creatureValidate(creature);
    return creature;
  }
}
