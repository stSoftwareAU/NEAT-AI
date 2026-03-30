import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { compactCreature } from "../../src/compact/CompactCreature.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test(
  "compactCreature removes disconnected constant (no outward synapses)",
  async () => {
    await initWasmForTests();

    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 1,
      output: 1,
      neurons: [
        { type: "constant", uuid: "unused-const", bias: 1 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      ],
    };

    const creature = Creature.fromJSON(json, false);
    const compacted = compactCreature(creature, false);
    assertEquals(compacted !== undefined, true);
    creatureValidate(compacted!, { forwardOnly: true });
    assertEquals(
      compacted!.neurons.some((n) => n.type === "constant"),
      false,
    );
  },
);
