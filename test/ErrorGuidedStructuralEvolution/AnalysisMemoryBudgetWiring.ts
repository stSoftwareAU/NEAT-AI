/**
 * Tests that the configured analysis memory budget reaches the Rust
 * `analyze_parallel` payload (Issue #3432).
 *
 * The FFI is mocked, so no GPU and no built NEAT-AI-Discovery library are
 * required. The assertions are on the payload NEAT-AI actually hands to Rust —
 * the observable outcome — not on how it was assembled.
 */
import { assert, assertEquals } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { ensureRustCombinedAnalysis } from "@architecture/ErrorGuidedStructuralEvolution/RustAnalysisCache.ts";
import {
  DiscoverStructure,
  type DiscoverStructureDeps,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type {
  RustParallelAnalysisInput,
  RustParallelAnalysisResult,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
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
      { fromUUID: "input-1", toUUID: "hidden-a", weight: -0.5 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.25 },
    ],
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

function outputRuntimeId(creature: Creature): number {
  const output = creature.neurons.find((n) => n.type === "output");
  assert(output, "test creature must have an output neuron");
  return output.id;
}

/** Captures the payload handed to Rust and returns a minimal success result. */
function makeCapturingDeps(
  captured: RustParallelAnalysisInput[],
): DiscoverStructureDeps {
  return {
    isRustDiscoveryEnabled: () => true,
    isRustLibraryAvailable: () => true,
    recordDiscovery: () => ({ success: true, file: "chunk.parquet" }),
    mergeDiscoveryParquet: () => ({
      success: true,
      outputFile: "merged.parquet",
    }),
    analyzeParallel: (input: RustParallelAnalysisInput) => {
      captured.push(input);
      const result: RustParallelAnalysisResult = {
        success: true,
        helpfulSynapses: [],
        synapseDiagnostics: [],
      };
      return result;
    },
    readDiscoveryRecords: () => ({ success: true, records: [] }),
  };
}

function runAnalysis(
  creature: Creature,
  captured: RustParallelAnalysisInput[],
  maxAnalysisMemoryMb: number | undefined,
) {
  return ensureRustCombinedAnalysis(
    creature,
    "/tmp/discovery-test.parquet",
    makeCapturingDeps(captured),
    undefined, // no cache
    undefined, // no analysis deadline
    [outputRuntimeId(creature)],
    true, // includeSynapse
    false, // includeNeuron
    () => {},
    undefined, // no chunk deadline
    undefined, // no task descriptor
    maxAnalysisMemoryMb,
  );
}

Deno.test("analysis request carries the configured memory budget (Issue #3432)", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const captured: RustParallelAnalysisInput[] = [];

  runAnalysis(creature, captured, 2048);

  assertEquals(captured.length, 1, "expected one analyze_parallel call");
  assertEquals(captured[0].maxAnalysisMemoryMb, 2048);
});

Deno.test("analysis request floors a fractional memory budget (Issue #3432)", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const captured: RustParallelAnalysisInput[] = [];

  runAnalysis(creature, captured, 1536.75);

  assertEquals(captured[0].maxAnalysisMemoryMb, 1536);
});

Deno.test("analysis request omits the budget field when unconfigured (Issue #3432)", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const captured: RustParallelAnalysisInput[] = [];

  runAnalysis(creature, captured, undefined);

  // Discovery reads an ABSENT field as "no budget"; a literal 0 would starve
  // the analysis immediately, so the key must not be present at all.
  assertEquals(captured.length, 1);
  assertEquals(
    Object.hasOwn(captured[0], "maxAnalysisMemoryMb"),
    false,
    "unconfigured budget must not appear on the wire",
  );
});

Deno.test("analysis request omits a zero memory budget (Issue #3432)", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const captured: RustParallelAnalysisInput[] = [];

  runAnalysis(creature, captured, 0);

  assertEquals(Object.hasOwn(captured[0], "maxAnalysisMemoryMb"), false);
});

Deno.test("DiscoverStructure forwards its configured budget to Rust (Issue #3432)", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const captured: RustParallelAnalysisInput[] = [];
  const baseDirectory = await Deno.makeTempDir({ prefix: "neat-3432-" });

  try {
    const discoverStructure = new DiscoverStructure(
      creature,
      60,
      1000,
      makeCapturingDeps(captured),
      {
        baseDirectory,
        skipRecordPhase: true,
        disableCleanup: true,
        maxAnalysisMemoryMb: 3000,
      },
    );

    // Stand in for a completed record phase so the analysis path has a parquet
    // file to point at.
    await Deno.writeTextFile(
      `${discoverStructure.getTempDir()}/discovery_data.parquet`,
      "parquet-stub",
    );
    assert(
      discoverStructure.shouldSkipRecording(),
      "stubbed parquet should let the record phase be skipped",
    );

    discoverStructure.ensureRustCombinedAnalysis(
      [outputRuntimeId(creature)],
      true,
      false,
    );

    assertEquals(captured.length, 1);
    assertEquals(captured[0].maxAnalysisMemoryMb, 3000);
  } finally {
    await Deno.remove(baseDirectory, { recursive: true });
  }
});

Deno.test("memory.maxAnalysisMemoryMb defaults to disabled and is configurable (Issue #3432)", () => {
  const defaults = createNeatConfig({});
  assertEquals(defaults.memory.maxAnalysisMemoryMb, 0);

  const configured = createNeatConfig({
    memory: { maxAnalysisMemoryMb: 4096 },
  });
  assertEquals(configured.memory.maxAnalysisMemoryMb, 4096);
});
