import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { ValidationError } from "../../src/errors/ValidationError.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * GRQ-12 class: hidden mis-tagged uuid `output-0` with outward edge only — no
 * inbound after corrupt strip. `fix()` must add a random forward inbound.
 */
Deno.test(
  "fix({ forwardOnly: true }) adds random inbound for hidden with no inward connections",
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

    assertThrows(
      () => creature.validate({ forwardOnly: true }),
      ValidationError,
      "no inward connections",
    );

    creature.fix({ forwardOnly: true });
    creature.validate({ forwardOnly: true });

    assertEquals(
      creature.inwardConnections(creature.input).length >= 1,
      true,
      "hidden should gain at least one inbound synapse",
    );
  },
);
