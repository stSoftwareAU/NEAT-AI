import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { ABSOLUTE } from "../../../src/methods/activations/types/ABSOLUTE.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";

Deno.test(
  "Creature.record: redistributed blocked error must not make a previously-feasible parent target infeasible (ABSOLUTE)",
  () => {
    // Regression test for issue #950 follow-up (24-Dec-2025):
    //
    // We filter out infeasible upstream targets and then redistribute the blocked
    // value-space share across remaining links. The redistribution must *also*
    // preserve feasibility.
    //
    // Without a second feasibility pass (or an iterative redistribution loop),
    // an initially-feasible ABSOLUTE parent can receive extra negative share and
    // end up with a negative requested activation, which then gets silently
    // clamped inside `Neuron.record()` and pollutes discovery metrics.

    const creatureJSON: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          uuid: "abs-victim",
          type: "hidden",
          squash: ABSOLUTE.NAME,
          bias: 0,
        },
        {
          uuid: "abs-blocker",
          type: "hidden",
          squash: ABSOLUTE.NAME,
          bias: 0,
        },
        {
          uuid: "id-alt",
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
        // Drive the ABSOLUTE activations to deterministic values.
        // input=1 => abs-victim ~= 0.5, abs-blocker ~= 3, id-alt ~= 0.001
        { fromUUID: "input-0", toUUID: "abs-victim", weight: 0.5 },
        { fromUUID: "input-0", toUUID: "abs-blocker", weight: 3 },
        { fromUUID: "input-0", toUUID: "id-alt", weight: 0.001 },

        // Output aggregation:
        // - abs-blocker has huge activation so elastic distribution allocates
        //   most negative error to it, but the small-ish weight makes its implied
        //   requested activation go negative (infeasible for ABSOLUTE).
        // - abs-victim is initially feasible, but can become infeasible after it
        //   receives the redistributed blocked error share.
        { fromUUID: "abs-victim", toUUID: "output-0", weight: 1 },
        { fromUUID: "abs-blocker", toUUID: "output-0", weight: 0.2 },
        { fromUUID: "id-alt", toUUID: "output-0", weight: 1 },
      ],
    };

    const creature = Creature.fromJSON(creatureJSON);

    creature.activate(new Float32Array([1]));

    // Current output is ~1.101. Request 0 so record-time error is negative.
    const expected = new Float32Array([0]);
    const map = creature.record(expected);

    const victimRec = map.get("abs-victim");
    assert(victimRec, "expected a discovery record for abs-victim");

    const altRec = map.get("id-alt");
    assert(altRec, "expected a discovery record for id-alt");

    // Key assertion: abs-victim starts feasible, but must not receive a record()
    // recursion with a negative requested activation after redistribution.
    assertEquals(
      victimRec.errors.length,
      0,
      "redistribution must not push a feasible ABSOLUTE parent into an infeasible negative target",
    );

    // The error should still be attributed somewhere upstream.
    assert(
      altRec.errors.length > 0,
      "expected the feasible alternative parent to receive record error attribution",
    );
  },
);
