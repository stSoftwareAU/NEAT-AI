import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";

Deno.test("fix/IFTooFewInboundConnections - should downgrade IF rather than throwing", () => {
  // Arrange: output neuron uses IF, but this tiny topology cannot supply 3 inbound
  // connections because `makeRandomConnection()` will not connect from outputs.
  const json: CreatureExport = {
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IF", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-1", weight: -0.25 },
    ],
    input: 2,
    output: 2,
  };

  // Act: this used to throw from IF.fix() with "Should have 3 or more connections was: 2".
  const creature = Creature.fromJSON(json);
  creature.fix();

  // Assert: creature remains valid and the IF squash is removed (downgraded).
  creature.validate();
  const output1 = creature.neurons.find((n) => n.uuid === "output-1");
  assert(output1, "Expected output-1 neuron to exist");
  assert(output1.squash !== "IF", "Expected output-1 squash to be downgraded");
});
