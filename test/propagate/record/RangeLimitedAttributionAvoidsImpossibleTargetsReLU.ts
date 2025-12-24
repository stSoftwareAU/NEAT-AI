import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";
import { ReLU } from "../../../src/methods/activations/types/ReLU.ts";
import { ReLU6 } from "../../../src/methods/activations/types/ReLU6.ts";

Deno.test(
  "Creature.record: record attribution avoids impossible negative targets for ReLU",
  () => {
    // Regression test for issue #950 (24-Dec-2025):
    // ReLU output range is [0, +∞), so negative record targets are impossible.
    // Record-time attribution must avoid routing negative value-space shares
    // through ReLU parents when a feasible alternative exists.

    const creatureJSON: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          uuid: "relu-hidden",
          type: "hidden",
          squash: ReLU.NAME,
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
        // Make ReLU activation large (10) so naive elasticity strongly prefers it.
        { fromUUID: "input-0", toUUID: "relu-hidden", weight: 10 },
        { fromUUID: "input-0", toUUID: "id-hidden", weight: 1 },

        // But keep the ReLU -> output weight small so its value-space share can
        // imply a large (and potentially negative) requested activation.
        { fromUUID: "relu-hidden", toUUID: "output-0", weight: 0.1 },
        { fromUUID: "id-hidden", toUUID: "output-0", weight: 1 },
      ],
    };

    const creature = Creature.fromJSON(creatureJSON);

    creature.activate(new Float32Array([1]));

    // Current output is ~2. Request 0 so record-time error is negative.
    const expected = new Float32Array([0]);
    const map = creature.record(expected);

    const reluRec = map.get("relu-hidden");
    assert(reluRec, "expected a discovery record for relu-hidden");

    const idRec = map.get("id-hidden");
    assert(idRec, "expected a discovery record for id-hidden");

    // Key assertion: we should not request negative targets from ReLU, so it
    // should not receive a recursive record() call.
    assertEquals(
      reluRec.errors.length,
      0,
      "ReLU parent should not be asked to absorb negative record targets when an alternative exists",
    );

    // And we should still attribute the error somewhere upstream.
    assert(
      idRec.errors.length > 0,
      "expected the feasible parent to receive record error attribution",
    );
  },
);

Deno.test(
  "Creature.record: record attribution avoids impossible negative targets for ReLU6",
  () => {
    // ReLU6 output range is [0, 6], so negative record targets are impossible.
    // This test ensures range feasibility is enforced during record attribution.

    const creatureJSON: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          uuid: "relu6-hidden",
          type: "hidden",
          squash: ReLU6.NAME,
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
        // Saturate ReLU6 to 6 so naive elasticity strongly prefers it.
        { fromUUID: "input-0", toUUID: "relu6-hidden", weight: 10 },
        { fromUUID: "input-0", toUUID: "id-hidden", weight: 1 },

        // Keep the capped path's weight small to force negative implied targets.
        { fromUUID: "relu6-hidden", toUUID: "output-0", weight: 0.1 },
        { fromUUID: "id-hidden", toUUID: "output-0", weight: 1 },
      ],
    };

    const creature = Creature.fromJSON(creatureJSON);

    creature.activate(new Float32Array([1]));

    const expected = new Float32Array([0]);
    const map = creature.record(expected);

    const relu6Rec = map.get("relu6-hidden");
    assert(relu6Rec, "expected a discovery record for relu6-hidden");

    const idRec = map.get("id-hidden");
    assert(idRec, "expected a discovery record for id-hidden");

    assertEquals(
      relu6Rec.errors.length,
      0,
      "ReLU6 parent should not be asked to absorb negative record targets when an alternative exists",
    );

    assert(
      idRec.errors.length > 0,
      "expected the feasible parent to receive record error attribution",
    );
  },
);
