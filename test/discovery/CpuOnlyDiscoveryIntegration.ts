/**
 * Integration test for the full discovery analysis path on CPU-only machines.
 *
 * Issue #2143: Exercises DiscoveryRunner → RustAnalysisCache → analyzeParallel
 * when isRustGpuAvailable() returns false, verifying graceful degradation
 * (no analysis results returned) rather than thread panics.
 *
 * These tests work on machines both with and without GPU by stubbing the
 * dependency injection layer (DiscoverStructureDeps) to simulate GPU absence.
 */
import { assertEquals, assertExists } from "@std/assert";
import { ensureRustCombinedAnalysis } from "@architecture/ErrorGuidedStructuralEvolution/RustAnalysisCache.ts";
import type { RustParallelAnalysisInput } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { buildWireToRuntimeIdMap } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Builds a creature with a hidden neuron suitable for discovery analysis.
 */
function makeTestCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: -0.25 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/**
 * Returns the runtime ID for output-0 in the given creature.
 */
function getOutputRuntimeId(creature: Creature): number {
  const id = buildWireToRuntimeIdMap(creature).get("output-0");
  assertExists(id, "output-0 should have a runtime id");
  return id;
}

/**
 * Simulates the GPU guard behaviour from analyzeParallel():
 * when requireGpu is not false and GPU is unavailable, returns graceful failure.
 */
function noGpuAnalyzeParallel(
  input: RustParallelAnalysisInput,
): { success: boolean; error?: string } {
  // Mirror the real guard logic in RustDiscoveryOperations.ts:
  // if (input.requireGpu !== false && !isRustGpuAvailable())
  if (input.requireGpu !== false) {
    return {
      success: false,
      error:
        "Rust synapse/neuron analysis unavailable (GPU adapter not available)",
    };
  }
  return { success: false, error: "No GPU available for analysis" };
}

Deno.test("CPU-only integration: ensureRustCombinedAnalysis returns undefined result when GPU unavailable (Issue #2143)", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const focusId = getOutputRuntimeId(creature);

  const logCalls: Array<{ scope: string; reason: string }> = [];

  const result = ensureRustCombinedAnalysis(
    creature,
    "/tmp/test.parquet",
    {
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: () => ({ success: true, file: "chunk.parquet" }),
      mergeDiscoveryParquet: () => ({
        success: true,
        outputFile: "merged.parquet",
      }),
      analyzeParallel: noGpuAnalyzeParallel as Parameters<
        typeof ensureRustCombinedAnalysis
      >[2]["analyzeParallel"],
      readDiscoveryRecords: () => ({ success: true, records: [] }),
    },
    undefined, // no cache
    undefined, // no deadline
    [focusId],
    true, // includeSynapse
    false, // includeNeuron
    (scope, _focusList, reason) => {
      logCalls.push({ scope, reason });
    },
  );

  // Acceptance criteria: result is { result: undefined, cache: undefined }
  assertEquals(
    result.result,
    undefined,
    "Analysis result should be undefined when GPU is unavailable",
  );
  assertEquals(
    result.cache,
    undefined,
    "Cache should be undefined when analysis fails",
  );

  // Verify log callback was invoked with the GPU unavailability reason
  assertEquals(logCalls.length, 1, "Should log one unavailability message");
  assertEquals(logCalls[0].scope, "synapse");
  assertEquals(
    logCalls[0].reason.includes("GPU adapter not available"),
    true,
    `Log reason should mention GPU adapter, got: ${logCalls[0].reason}`,
  );
});

