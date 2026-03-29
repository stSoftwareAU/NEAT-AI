import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { ValidationError } from "../../src/errors/ValidationError.ts";
import { upgrade } from "../../src/upgrade/Upgrade.ts";

/**
 * Issue #2086 follow-up: corrupt 4.x forward-only genomes must fail `upgrade()`
 * (no silent `fix()` — repair destroys fitness).
 */
Deno.test("upgrade(): throws on corrupted 4.x forward-only creature with back connection", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;

  const hiddenIndex = creature.input;
  const outputIndex = creature.neurons.length - 1;
  assert(outputIndex > hiddenIndex);

  creature.synapses.push(new Synapse(outputIndex, hiddenIndex, 0.123));
  creature.synapses.sort((
    a,
    b,
  ) => (a.from === b.from ? a.to - b.to : a.from - b.from));

  const err = assertThrows(
    () => upgrade(creature),
    ValidationError,
  ) as ValidationError;
  assertEquals(err.reason, "RECURSIVE_SYNAPSE");
});
