/**
 * Tests for releasing record-phase JS retainers ahead of the
 * analysis-extension heap check (Issue #3026).
 *
 * Suspected root cause #3 of #3022: by the time control reaches the
 * record→analysis boundary in `DataRecorder`, the recording phase has left
 * its per-file sampled-index map and sample accumulators alive on the small
 * default worker V8 heap. The heap guard then samples a heap that is
 * artificially near the 85% CRITICAL threshold — not because analysis needs
 * the memory, but because record-phase retainers were never released.
 *
 * `DiscoverStructure.releaseRecordingRetainers()` drops those in-memory
 * copies (the parquet output and `selected_indices.json` on disk remain the
 * source of truth the analysis phase reads). These tests assert:
 *
 * 1. The release empties the record-phase retainers while preserving the
 *    state the analysis phase still consumes (`recordedNeuronTotalAbsError`,
 *    `parquetFilePath`) — no use-after-free.
 * 2. Modelling the boundary heap sample as `floor + retained-bytes`, the
 *    release measurably lowers `heapUsed` so the sample drops from CRITICAL
 *    to below the threshold, independent of the guard's abort decision.
 */
import { assert, assertEquals } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverStructureDeps } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import {
  _setHeapGuardProviderForTests,
  checkAnalysisHeapAbort,
  sampleHeapPressure,
} from "@architecture/ErrorGuidedStructuralEvolution/AnalysisHeapGuard.ts";
import { DEFAULT_MEMORY_CONFIG } from "@config/MemoryConfig.ts";
import type { Logger } from "@utils/Logger.ts";
import type { MemoryUsageSample } from "@neat/MemoryMonitor.ts";
import { initWasmForTests } from "../_initWasm.ts";

const MB = 1024 * 1024;
/** Bytes modelled per retained sampled-index (a packed JS number). */
const BYTES_PER_INDEX = 8;

function makeTestCreature(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-a", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "hidden-b", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: -0.5 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: -0.25 },
    ],
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

function makeTrainingData(count: number): DataRecordInterface[] {
  const samples: DataRecordInterface[] = [];
  for (let i = 0; i < count; i++) {
    samples.push({
      input: Float32Array.from([i / count, (i + 1) / count]),
      output: Float32Array.from([i / count]),
    });
  }
  return samples;
}

/**
 * Build a recorded `DiscoverStructure` wired to deterministic in-memory stubs,
 * mirroring the record→analysis state at the extension boundary.
 */
async function buildRecordedStructure(): Promise<
  { structure: DiscoverStructure; tempParquetPath: string }
> {
  await initWasmForTests();

  const creature = makeTestCreature();
  const tempParquetPath = await Deno.makeTempFile({
    prefix: "release-recording-retainers-",
    suffix: ".parquet",
  });

  const deps: Partial<DiscoverStructureDeps> = {
    isRustDiscoveryEnabled: () => true,
    isRustLibraryAvailable: () => true,
    recordDiscovery: () => ({ success: true, file: tempParquetPath }),
    mergeDiscoveryParquet: () => ({
      success: true,
      outputFile: tempParquetPath,
    }),
    analyzeParallel: () => ({ success: true }),
    readDiscoveryRecords: () => ({ success: true, records: [] }),
  };

  const structure = new DiscoverStructure(creature, 600, 100, deps);
  const neuronPromises = new Map<number, Promise<void>>();
  structure.initialize(neuronPromises);

  // Record a sampled batch against a named binary file so the per-file index
  // map is populated, exactly as a real recording phase leaves it.
  const sampleCount = 20;
  const recordIndices = Array.from({ length: sampleCount }, (_, i) => i);
  structure.record(
    makeTrainingData(sampleCount),
    neuronPromises,
    "/data/training-data.bin",
    recordIndices,
  );
  structure.flushRustRecording();

  return { structure, tempParquetPath };
}

/** Test-side model: bytes retained by the in-memory record-phase state. */
function modelRetainedBytes(structure: DiscoverStructure): number {
  const selectedIndices = structure["selectedIndices"] as Record<
    string,
    number[]
  >;
  let entries = 0;
  for (const key of Object.keys(selectedIndices)) {
    entries += selectedIndices[key]?.length ?? 0;
  }
  return entries * BYTES_PER_INDEX;
}

