import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";

Deno.test("fix/IFDowngradeDuringFix - IF.fix should downgrade when 3rd inbound cannot be created", () => {
  // Arrange: create a valid tiny creature, then force an output neuron squash to IF
  // so `Creature.fix()` must run IF.fix(). With output=2, makeRandomConnection()
  // cannot source from other outputs, so only two inputs are eligible and the 3rd
  // inbound link is impossible.
  const json: CreatureExport = {
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-1", weight: -0.25 },
    ],
    input: 2,
    output: 2,
  };

  const creature = Creature.fromJSON(json);
  const target = creature.neurons.find((n) => n.uuid === "output-1");
  if (!target) throw new Error("Expected output-1 neuron to exist");

  // Force the problematic squash, then repair.
  target.squash = "IF";
  creature.fix();

  // Assert: IF should be downgraded deterministically for outputs.
  assertEquals(target.squash, "IDENTITY");
  creature.validate();
});
