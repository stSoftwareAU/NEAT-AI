import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { ABSOLUTE } from "../../../src/methods/activations/types/ABSOLUTE.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";

Deno.test(
  "Creature.record: record attribution avoids impossible negative targets for non-negative squashes (ABSOLUTE)",
  () => {
    // Regression test for issue #950 (24-Dec-2025):
    // Record-time error attribution used to request negative target activations
    // from a non-negative squash (ABSOLUTE) when it had a large activation, even
    // if an alternative inbound synapse could carry the error instead.

    const creatureJSON: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          uuid: "abs-hidden",
          type: "hidden",
          squash: ABSOLUTE.NAME,
          bias: 0,
        },
        {
          uuid: "id-hidden",
          type: "hidden",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          uuid: "output-0",
          type: "output",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        // Make ABSOLUTE activation large (10) so naive elasticity strongly
        // prefers pushing error through it.
        { fromUUID: "input-0", toUUID: "abs-hidden", weight: 10 },
        { fromUUID: "input-0", toUUID: "id-hidden", weight: 1 },

        // But keep the ABSOLUTE -> output weight small so a value-space share
        // implies a large (and potentially negative) requested activation.
        { fromUUID: "abs-hidden", toUUID: "output-0", weight: 0.1 },
        { fromUUID: "id-hidden", toUUID: "output-0", weight: 1 },
      ],
    };

    const creature = Creature.fromJSON(creatureJSON);

    creature.activate(new Float32Array([1]));

    // Current output is ~2. Request 0 so record-time error is negative.
    const expected = new Float32Array([0]);
    const map = creature.record(expected);

    const absRec = map.get("abs-hidden");
    assert(absRec, "expected a discovery record for abs-hidden");

    const idRec = map.get("id-hidden");
    assert(idRec, "expected a discovery record for id-hidden");

    // Key assertion: we should avoid requesting impossible negative targets for
    // ABSOLUTE, so it should not receive a recursive record() call.
    assertEquals(
      absRec.errors.length,
      0,
      "ABSOLUTE parent should not be asked to absorb negative record targets when an alternative exists",
    );

    // And we should still attribute the error somewhere upstream.
    assert(
      idRec.errors.length > 0,
      "expected the feasible parent to receive record error attribution",
    );
  },
);
