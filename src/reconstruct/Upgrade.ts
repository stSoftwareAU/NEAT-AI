import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { Creature } from "../Creature.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { CrisprInterface } from "./CRISPR.ts";

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

  static CRISPR(dnaLegacy: CrisprInterface): CrisprInterface {
    const dnaClean: CrisprInterface = JSON.parse(JSON.stringify(dnaLegacy));
    /* Legacy */
    if ((dnaClean as unknown as { nodes: { squash: string }[] }).nodes) {
      (dnaClean as unknown as { neurons: { squash: string }[] }).neurons =
        (dnaClean as unknown as { nodes: { squash: string }[] }).nodes;
    }

    if (
      (dnaClean as unknown as { connections: { weight: number }[] }).connections
    ) {
      (dnaClean as unknown as { synapses: { weight: number }[] }).synapses =
        (dnaClean as unknown as { connections: { weight: number }[] })
          .connections;
    }

    /* End Version 1 */
    if (dnaClean.mode !== "insert") dnaClean.mode = "append";

    return dnaClean;
  }
}
