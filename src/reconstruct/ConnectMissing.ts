import { Creature } from "../../mod.ts";
import type { SynapseExport } from "../architecture/SynapseInterfaces.ts";

/**
 * Connects missing neurons in the creature's brain.
 * @returns The modified creature instance.
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

  for (const missing of inputMissing) {
    tmpCreature.addConnection([missing], { weightScale: 0.1 });
  }

  return tmpCreature;
}