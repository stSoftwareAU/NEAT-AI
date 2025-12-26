import { assert, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { AddConnection } from "../../src/mutate/AddConnection.ts";

// cspell:ignore TESTDISC

Deno.test(
  "AddConnection: pre-4.x forwardOnly repairs self/back connections instead of throwing",
  () => {
    const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
    creature.forwardOnly = true;
    creature.semanticVersion = "2.0.0";

    const hiddenIndex = creature.input;
    assert(hiddenIndex < creature.neurons.length - creature.output);

    // Inject a self connection (invalid for forward-only, but tolerated pre-4.x via repair).
    creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.123));
    creature.synapses.sort((
      a,
      b,
    ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

    const mutator = new AddConnection(creature);
    mutator.mutate();

    // Should be valid forward-only after repair.
    creature.validate({ forwardOnly: true });
    assert(
      creature.semanticVersion.startsWith("4."),
      "Expected upgrade to 4.x after validation",
    );
  },
);

Deno.test(
  "AddConnection: 4.x forwardOnly throws if creature is already corrupted",
  () => {
    const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
    creature.forwardOnly = true;
    creature.semanticVersion = "4.0.0";

    const hiddenIndex = creature.input;
    creature.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.123));
    creature.synapses.sort((
      a,
      b,
    ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

    const mutator = new AddConnection(creature);
    assertThrows(
      () => mutator.mutate(),
      Error,
      "CRITICAL",
    );
  },
);