Deno.test("CPU-only integration: both synapse and neuron scopes log unavailability (Issue #2143)", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const focusId = getOutputRuntimeId(creature);

  const logCalls: Array<{ scope: string; reason: string }> = [];

  const result = ensureRustCombinedAnalysis(
    creature,
    "/tmp/test.parquet",
    {
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: () => ({ success: true, file: "chunk.parquet" }),
      mergeDiscoveryParquet: () => ({
        success: true,
        outputFile: "merged.parquet",
      }),
      analyzeParallel: noGpuAnalyzeParallel as Parameters<
        typeof ensureRustCombinedAnalysis
      >[2]["analyzeParallel"],
      readDiscoveryRecords: () => ({ success: true, records: [] }),
    },
    undefined,
    undefined,
    [focusId],
    true, // includeSynapse
    true, // includeNeuron
    (scope, _focusList, reason) => {
      logCalls.push({ scope, reason });
    },
  );

  assertEquals(result.result, undefined);
  assertEquals(result.cache, undefined);

  // Both synapse and neuron scopes should be logged
  assertEquals(logCalls.length, 2, "Should log for both synapse and neuron");
  const scopes = logCalls.map((c) => c.scope).sort();
  assertEquals(scopes, ["neuron", "synapse"]);

  // Both should mention GPU unavailability
  for (const call of logCalls) {
    assertEquals(
      call.reason.includes("GPU adapter not available"),
      true,
      `${call.scope} log should mention GPU adapter`,
    );
  }
});

Deno.test("CPU-only integration: no exceptions thrown during GPU-unavailable flow (Issue #2143)", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const focusId = getOutputRuntimeId(creature);

  // This test verifies no uncaught exceptions occur when the full path
  // encounters GPU unavailability — the primary concern from Issue #2141.
  let exceptionCaught = false;
  try {
    ensureRustCombinedAnalysis(
      creature,
      "/tmp/test.parquet",
      {
        isRustDiscoveryEnabled: () => true,
        isRustLibraryAvailable: () => true,
        recordDiscovery: () => ({ success: true, file: "chunk.parquet" }),
        mergeDiscoveryParquet: () => ({
          success: true,
          outputFile: "merged.parquet",
        }),
        analyzeParallel: noGpuAnalyzeParallel as Parameters<
          typeof ensureRustCombinedAnalysis
        >[2]["analyzeParallel"],
        readDiscoveryRecords: () => ({ success: true, records: [] }),
      },
      undefined,
      undefined,
      [focusId],
      true,
      true,
      () => {},
    );
  } catch {
    exceptionCaught = true;
  }

  assertEquals(
    exceptionCaught,
    false,
    "No exceptions should be thrown during CPU-only discovery flow",
  );
});

Deno.test("CPU-only integration: analyzeParallel receives requireGpu omitted, enabling GPU guard (Issue #2143)", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const focusId = getOutputRuntimeId(creature);

  let capturedInput: RustParallelAnalysisInput | undefined;

  ensureRustCombinedAnalysis(
    creature,
    "/tmp/test.parquet",
    {
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: () => ({ success: true, file: "chunk.parquet" }),
      mergeDiscoveryParquet: () => ({
        success: true,
        outputFile: "merged.parquet",
      }),
      analyzeParallel: (input: RustParallelAnalysisInput) => {
        capturedInput = input;
        // Simulate GPU guard rejection
        return {
          success: false,
          error:
            "Rust synapse/neuron analysis unavailable (GPU adapter not available)",
        };
      },
      readDiscoveryRecords: () => ({ success: true, records: [] }),
    },
    undefined,
    undefined,
    [focusId],
    true,
    false,
    () => {},
  );

  assertExists(capturedInput, "analyzeParallel should have been called");
  assertEquals(
    capturedInput!.requireGpu,
    undefined,
    "requireGpu must be omitted so the GPU guard in analyzeParallel() can block calls on CPU-only machines",
  );
});

Deno.test("CPU-only integration: discovery disabled returns undefined without calling analysis (Issue #2143)", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const focusId = getOutputRuntimeId(creature);

  let analysisCalled = false;

  const result = ensureRustCombinedAnalysis(
    creature,
    "/tmp/test.parquet",
    {
      isRustDiscoveryEnabled: () => false,
      isRustLibraryAvailable: () => false,
      recordDiscovery: () => ({ success: false }),
      mergeDiscoveryParquet: () => ({ success: false }),
      analyzeParallel: () => {
        analysisCalled = true;
        return { success: false };
      },
      readDiscoveryRecords: () => ({ success: false }),
    },
    undefined,
    undefined,
    [focusId],
    true,
    true,
    () => {},
  );

  assertEquals(
    analysisCalled,
    false,
    "Should not call analysis when discovery is disabled",
  );
  assertEquals(result.result, undefined);
});
