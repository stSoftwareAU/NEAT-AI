import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";

Deno.test("Neuron.fix(): in recurrent mode, self-loop is only used as a last resort (no forward targets)", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    // Deliberately invalid ordering: output before hidden.
    // This lets us place a hidden neuron at the end so it has no forward targets.
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "hidden-tail", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.2 },
    ],
  };

  const creature = Creature.fromJSON(json, false);

  // Recurrent mode (not forward-only): self-loops are allowed.
  creature.forwardOnly = false;
  creature.fix();

  // We intentionally do not validate here because the neuron ordering is invalid by design.
  // The point is to exercise the "self-loop as last resort" branch.
  assertEquals(creature.synapses.some((s) => s.from === s.to), true);
});
