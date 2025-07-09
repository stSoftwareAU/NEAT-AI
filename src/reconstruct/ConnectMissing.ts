import { Creature } from "../../mod.ts";
import type { SynapseExport } from "../architecture/SynapseInterfaces.ts";
import { AddConnection } from "../mutate/AddConnection.ts";

/**
 * Connects missing neurons in the creature's brain by adding connections
 * from unconnected input neurons to random neurons in the network.
 * 
 * This function identifies input neurons that have no outgoing connections
 * and creates new connections with small random weights to ensure all
 * inputs are utilized in the network.
 * 
 * @param creature - The creature instance to modify
 * @returns The modified creature with missing connections added
 */
export function randomConnectMissing(creature: Creature): Creature {
  const exported = creature.exportJSON();
  const inputMissing = new Set<number>();
  for (let i = 0; i < exported.input; i++) {
    inputMissing.add(i);
  }
  exported.synapses.forEach((synapse: SynapseExport) => {
    if (synapse.fromUUID.startsWith("input")) {
      inputMissing.delete(parseInt(synapse.fromUUID.split("-")[1]));
    }
  });

  if (inputMissing.size === 0) return creature;

  const tmpCreature = Creature.fromJSON(exported);
  const mutator = new AddConnection(tmpCreature);
  for (const missing of inputMissing) {
    mutator.mutate([missing], { weightScale: 0.1 });
  }

  return tmpCreature;
}
