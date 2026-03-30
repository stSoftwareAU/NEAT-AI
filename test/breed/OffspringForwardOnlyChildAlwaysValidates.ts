import { assert } from "@std/assert";
import { Creature } from "@creature";
import { Offspring } from "@architecture/Offspring.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Two valid forward-only parents must always produce a child that passes
 * creatureValidate (or breed returns undefined); never a structurally invalid
 * forward-only graph from reordering/skipped edges alone.
 */
Deno.test(
  "Offspring.breed: many forward-only crosses always validate or skip",
  async () => {
    await initWasmForTests();

    const mumJson: CreatureExport = {
      input: 2,
      output: 1,
      forwardOnly: true,
      semanticVersion: "4.0.0",
      neurons: [
        { type: "hidden", uuid: "hidden-a", squash: IDENTITY.NAME, bias: 0 },
        { type: "hidden", uuid: "hidden-b", squash: IDENTITY.NAME, bias: 0 },
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.4 },
        { fromUUID: "input-1", toUUID: "hidden-a", weight: -0.1 },
        { fromUUID: "hidden-a", toUUID: "hidden-b", weight: 0.3 },
        { fromUUID: "input-0", toUUID: "hidden-b", weight: 0.2 },
        { fromUUID: "hidden-b", toUUID: "output-0", weight: 0.9 },
        { fromUUID: "input-1", toUUID: "output-0", weight: 0.05 },
      ],
    };
    const dadJson: CreatureExport = {
      input: 2,
      output: 1,
      forwardOnly: true,
      semanticVersion: "4.0.0",
      neurons: [
        { type: "hidden", uuid: "hidden-b", squash: IDENTITY.NAME, bias: 0.05 },
        { type: "hidden", uuid: "hidden-a", squash: IDENTITY.NAME, bias: 0.06 },
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-b", weight: 0.11 },
        { fromUUID: "input-1", toUUID: "hidden-b", weight: 0.12 },
        { fromUUID: "hidden-b", toUUID: "hidden-a", weight: 0.13 },
        { fromUUID: "input-1", toUUID: "hidden-a", weight: 0.14 },
        { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.15 },
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.16 },
      ],
    };

    const mum = Creature.fromJSON(mumJson);
    const dad = Creature.fromJSON(dadJson);
    mum.validate({ forwardOnly: true });
    dad.validate({ forwardOnly: true });

    for (let i = 0; i < 400; i++) {
      const child = Offspring.breed(mum, dad, { forwardOnly: true });
      if (!child) continue;
      child.validate({ forwardOnly: true });
    }

    assert(true);
  },
);
