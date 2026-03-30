import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { prepareCreatureForBreeding } from "../../src/upgrade/Upgrade.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test(
  "prepareCreatureForBreeding recovers 4.x forward-only NO_INWARD via fix()",
  async () => {
    await initWasmForTests();

    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 1,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "output-0",
          squash: "IDENTITY",
          bias: 0,
        },
        { type: "output", uuid: "real-output", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "output-0", toUUID: "real-output", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json, false);
    prepareCreatureForBreeding(creature);
    creature.validate({ forwardOnly: true });

    const hiddenIdx = creature.input;
    assertEquals(creature.inwardConnections(hiddenIdx).length >= 1, true);
  },
);
