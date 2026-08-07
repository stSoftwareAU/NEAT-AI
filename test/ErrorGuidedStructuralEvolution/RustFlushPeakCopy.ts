/**
 * Tests for the flush-threshold peak-copy accounting (Issue #3402).
 *
 * `writeRustParquetChunk` transforms the accumulator into a second, plain-object
 * FFI payload that coexists with the still-live accumulator during the FFI call,
 * so the true peak heap at flush is ~2× `rustAccumulatedEstimatedBytes`.
 * `shouldFlushRustChunk` must decide against that projected peak so it stays
 * under `rustFlushBytesThreshold` rather than overshooting it by the copy — the
 * single-generation discovery heap retainer `MemoryMonitor` cannot free (#2594).
 *
 * Every case here drives the predicate the way production does (Issue #3676):
 * the threshold is configured through `DiscoverStructureOptions`, the byte
 * accounting is produced by recording real samples through the public
 * `record()` path, and the flush itself is observed at the injected
 * `recordDiscovery` boundary.
 */

import { assert, assertEquals } from "@std/assert";
import { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverStructureDeps } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { RustRecordInput } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** Record-count ceiling high enough that only the byte rule can fire. */
const NO_RECORD_CEILING = 1_000_000;
/** Safety cap so a broken predicate fails the test instead of looping. */
const MAX_SAMPLES = 500;

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

function makeSample(index: number): DataRecordInterface {
  return {
    input: Float32Array.from([index / 100, (index + 1) / 100]),
    output: Float32Array.from([index / 100]),
  };
}

/**
 * Build a structure through the supported surface: the byte threshold and the
 * record ceiling are constructor configuration, and the FFI boundary is the
 * injected `recordDiscovery` stub whose payload sizes are captured.
 */
function buildStructure(
  bytesThreshold: number,
  flushRecords: number = NO_RECORD_CEILING,
): { structure: DiscoverStructure; flushedSampleCounts: number[] } {
  const flushedSampleCounts: number[] = [];
  const deps: Partial<DiscoverStructureDeps> = {
    isRustDiscoveryEnabled: () => true,
    isRustLibraryAvailable: () => true,
    recordDiscovery: (input: RustRecordInput) => {
      flushedSampleCounts.push(input.training_data.length);
      return {
        success: true,
        file: `chunk-${flushedSampleCounts.length}.parquet`,
      };
    },
  };
  const structure = new DiscoverStructure(
    makeTestCreature(),
    600,
    flushRecords,
    deps,
    { rustFlushBytesThreshold: bytesThreshold },
  );
  structure.initialize(new Map());
  return { structure, flushedSampleCounts };
}

/**
 * Record one real sample at a time until the predicate fires, returning how
 * many samples that took. Fails loudly rather than looping if it never fires.
 */
function recordUntilFlush(structure: DiscoverStructure): number {
  const neuronPromises = new Map<number, Promise<void>>();
  for (let sample = 1; sample <= MAX_SAMPLES; sample++) {
    structure.record([makeSample(sample)], neuronPromises);
    if (structure.shouldFlushRustChunk()) {
      return sample;
    }
  }
  throw new Error(
    `shouldFlushRustChunk() never fired within ${MAX_SAMPLES} recorded samples`,
  );
}

Deno.test("byte flush fires while the accumulator alone is still under the threshold", async () => {
  await initWasmForTests();
  const bytesThreshold = 10_000;
  const { structure } = buildStructure(bytesThreshold);

  try {
    const samples = recordUntilFlush(structure);
    const state = structure.getRustFlushByteState();

    assertEquals(state.bytesThreshold, bytesThreshold);
    assertEquals(state.accumulatedSamples, samples);
    assert(
      samples > 1,
      `threshold ${bytesThreshold} must span more than one sample for this creature, fired after ${samples}`,
    );
    // The projected flush-time peak has reached the threshold …
    assert(
      state.projectedPeakBytes >= bytesThreshold,
      `projected peak ${state.projectedPeakBytes} should have reached ${bytesThreshold}`,
    );
    // … while the accumulator on its own is still comfortably below it. This is
    // the #3402 guard: an estimate-only predicate would still be accumulating
    // here, and the flush-time copy would then push the real peak past the
    // threshold.
    assert(
      state.accumulatedEstimatedBytes < bytesThreshold,
      `accumulator ${state.accumulatedEstimatedBytes} should still be under ${bytesThreshold} when the flush fires`,
    );
  } finally {
    await structure.cleanUp();
  }
});

Deno.test("byte flush holds off while the projected peak is under the threshold", async () => {
  await initWasmForTests();
  const bytesThreshold = 1_000_000;
  const { structure } = buildStructure(bytesThreshold);

  try {
    const neuronPromises = new Map<number, Promise<void>>();
    structure.record(
      [makeSample(1), makeSample(2), makeSample(3)],
      neuronPromises,
    );

    const state = structure.getRustFlushByteState();
    assertEquals(state.accumulatedSamples, 3);
    assert(
      state.projectedPeakBytes < bytesThreshold,
      `three samples must stay under ${bytesThreshold} for this test to mean anything`,
    );
    assertEquals(structure.shouldFlushRustChunk(), false);
  } finally {
    await structure.cleanUp();
  }
});

Deno.test("record-count ceiling still forces a flush regardless of bytes", async () => {
  await initWasmForTests();
  const { structure } = buildStructure(Number.MAX_SAFE_INTEGER, 3);

  try {
    const neuronPromises = new Map<number, Promise<void>>();
    structure.record([makeSample(1), makeSample(2)], neuronPromises);
    assertEquals(structure.shouldFlushRustChunk(), false);

    structure.record([makeSample(3)], neuronPromises);
    assertEquals(structure.shouldFlushRustChunk(), true);
  } finally {
    await structure.cleanUp();
  }
});

Deno.test("flush driven by the byte predicate hands the accumulated samples to the FFI boundary", async () => {
  await initWasmForTests();
  const bytesThreshold = 10_000;
  const { structure, flushedSampleCounts } = buildStructure(bytesThreshold);

  try {
    // Mirror the production call site (DataRecorderRecording): record, then
    // flush as soon as the predicate says the projected peak has been reached.
    const samples = recordUntilFlush(structure);
    assertEquals(flushedSampleCounts, []);

    assertEquals(structure.flushRustChunk(), true);
    assertEquals(flushedSampleCounts, [samples]);

    // The accumulator is cleared, so the next chunk starts from zero bytes.
    const state = structure.getRustFlushByteState();
    assertEquals(state.accumulatedSamples, 0);
    assertEquals(state.accumulatedEstimatedBytes, 0);
    assertEquals(state.projectedPeakBytes, 0);
    assertEquals(structure.shouldFlushRustChunk(), false);

    // A second chunk flushes at the same size — the threshold bounds every
    // chunk, not just the first.
    const secondSamples = recordUntilFlush(structure);
    assertEquals(secondSamples, samples);
    assertEquals(structure.flushRustChunk(), true);
    assertEquals(flushedSampleCounts, [samples, samples]);
  } finally {
    await structure.cleanUp();
  }
});
