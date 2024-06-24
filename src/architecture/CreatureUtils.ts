import { generate as generateV5 } from "@std/uuid/v5";
import type { Creature } from "../Creature.ts";

/**
 * Utility class for Creature-related operations.
 */
export class CreatureUtil {
  private static TE = new TextEncoder();
  private static NAMESPACE = "843dc7df-f60b-47f6-823d-2992e0a4295c";

  /**
   * Shuffle an array in place using the Fisher-Yates shuffle algorithm.
   * @param array - The array to be shuffled.
   */
  static shuffle(array: Int32Array): void {
    if (array.length > 1) {
      for (let i = array.length; i--;) {
        const j = Math.round(Math.random() * i);
        [array[i], array[j]] = [array[j], array[i]];
      }
    }
  }

  /**
   * Generate a UUID for a creature based on its neurons and synapses.
   * If the creature already has a UUID, it returns the existing one.
   * @param creature - The creature for which to generate the UUID.
   * @returns The generated UUID.
   * @throws Will throw an error if the creature does not have synapses or neurons.
   */
  static async makeUUID(creature: Creature): Promise<string> {
    if (creature.uuid) {
      return creature.uuid;
    }

    if (!creature.synapses || !creature.neurons) {
      throw new Error("Not a creature: " + (typeof creature));
    }
    const holdDebug = creature.DEBUG;
    try {
      creature.DEBUG = false;
      const json = creature.exportJSON();

      // Sort neurons and synapses for consistent UUID generation
      json.neurons.sort((a, b) => a.uuid.localeCompare(b.uuid));
      json.synapses.sort((a, b) => {
        if (a.fromUUID === b.fromUUID) {
          return a.toUUID.localeCompare(b.toUUID);
        } else {
          return a.fromUUID.localeCompare(b.fromUUID);
        }
      });

      // Remove tags for UUID generation consistency
      json.neurons.forEach((n) => delete n.tags);
      json.synapses.forEach((s) => delete s.tags);

      const tmp = {
        neurons: json.neurons,
        synapses: json.synapses,
      };

      const txt = JSON.stringify(tmp);
      const utf8 = CreatureUtil.TE.encode(txt);
      const uuid: string = await generateV5(CreatureUtil.NAMESPACE, utf8);

      creature.uuid = uuid;
      return uuid;
    } finally {
      creature.DEBUG = holdDebug;
    }
  }
}