Deno.test("releaseRecordingRetainers empties record-phase state but preserves analysis state", async () => {
  const { structure, tempParquetPath } = await buildRecordedStructure();

  try {
    // Before release: the per-file index map and the analysis-needed error
    // totals are both populated.
    const selectedBefore = structure["selectedIndices"] as Record<
      string,
      number[]
    >;
    assert(
      Object.keys(selectedBefore).length > 0,
      "selectedIndices should be populated after recording",
    );
    const errorTotals = structure["recordedNeuronTotalAbsError"] as Map<
      number,
      number
    >;
    assert(
      errorTotals.size > 0,
      "recordedNeuronTotalAbsError should be populated after recording",
    );
    const parquetBefore = structure["parquetFilePath"];
    assert(parquetBefore, "parquetFilePath should be set after flush");

    const report = structure.releaseRecordingRetainers();

    // Released record-phase retainers.
    assert(
      report.releasedIndexEntries > 0,
      "should report released index entries",
    );
    assertEquals(
      Object.keys(structure["selectedIndices"] as Record<string, number[]>)
        .length,
      0,
      "selectedIndices must be empty after release",
    );
    assertEquals(
      (structure["rustAccumulatedData"] as unknown[]).length,
      0,
      "rustAccumulatedData must be empty after release",
    );
    assertEquals(
      (structure["rustAccumulatedNeuronData"] as unknown[]).length,
      0,
      "rustAccumulatedNeuronData must be empty after release",
    );
    assertEquals(
      (structure["rustBinaryFilePaths"] as Set<string>).size,
      0,
      "rustBinaryFilePaths must be empty after release",
    );
    assertEquals(structure["rustAccumulatedEstimatedBytes"], 0);

    // Preserved analysis state — no use-after-free in the analysis loop.
    assertEquals(
      (structure["recordedNeuronTotalAbsError"] as Map<number, number>).size,
      errorTotals.size,
      "recordedNeuronTotalAbsError must survive the release",
    );
    assertEquals(
      structure["parquetFilePath"],
      parquetBefore,
      "parquetFilePath must survive the release",
    );

    // Idempotent: a second release is a safe no-op.
    const second = structure.releaseRecordingRetainers();
    assertEquals(second.releasedIndexEntries, 0);
  } finally {
    await structure.cleanUp();
    try {
      await Deno.remove(tempParquetPath);
    } catch {
      // Ignore cleanup failures
    }
  }
});

Deno.test("releaseRecordingRetainers lowers the boundary heap sample below CRITICAL", async () => {
  const { structure, tempParquetPath } = await buildRecordedStructure();

  try {
    // Model a representative-scale recording workload: a heavy discovery run
    // leaves millions of sampled indices alive on the small default worker
    // heap. (Length-only model, mirroring DiscoveryWorkerHeapLimit's injected
    // byte counts — no large real allocation.)
    const REPRESENTATIVE_ENTRIES = 4_000_000; // 4M * 8B = 32 MB modelled
    (structure["selectedIndices"] as Record<string, number[]>)[
      "/data/training-data.bin"
    ] = new Array(REPRESENTATIVE_ENTRIES);

    // Worker heap (default ~269 MB) with a floor that, combined with the
    // retained index bytes, sits above the 85% CRITICAL threshold but drops
    // below it once the retainers are released.
    const WORKER_HEAP_TOTAL = Math.round(269 * MB);
    const HEAP_FLOOR = Math.round(210 * MB);
    _setHeapGuardProviderForTests((): MemoryUsageSample => ({
      heapUsed: HEAP_FLOOR + modelRetainedBytes(structure),
      heapTotal: WORKER_HEAP_TOTAL,
    }));

    // Before release: the record-phase retainers push the sample to CRITICAL.
    const before = sampleHeapPressure(DEFAULT_MEMORY_CONFIG);
    assert(
      before.usageFraction >= DEFAULT_MEMORY_CONFIG.criticalThreshold,
      `expected CRITICAL before release, got fraction ${before.usageFraction}`,
    );
    assertEquals(before.pressureLevel, "critical");

    const { logger } = makeLogger();
    const abortBefore = checkAnalysisHeapAbort(
      "release-3026",
      DEFAULT_MEMORY_CONFIG,
      logger,
    );
    assertEquals(abortBefore.abort, true);

    // Release the record-phase retainers.
    const report = structure.releaseRecordingRetainers();
    assertEquals(report.releasedIndexEntries, REPRESENTATIVE_ENTRIES);

    // After release: heapUsed measurably lower and below the threshold.
    const after = sampleHeapPressure(DEFAULT_MEMORY_CONFIG);
    assert(
      after.heapUsed < before.heapUsed,
      `cleanup must lower heapUsed (before ${before.heapUsed}, after ${after.heapUsed})`,
    );
    assert(
      after.usageFraction < DEFAULT_MEMORY_CONFIG.criticalThreshold,
      `expected below CRITICAL after release, got fraction ${after.usageFraction}`,
    );
    assert(
      after.pressureLevel !== "critical",
      `expected non-CRITICAL pressure after release, got ${after.pressureLevel}`,
    );

    const abortAfter = checkAnalysisHeapAbort(
      "release-3026",
      DEFAULT_MEMORY_CONFIG,
      logger,
    );
    assertEquals(abortAfter.abort, false);
  } finally {
    _setHeapGuardProviderForTests(undefined);
    await structure.cleanUp();
    try {
      await Deno.remove(tempParquetPath);
    } catch {
      // Ignore cleanup failures
    }
  }
});

function makeLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (...args) => lines.push(args.join(" ")),
    info: (...args) => lines.push(args.join(" ")),
    warn: (...args) => lines.push(args.join(" ")),
    error: (...args) => lines.push(args.join(" ")),
  };
  return { logger, lines };
}
