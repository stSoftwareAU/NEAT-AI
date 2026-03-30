import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { prepareCreatureForBreeding } from "@upgrade/Upgrade.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test(
  "prepareCreatureForBreeding recovers 4.x forward-only NO_OUTWARD (orphan constant) via fix()",
  async () => {
    await initWasmForTests();

    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 1,
      output: 1,
      neurons: [
        {
          type: "constant",
          uuid: "orphan-const",
          bias: 1,
        },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      ],
    };

    const creature = Creature.fromJSON(json, false);
    prepareCreatureForBreeding(creature);
    creature.validate({ forwardOnly: true });

    assertEquals(
      creature.neurons.some((n) => n.type === "constant"),
      false,
      "Disconnected constant should be removed",
    );
  },
);
