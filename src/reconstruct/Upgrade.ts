import { assert } from "@std/assert";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { Creature } from "../Creature.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import type { CrisprInterface } from "./CRISPR.ts";

/**
 * Upgrade class providing static methods to correct and apply CRISPR modifications to creatures.
 */
export class Upgrade {
  /**
   * Corrects the input size of a given creature export and returns a new creature with the corrected input size.
   *
   * @param json - The exported creature to be corrected.
   * @param input - The new input size to be applied to the creature.
   * @returns A new Creature instance with the corrected input size.
   * @throws Will throw an error if the input size is not a positive integer or if it attempts to reduce the input size.
   */
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

  /**
   * Cleans and updates legacy CRISPR data to the latest format.
   * Converts legacy node and connection properties to the newer neuron and synapse properties.
   * Ensures the mode is set to "insert" or "append".
   *
   * @param dnaLegacy - The legacy CRISPR data to be cleaned.
   * @returns The cleaned and updated CRISPR data.
   */
  static CRISPR(dnaLegacy: CrisprInterface): CrisprInterface {
    const dnaClean: CrisprInterface = JSON.parse(JSON.stringify(dnaLegacy));

    // Convert legacy nodes to neurons
    if ((dnaClean as unknown as { nodes: { squash: string }[] }).nodes) {
      (dnaClean as unknown as { neurons: { squash: string }[] }).neurons =
        (dnaClean as unknown as { nodes: { squash: string }[] }).nodes;
    }

    // Convert legacy connections to synapses
    if (
      (dnaClean as unknown as { connections: { weight: number }[] }).connections
    ) {
      (dnaClean as unknown as { synapses: { weight: number }[] }).synapses =
        (dnaClean as unknown as { connections: { weight: number }[] })
          .connections;
    }

    // Ensure mode is set to "insert" or "append"
    if (dnaClean.mode !== "insert") dnaClean.mode = "append";

    return dnaClean;
  }
}
