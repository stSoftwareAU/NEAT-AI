/**
 * Regression for GRQ-25-sloth.log: same corrupt pattern as GRQ-24 (Issue #2086)
 * — duplicate (from,to) rows plus a hidden with outward edges but NO_INWARD.
 * Ingest must repair on `loadFrom` / `Creature.fromJSON(..., true)` without a
 * manual `mergeDuplicateSynapses()` on the plain JSON first.
 *
 * @see https://github.com/stSoftwareAU/NEAT-AI/issues/2086
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";

Deno.test(
  "GRQ-25-sloth: fromJSON(validate true) merges duplicate synapses and repairs NO_INWARD",
  () => {
    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "orphan-hidden",
          squash: "IDENTITY",
          bias: 0,
        },
        { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "orphan-hidden", toUUID: "output-0", weight: 0.1 },
        { fromUUID: "input-0", toUUID: "h1", weight: 0.2, type: "condition" },
        { fromUUID: "input-0", toUUID: "h1", weight: 0.3 },
        { fromUUID: "input-1", toUUID: "h1", weight: 0.4 },
        { fromUUID: "h1", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json, true);

    creature.validate({ forwardOnly: true });

    const seen = new Set<string>();
    for (const s of creature.synapses) {
      const key = `${s.from}->${s.to}`;
      assert(!seen.has(key), `duplicate synapse endpoints ${key}`);
      seen.add(key);
    }

    const constants = creature.neurons.filter((n) => n.type === "constant");
    assertEquals(
      constants.length,
      1,
      "orphan-hidden should become constant after repair",
    );
  },
);
