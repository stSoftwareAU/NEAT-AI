/**
 * Issue #3714: `importCheckpoint()` is a public deserialisation boundary — the
 * checkpoint it is handed comes off disk or the network. It used the raw
 * `checkpoint.creature.input` / `.output` counts as loop bounds (via
 * `normaliseCreatureExport` and the output back-fill in `remapCreatureForTask`)
 * before `Creature.fromJSON` could apply `assertValidCreatureShape`, so a
 * hostile count burnt seconds of CPU and exhausted memory instead of raising a
 * `ValidationError`.
 *
 * These tests pin the boundary check that now runs first, and the presence
 * checks on the untrusted `metadata` id arrays.
 *
 * Note: without the fix the hostile cases throw `RangeError` (map/set maximum
 * size exceeded) after seconds of allocation rather than failing fast.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { exportCheckpoint, importCheckpoint } from "@transfer/Checkpoint.ts";
import { MAX_NEURON_COUNT } from "@creature/CreatureShapeValidation.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import type { CheckpointInterface } from "@transfer/CheckpointInterface.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** A checkpoint carrying an arbitrary (possibly hostile) input/output shape. */
function shapedCheckpoint(
  input: unknown,
  output: unknown,
): CheckpointInterface {
  return {
    version: "1.0.0",
    creature: {
      input,
      output,
      neurons: [
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      // A synapse without `fromId` defeats the `isResolvedIds` early return,
      // so `normaliseCreatureExport` runs its `json.input` pre-fill loop.
      synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 0.1 }],
    },
    metadata: {},
  } as unknown as CheckpointInterface;
}

/**
 * Counts that must be rejected wherever they appear. `undefined` is only
 * hostile on the checkpoint itself — on the options it means "not supplied"
 * and legitimately falls back to the source creature's count.
 */
const HOSTILE_COUNTS: [string, unknown][] = [
  ["negative", -1],
  ["zero", 0],
  ["fractional", 1.5],
  ["numeric string", "2"],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["above the ceiling", MAX_NEURON_COUNT + 1],
  ["fifty million", 50_000_000],
];

Deno.test("importCheckpoint - rejects a missing input count", () => {
  const error = assertThrows(
    () => importCheckpoint(shapedCheckpoint(undefined, 1)),
    ValidationError,
  );
  assert(error.message.includes("input"), error.message);
});

Deno.test("importCheckpoint - rejects a missing output count", () => {
  const error = assertThrows(
    () => importCheckpoint(shapedCheckpoint(2, undefined)),
    ValidationError,
  );
  assert(error.message.includes("output"), error.message);
});

for (const [label, value] of HOSTILE_COUNTS) {
  Deno.test(`importCheckpoint - rejects ${label} input before allocating`, () => {
    const error = assertThrows(
      () => importCheckpoint(shapedCheckpoint(value, 1)),
      ValidationError,
    );
    assert(
      error.message.includes("input"),
      `message should name the offending field: ${error.message}`,
    );
  });

  Deno.test(`importCheckpoint - rejects ${label} output on the remap path`, () => {
    const error = assertThrows(
      () =>
        importCheckpoint(shapedCheckpoint(2, value), {
          outputIdMapping: new Map(),
        }),
      ValidationError,
    );
    assert(
      error.message.includes("output"),
      `message should name the offending field: ${error.message}`,
    );
  });

  Deno.test(`importCheckpoint - rejects ${label} targetInputCount`, () => {
    const error = assertThrows(
      () =>
        importCheckpoint(shapedCheckpoint(2, 1), {
          targetInputCount: value as number,
        }),
      ValidationError,
    );
    assert(
      error.message.includes("input"),
      `message should name the offending field: ${error.message}`,
    );
  });

  Deno.test(`importCheckpoint - rejects ${label} targetOutputCount`, () => {
    const error = assertThrows(
      () =>
        importCheckpoint(shapedCheckpoint(2, 1), {
          targetOutputCount: value as number,
        }),
      ValidationError,
    );
    assert(
      error.message.includes("output"),
      `message should name the offending field: ${error.message}`,
    );
  });
}

Deno.test("importCheckpoint - metadata without id arrays does not throw TypeError", async () => {
  await initWasmForTests();
  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  const checkpoint = exportCheckpoint(creature);

  // A checkpoint produced elsewhere may omit these optional-in-practice fields.
  delete (checkpoint.metadata as { sourceInputIds?: number[] }).sourceInputIds;
  delete (checkpoint.metadata as { sourceOutputIds?: number[] })
    .sourceOutputIds;

  const imported = importCheckpoint(checkpoint, { targetOutputCount: 3 });

  assertEquals(imported.input, 3);
  assertEquals(imported.output, 3);
});

Deno.test("importCheckpoint - a valid checkpoint still round-trips", async () => {
  await initWasmForTests();
  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  const checkpoint = exportCheckpoint(creature);

  const imported = importCheckpoint(checkpoint);

  assertEquals(imported.input, 3);
  assertEquals(imported.output, 2);
  assertEquals(imported.neurons.length, creature.neurons.length);
});
