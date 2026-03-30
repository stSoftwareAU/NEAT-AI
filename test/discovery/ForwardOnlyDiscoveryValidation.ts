import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";

/**
 * Regression coverage: discovery must respect forward-only invariants.
 *
 * If a forward-only creature has accidental recurrent connections, discovery
 * repairs them by stripping the offending synapses.
 */
Deno.test("Discovery: forward-only repairs recurrent connections", () => {
  const original = new Creature(2, 1, { layers: [{ count: 2 }] });
  assertEquals(original.forwardOnly, true);
  original.validate({ forwardOnly: true });

  const modified = Creature.fromJSON(original.exportJSON());
  const hiddenIndex = modified.input;
  // Inject a recurrent self-loop. `connect()` guards against this on
  // forward-only creatures, so temporarily clear the flag.
  modified.forwardOnly = undefined;
  modified.connect(hiddenIndex, hiddenIndex, 0.5);
  modified.forwardOnly = true;

  const result = (DiscoverStructure as unknown as {
    validateAndFixIfNeeded: (
      creature: Creature,
      originalCreature: Creature,
      discoveryID: string,
      operationType: string,
      candidate: unknown,
      discoveryFailureCacheDir?: string,
    ) => { success: boolean; fixWasCalled: boolean };
  }).validateAndFixIfNeeded(modified, original, "test", "unit", {});

  assertEquals(result.success, true);
  assertEquals(result.fixWasCalled, true);
  modified.validate({ forwardOnly: true });
});
