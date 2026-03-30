import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { prepareCreatureForBreeding } from "../../src/upgrade/Upgrade.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test(
  "prepareCreatureForBreeding recovers 4.x forward-only IF_CONDITIONS (strip-class damage)",
  async () => {
    await initWasmForTests();

    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 3,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "if-h", squash: "IF", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "if-h",
          weight: 0.2,
          type: "positive",
        },
        {
          fromUUID: "input-1",
          toUUID: "if-h",
          weight: -0.1,
          type: "condition",
        },
        { fromUUID: "if-h", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json, false);
    prepareCreatureForBreeding(creature);
    creature.validate({ forwardOnly: true });

    assertEquals(creature.neurons[creature.input].squash, "IDENTITY");
  },
);
