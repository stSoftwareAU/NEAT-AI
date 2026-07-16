/**
 * Regression tests for Issue #3383.
 *
 * The seeded `XOR-evolve` test intermittently failed in CI because a compacted
 * creature returned by the evolution worker carried a `constant` neuron with no
 * outward connections. The invariant violation was silent at serialisation
 * (`exportJSON` does not validate on the hot path) and only surfaced
 * non-deterministically when `processCompletedResults` deserialised the result
 * with validation enabled, throwing:
 *
 *   ValidationError: constants neuron legacy-neuron-826800409
 *     has no outward connections  (NO_OUTWARD_CONNECTIONS)
 *
 * The primary `compactUnused` path already validated+repaired its output, but
 * the `compactVariants` fallback did not. `validateAndRepairCompact` closes that
 * gap: it validates the compact creature at the producer and repairs (or fails
 * loudly on) any stranded constant before the worker serialises the result.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { validateAndRepairCompact } from "@architecture/training/TrainingTeardown.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../../_rngTestLock.ts";
import { initWasmForTests } from "../../_initWasm.ts";

/**
 * Run `fn` under a fresh seeded RNG, restoring the ambient generator afterwards.
 * `fix()` (invoked by the repair path) consumes the global RNG when it rewires
 * neurons, so isolate that state to keep RNG-sensitive sibling tests
 * deterministic regardless of file ordering.
 */
function withIsolatedRng(fn: () => void): Promise<void> {
  return withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      setRandomNumberGenerator(createSeededRng(3383));
      fn();
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
}

/**
 * Build a forward-only creature carrying an orphaned `constant` neuron — an
 * integer id but no uuid, mirroring the `legacy-neuron-` case from the CI
 * failure — alongside an otherwise valid input→hidden→output path.
 */
function buildCreatureWithOrphanedConstant(): Creature {
  const json: CreatureExport = {
    semanticVersion: "5.0.0",
    forwardOnly: true,
    input: 2,
    output: 1,
    neurons: [
      // Orphaned: no outward synapse, no uuid → labelled legacy-neuron-<id>.
      { type: "constant", id: 826800409, bias: 1 },
      { type: "hidden", uuid: "H", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "H", weight: 0.5 },
      { fromUUID: "H", toUUID: "output-0", weight: 0.9 },
    ],
  };
  // validate:false + throwOnRecurrent:"never" so the intentionally-invalid
  // intermediate state loads without being rejected up front.
  return Creature.fromJSON(json, false, "test:orphaned-constant", {
    throwOnRecurrent: "never",
  });
}

Deno.test("Issue #3383 - orphaned constant reproduces the CI validation failure", async () => {
  await initWasmForTests();
  await withIsolatedRng(() => {
    const creature = buildCreatureWithOrphanedConstant();

    const error = assertThrows(
      () => creatureValidate(creature, { forwardOnly: true }),
      ValidationError,
      "has no outward connections",
    );
    assertEquals((error as ValidationError).reason, "NO_OUTWARD_CONNECTIONS");
  });
});

Deno.test("Issue #3383 - validateAndRepairCompact prunes the orphaned constant", async () => {
  await initWasmForTests();
  await withIsolatedRng(() => {
    const creature = buildCreatureWithOrphanedConstant();

    const repaired = validateAndRepairCompact(creature);

    // Same reference is returned, now valid.
    assertEquals(repaired, creature);
    creatureValidate(creature, { forwardOnly: true });

    // The stranded constant was removed; the valid path is preserved.
    assert(
      !creature.neurons.some((n) => n.type === "constant"),
      "orphaned constant should have been pruned",
    );

    // The repaired creature round-trips through the same debug-validated load
    // that `processCompletedResults` performs, without throwing.
    const roundTripped = Creature.fromJSON(creature.exportJSON(), true);
    creatureValidate(roundTripped, { forwardOnly: true });
  });
});

Deno.test("Issue #3383 - validateAndRepairCompact leaves a valid creature unchanged", async () => {
  await initWasmForTests();
  await withIsolatedRng(() => {
    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    const before = creature.exportJSON();

    const repaired = validateAndRepairCompact(creature);

    assertEquals(repaired, creature);
    assertEquals(creature.exportJSON(), before);
  });
});

Deno.test("Issue #3383 - validateAndRepairCompact passes through undefined", () => {
  assertEquals(validateAndRepairCompact(undefined), undefined);
});
