import { assert } from "@std/assert";
import { Creature } from "../../mod.ts";
import { randomConnectMissing } from "../../src/reconstruct/ConnectMissing.ts";
import type { SynapseExport } from "../../src/architecture/SynapseInterfaces.ts";

Deno.test("ConnectMissing", () => {
  const creature = new Creature(10, 3);
  const exported = creature.exportJSON();
  exported.input = 20;
  const creature2 = Creature.fromJSON(exported);
  const creature3 = randomConnectMissing(creature2);

  const exported3 = creature3.exportJSON();
  console.log(exported3);

  assert(exported3.input === 20);
  const inputMissing = new Set<number>();
  for (let i = 0; i < exported3.input; i++) {
    inputMissing.add(i);
  }
  exported3.synapses.forEach((synapse: SynapseExport) => {
    if (synapse.fromUUID.startsWith("input")) {
      inputMissing.delete(parseInt(synapse.fromUUID.split("-")[1]));
    }
  });

  assert(
    inputMissing.size === 0,
    `Not all inputs are connected to the brain. ${inputMissing.size} missing inputs: ${
      Array.from(inputMissing).join(",")
    }`,
  );
});
