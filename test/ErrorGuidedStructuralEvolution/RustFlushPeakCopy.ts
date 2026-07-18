/**
 * Tests for the flush-threshold peak-copy accounting (Issue #3402).
 *
 * `writeRustParquetChunk` transforms the accumulator into a second, plain-object
 * FFI payload that coexists with the still-live accumulator during the FFI call,
 * so the true peak heap at flush is ~2× `rustAccumulatedEstimatedBytes`.
 * `shouldFlushRustChunk` must decide against that projected peak so it stays
 * under `rustFlushBytesThreshold` rather than overshooting it by the copy — the
 * single-generation discovery heap retainer `MemoryMonitor` cannot free (#2594).
 */

import { assertEquals } from "@std/assert";
import { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverStructureDeps } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { RUST_FLUSH_PEAK_COPY_MULTIPLIER } from "@architecture/ErrorGuidedStructuralEvolution/constants.ts";
import { initWasmForTests } from "../_initWasm.ts";

function makeTestCreature(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-a", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

function buildStructure(): DiscoverStructure {
  const deps: Partial<DiscoverStructureDeps> = {
    isRustDiscoveryEnabled: () => true,
    isRustLibraryAvailable: () => true,
    recordDiscovery: () => ({ success: true, file: "/tmp/ignored.parquet" }),
  };
  const structure = new DiscoverStructure(makeTestCreature(), 600, 4096, deps);
  structure.initialize(new Map());
  // Mark the Rust dual-write path active so `shouldFlushRustChunk` runs.
  (structure as unknown as { usingRustDualWrite: boolean }).usingRustDualWrite =
    true;
  return structure;
}

Deno.test("shouldFlushRustChunk: fires once projected peak (2x estimate) crosses the byte threshold", async () => {
  await initWasmForTests();
  const structure = buildStructure();
  const s = structure as unknown as {
    rustFlushBytesThreshold: number;
    rustAccumulatedEstimatedBytes: number;
    rustAccumulatedData: unknown[];
    shouldFlushRustChunk: () => boolean;
  };

  s.rustFlushBytesThreshold = 1000;
  // Two accumulated samples so the record-count path (4096) is not the trigger.
  s.rustAccumulatedData = [{}, {}];

  // Accumulator estimate below threshold but its ~2x flush-time peak is at/above
  // it: the old estimate-only check under-fired and let the real payload
  // overshoot. It must now flush.
  s.rustAccumulatedEstimatedBytes = Math.ceil(
    1000 / RUST_FLUSH_PEAK_COPY_MULTIPLIER,
  );
  assertEquals(structure.shouldFlushRustChunk(), true);
});

Deno.test("shouldFlushRustChunk: does not fire while the projected peak is under the threshold", async () => {
  await initWasmForTests();
  const structure = buildStructure();
  const s = structure as unknown as {
    rustFlushBytesThreshold: number;
    rustAccumulatedEstimatedBytes: number;
    rustAccumulatedData: unknown[];
    shouldFlushRustChunk: () => boolean;
  };

  s.rustFlushBytesThreshold = 1000;
  s.rustAccumulatedData = [{}, {}];
  // Projected peak = 2 * 400 = 800 < 1000 — no flush.
  s.rustAccumulatedEstimatedBytes = 400;
  assertEquals(structure.shouldFlushRustChunk(), false);
});

Deno.test("shouldFlushRustChunk: record-count ceiling still forces a flush", async () => {
  await initWasmForTests();
  const structure = buildStructure();
  const s = structure as unknown as {
    rustFlushRecords: number;
    rustFlushBytesThreshold: number;
    rustAccumulatedEstimatedBytes: number;
    rustAccumulatedData: unknown[];
    shouldFlushRustChunk: () => boolean;
  };

  s.rustFlushRecords = 3;
  s.rustFlushBytesThreshold = Number.MAX_SAFE_INTEGER;
  s.rustAccumulatedEstimatedBytes = 0;
  s.rustAccumulatedData = [{}, {}, {}];
  assertEquals(structure.shouldFlushRustChunk(), true);
});
