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
  const originalMutate = target.mutate.bind(target);
  // Defensive: if IF.fix falls through to mutate(), this test should fail.
  // We want to specifically exercise the downgrade path.
  (target as unknown as { mutate: (name: string) => boolean }).mutate = () => {
    throw new Error("Unexpected mutate() during IF.fix downgrade path");
  };
  try {
    new IF().fix(target);
  } finally {
    (target as unknown as { mutate: (name: string) => boolean }).mutate =
      originalMutate;
  }

  // Assert: IF should be downgraded deterministically for outputs.
  assertEquals(target.squash, "IDENTITY");
  creature.validate();
});

Deno.test("fix/IFDowngradeDuringFix - IF.fix downgrades non-output neurons to TANH in the same edge case", () => {
  // This test intentionally constructs an *invalid* creature state (by changing an
  // output neuron to type 'hidden') purely to exercise the non-output downgrade
  // branch for coverage. We do not call creature.validate() here.
  const creature = new Creature(2, 2);
  const target = creature.neurons.find((n) => n.uuid === "output-1");
  assert(target, "Expected output-1 neuron to exist");
  assertEquals(creature.inwardConnections(target.index).length, 2);

  (target as unknown as { type: string }).type = "hidden";
  target.squash = "IF";

  const originalMutate = target.mutate.bind(target);
  (target as unknown as { mutate: (name: string) => boolean }).mutate = () => {
    throw new Error("Unexpected mutate() during IF.fix downgrade path");
  };
  try {
    new IF().fix(target);
  } finally {
    (target as unknown as { mutate: (name: string) => boolean }).mutate =
      originalMutate;
  }

  assertEquals(target.squash, "TANH");
});
