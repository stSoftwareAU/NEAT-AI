import { generate as generateV5 } from "https://deno.land/std@0.212.0/uuid/v5.ts";
import { Creature } from "../Creature.ts";

export class CreatureUtil {
  private static TE = new TextEncoder();
  private static NAMESPACE = "843dc7df-f60b-47f6-823d-2992e0a4295c";

  /* Shuffle array in place using the Fisher-Yates shuffle algorithm */
  static shuffle<T>(array: T[]): void {
    if (array.length > 1) {
      for (let i = array.length; i--;) {
        const j = Math.round(Math.random() * i);
        [array[i], array[j]] = [array[j], array[i]];
      }
    }
  }

  static async makeUUID(creature: Creature) {
    if (creature.uuid) {
      return creature.uuid;
    }

    if (!creature.connections) {
      throw new Error("Not an object was: " + (typeof creature));
    }

    const json = JSON.parse(JSON.stringify(creature.internalJSON()));
    json.nodes.forEach(
      (n: { uuid?: string; trace?: unknown }) => {
        delete n.uuid;
        delete n.trace;
      },
    );
    json.connections.forEach(
      (c: { trace?: { used: boolean }; index?: number }) => {
        delete c.trace;
      },
    );
    const tmp = {
      nodes: json.nodes,
      connections: json.connections,
    };

    const txt = JSON.stringify(tmp);

    const utf8 = CreatureUtil.TE.encode(txt);

    const uuid: string = await generateV5(CreatureUtil.NAMESPACE, utf8);
    creature.uuid = uuid;
    return uuid;
  }
}
