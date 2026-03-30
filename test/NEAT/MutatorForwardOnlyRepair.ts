import { assertEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test(
  "Mutator: forward-only run fixes injected SELF_CONNECTION",
  () => {
    const config = createNeatConfig({
      feedbackLoop: false,
    });
    const mutator = new Mutator(config);

    const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
    assertEquals(creature.forwardOnly, true);

    const hiddenIndex = creature.input;
    creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.123));
    creature.synapses.sort((
      a,
      b,
    ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

    mutator.mutateCreature(creature, { name: "MOD_WEIGHT" }, undefined);
    mutator.repairAfterMutation(creature);

    creature.validate({ forwardOnly: true });
  },
);

Deno.test(
  "Mutator: repairAfterMutation removes disconnected constant (forward-only)",
  async () => {
    await initWasmForTests();
    const config = createNeatConfig({
      feedbackLoop: false,
    });
    const mutator = new Mutator(config);

    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 1,
      output: 1,
      neurons: [
        { type: "constant", uuid: "mutate-orphan-const", bias: 1 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      ],
    };
    const creature = Creature.fromJSON(json, false);
    mutator.repairAfterMutation(creature);
    creature.validate({ forwardOnly: true });
    assertEquals(creature.neurons.some((n) => n.type === "constant"), false);
  },
);
