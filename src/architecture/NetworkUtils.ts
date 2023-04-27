import { generate as generateV5 } from "https://deno.land/std@0.184.0/uuid/v5.ts";
import { Network } from "./Network.ts";

export class NetworkUtil {
  private static TE = new TextEncoder();
  private static NAMESPACE = "843dc7df-f60b-47f6-823d-2992e0a4295c";

  static async makeUUID(creature: Network) {
    if (!creature.connections) {
      console.trace();
      console.warn(JSON.stringify(creature, null, 2));
      throw "Not an object was: " + (typeof creature);
    }
    if (creature.uuid) {
      return creature.uuid;
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
    delete json.tags;
    delete json.uuid;
    delete json.score;

    const txt = JSON.stringify(json, null, 1);

    const utf8 = NetworkUtil.TE.encode(txt);

    const uuid: string = await generateV5(NetworkUtil.NAMESPACE, utf8);
    creature.uuid = uuid;
    return uuid;
  }
}
