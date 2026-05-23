import { assert, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { restoreGraftAliases } from "@breed/RestoreGraftAliases.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";

/**
 * Issue #2746: restoring a graft alias must never reintroduce a duplicate
 * UUID. A collided UUID makes `loadFrom` re-point another neuron's synapses,
 * which on a forward-only creature turns a forward edge into a recurrent one
 * and trips the `breed:fixAliases` TopologyError.
 */
Deno.test("restoreGraftAliases: restores a non-colliding alias", () => {
  const fixed: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      {
        type: "hidden",
        uuid: "mum-h",
        squash: IDENTITY.NAME,
        bias: 0,
        tags: [{ name: "alias", value: "dad-h" }],
      },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "mum-h", weight: 0.5 },
      { fromUUID: "mum-h", toUUID: "output-0", weight: 0.5 },
    ],
  };

  restoreGraftAliases(fixed);

  assertEquals(fixed.neurons[0].uuid, "dad-h");
  assertEquals(getTag(fixed.neurons[0], "alias"), null);
  assertEquals(fixed.synapses[0].toUUID, "dad-h");
  assertEquals(fixed.synapses[1].fromUUID, "dad-h");
});

Deno.test(
  "restoreGraftAliases: skips alias that collides with an existing UUID",
  () => {
    // Forward-only sorted graph:
    //   idx0 hidden "A"  →  idx1 hidden "B" (grafted, alias "A")  →  output
    // Naively restoring "B" → "A" duplicates "A": loadFrom maps "A" to idx1
    // and rewrites the A->B edge to A->A (from 1 -> to 1), a recurrent synapse
    // that trips the breed:fixAliases TopologyError. The collision must be
    // left untouched so the offspring stays forward-only.
    const fixed: CreatureExport = {
      input: 1,
      output: 1,
      forwardOnly: true,
      neurons: [
        { type: "hidden", uuid: "A", squash: IDENTITY.NAME, bias: 0 },
        {
          type: "hidden",
          uuid: "B",
          squash: IDENTITY.NAME,
          bias: 0,
          tags: [{ name: "alias", value: "A" }],
        },
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "A", weight: 0.5 },
        { fromUUID: "A", toUUID: "B", weight: 0.5 },
        { fromUUID: "input-0", toUUID: "B", weight: 0.5 },
        { fromUUID: "B", toUUID: "output-0", weight: 0.5 },
      ],
    };

    restoreGraftAliases(fixed);

    // UUIDs must remain unique.
    const uuids = fixed.neurons.map((n) => n.uuid);
    assertEquals(new Set(uuids).size, uuids.length);
    // The colliding neuron keeps its deduplicated identity.
    assertEquals(fixed.neurons[1].uuid, "B");
    // Alias tag is consumed regardless.
    assertEquals(getTag(fixed.neurons[1], "alias"), null);

    // The export must load as a valid forward-only creature (no recurrent edge).
    const child = Creature.fromJSON(fixed);
    child.validate({ forwardOnly: true });
    assert(child);
  },
);
