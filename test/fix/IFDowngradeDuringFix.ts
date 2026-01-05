import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { IF } from "../../src/methods/activations/aggregate/IF.ts";

Deno.test("fix/IFDowngradeDuringFix - IF.fix should downgrade when 3rd inbound cannot be created", () => {
  // Arrange: in a tiny 2->2 creature, each output has exactly 2 inbound connections
  // (from the 2 inputs). IF requires 3 (condition/positive/negative), but
  // `makeRandomConnection()` intentionally avoids sourcing from outputs, so a 3rd
  // inbound connection for an output neuron is impossible here.
  const creature = new Creature(2, 2);
  const target = creature.neurons.find((n) => n.uuid === "output-1");
  assert(target, "Expected output-1 neuron to exist");
  assertEquals(creature.inwardConnections(target.index).length, 2);

  // Force the problematic squash, then run the IF repair directly.
  target.squash = "IF";
  new IF().fix(target);

  // Assert: IF should be downgraded deterministically for outputs.
  assertEquals(target.squash, "IDENTITY");
  creature.validate();
});
