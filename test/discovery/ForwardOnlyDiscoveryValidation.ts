import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";

/**
 * Regression coverage: discovery must respect forward-only invariants.
 *
 * - If a forward-only creature is still on a legacy semantic version, discovery repairs
 *   accidental recurrent connections by stripping them and emits a 4.x creature.
 * - If a forward-only creature is already 4.x, discovery still strips recurrent connections
 *   (new creature) and keeps it at 4.x.
 */
Deno.test("Discovery: forward-only legacy can be repaired by stripping recurrent connections", () => {
  const original = new Creature(2, 1, { layers: [{ count: 2 }] });
  original.forwardOnly = true;
  original.semanticVersion = "3.0.0";
  original.validate({ forwardOnly: true });

  const modified = Creature.fromJSON(original.exportJSON());
  const hiddenIndex = modified.input;
  // Inject a recurrent self-loop. `connect()` now guards against creating
  // recurrent links on forward-only creatures, so temporarily clear the flag to
  // simulate a corrupted persisted export.
  modified.forwardOnly = undefined;
  modified.connect(hiddenIndex, hiddenIndex, 0.5); // self-loop (recurrent)
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
  assertEquals(modified.semanticVersion, "4.0.0");
});

Deno.test("Discovery: forward-only 4.x repairs by stripping recurrent connections (new creature)", () => {
  const original = new Creature(2, 1, { layers: [{ count: 2 }] });
  original.forwardOnly = true;
  original.semanticVersion = "4.0.0";
  original.validate({ forwardOnly: true });

  const modified = Creature.fromJSON(original.exportJSON());
  const hiddenIndex = modified.input;
  // Inject a recurrent self-loop. `connect()` now guards against creating
  // recurrent links on forward-only creatures, so temporarily clear the flag to
  // simulate a corrupted persisted export.
  modified.forwardOnly = undefined;
  modified.connect(hiddenIndex, hiddenIndex, 0.5); // self-loop (recurrent)
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
  assertEquals(modified.semanticVersion, "4.0.0");
});
