/**
 * Tests for cross-platform GPU support via wgpu abstraction.
 *
 * Issue #1864: Verify GPU backend detection, CPU fallback behaviour,
 * and cross-platform requireGpu logic.
 */
import { assertEquals, assertExists, assertThrows } from "@std/assert";
import {
  buildCombinedAnalysisKey,
  convertParallelAnalysisResult,
  ensureRustCombinedAnalysis,
} from "@architecture/ErrorGuidedStructuralEvolution/RustAnalysisCache.ts";
import type {
  GpuBackendInfo,
  RustCheckGpuResult,
  RustParallelAnalysisInput,
  RustParallelAnalysisResult,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { creatureToRustFormat } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { buildWireToRuntimeIdMap } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { initWasmForTests } from "../_initWasm.ts";

function makeCreature(): Creature {
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

function output0Id(creature: Creature): number {
  const id = buildWireToRuntimeIdMap(creature).get("output-0");
  assertExists(id, "output-0 should have a runtime id");
  return id;
}

Deno.test("requireGpu is omitted in ensureRustCombinedAnalysis so GPU guard is active (Issue #2142)", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  const focusId = output0Id(creature);
  let capturedInput: RustParallelAnalysisInput | undefined;

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
      analyzeParallel: (input: RustParallelAnalysisInput) => {
        capturedInput = input;
        return {
          success: true,
          helpfulSynapses: [],
          harmfulSynapses: [],
          helpfulNeurons: [],
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
    "requireGpu should be omitted so the GPU guard in analyzeParallel() can block calls when GPU is unavailable (Issue #2142)",
  );
  assertExists(result.result, "Result should be returned");
});

Deno.test("CPU fallback: analysis succeeds with gpuUsed=false", () => {
  const parallelResult: RustParallelAnalysisResult = {
    success: true,
    synapseGpuUsed: false,
    neuronGpuUsed: false,
    helpfulSynapses: [
      {
        fromNeuronUuid: "input-0",
        toNeuronUuid: "hidden-1",
        weight: 0.3,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0.1,
        expectedCreatureScoreGain: 0.5,
        improvedCount: 5,
        totalCount: 10,
      },
    ],
    harmfulSynapses: [],
    helpfulNeurons: [],
  };

  const converted = convertParallelAnalysisResult(parallelResult);

  assertEquals(converted.success, true);
  assertExists(converted.synapse, "Synapse result should exist");
  assertEquals(
    converted.synapse!.gpuUsed,
    false,
    "gpuUsed should be false for CPU fallback",
  );
  assertEquals(
    converted.synapse!.helpfulSynapses?.length,
    1,
    "Helpful synapse candidates should still be returned on CPU",
  );
});

Deno.test("GPU acceleration: analysis reports gpuUsed=true", () => {
  const parallelResult: RustParallelAnalysisResult = {
    success: true,
    synapseGpuUsed: true,
    neuronGpuUsed: true,
    helpfulSynapses: [
      {
        fromNeuronUuid: "input-0",
        toNeuronUuid: "hidden-1",
        weight: 0.3,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0.1,
        expectedCreatureScoreGain: 0.5,
        improvedCount: 5,
        totalCount: 10,
      },
    ],
    harmfulSynapses: [],
    helpfulNeurons: [
      {
        sourceNeuronUuid: "input-0",
        targetNeuronUuid: "output-0",
        incomingWeight: 0.5,
        outgoingWeight: 0.3,
        squash: "TANH",
        bias: 0,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0.2,
        expectedCreatureScoreGain: 0.8,
        improvedCount: 8,
        totalCount: 10,
      },
    ],
  };

  const converted = convertParallelAnalysisResult(parallelResult);

  assertEquals(converted.success, true);
  assertExists(converted.synapse);
  assertEquals(converted.synapse!.gpuUsed, true);
  assertExists(converted.neuron);
  assertEquals(converted.neuron!.gpuUsed, true);
});

Deno.test("RustCheckGpuResult accepts backend info fields", () => {
  const result: RustCheckGpuResult = {
    success: true,
    gpuAvailable: true,
    backendName: "Metal",
    adapterName: "Apple M1 Pro",
  };

  assertEquals(result.gpuAvailable, true);
  assertEquals(result.backendName, "Metal");
  assertEquals(result.adapterName, "Apple M1 Pro");
});

Deno.test("RustCheckGpuResult works without backend info (older Rust library)", () => {
  const result: RustCheckGpuResult = {
    success: true,
    gpuAvailable: true,
  };

  assertEquals(result.gpuAvailable, true);
  assertEquals(result.backendName, undefined);
  assertEquals(result.adapterName, undefined);
});

Deno.test("RustCheckGpuResult reports Vulkan backend", () => {
  const result: RustCheckGpuResult = {
    success: true,
    gpuAvailable: true,
    backendName: "Vulkan",
    adapterName: "NVIDIA GeForce RTX 3080",
  };

  assertEquals(result.gpuAvailable, true);
  assertEquals(result.backendName, "Vulkan");
  assertEquals(result.adapterName, "NVIDIA GeForce RTX 3080");
});

Deno.test("RustCheckGpuResult reports DX12 backend", () => {
  const result: RustCheckGpuResult = {
    success: true,
    gpuAvailable: true,
    backendName: "Dx12",
    adapterName: "AMD Radeon RX 7900",
  };

  assertEquals(result.gpuAvailable, true);
  assertEquals(result.backendName, "Dx12");
});

Deno.test("RustCheckGpuResult reports no GPU available with reason", () => {
  const result: RustCheckGpuResult = {
    success: true,
    gpuAvailable: false,
    error: "no compatible GPU adapter found",
  };

  assertEquals(result.gpuAvailable, false);
  assertEquals(result.backendName, undefined);
  assertEquals(result.error, "no compatible GPU adapter found");
});

Deno.test("GpuBackendInfo type represents GPU-available state", () => {
  const info: GpuBackendInfo = {
    available: true,
    backendName: "Metal",
    adapterName: "Apple M2",
  };

  assertEquals(info.available, true);
  assertEquals(info.backendName, "Metal");
  assertEquals(info.adapterName, "Apple M2");
});

Deno.test("GpuBackendInfo type represents CPU-fallback state", () => {
  const info: GpuBackendInfo = {
    available: false,
    reason: "no usable GPU detected",
  };

  assertEquals(info.available, false);
  assertEquals(info.reason, "no usable GPU detected");
  assertEquals(info.backendName, undefined);
});

Deno.test("discovery enabled: analysis called with requireGpu omitted (Issue #2142)", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  const focusId = output0Id(creature);
  let analysisCalled = false;
  let capturedRequireGpu: boolean | undefined;

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
      analyzeParallel: (input: RustParallelAnalysisInput) => {
        analysisCalled = true;
        capturedRequireGpu = input.requireGpu;
        return {
          success: true,
          synapseGpuUsed: false,
          neuronGpuUsed: false,
          helpfulSynapses: [],
          harmfulSynapses: [],
          helpfulNeurons: [],
        };
      },
      readDiscoveryRecords: () => ({ success: true, records: [] }),
    },
    undefined,
    undefined,
    [focusId],
    true,
    true,
    () => {},
  );

  assertEquals(analysisCalled, true, "Analysis should be called");
  assertEquals(
    capturedRequireGpu,
    undefined,
    "requireGpu should be omitted so the GPU guard can protect the FFI call (Issue #2142)",
  );
  assertExists(result.result, "Should return analysis result");
});

Deno.test("ensureRustCombinedAnalysis skips unresolved focus neurons", async () => {
  await initWasmForTests();
  let analysisCalled = false;
  let loggedReason: string | undefined;

  const result = ensureRustCombinedAnalysis(
    makeCreature(),
    "/tmp/test.parquet",
    {
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: () => ({ success: true, file: "chunk.parquet" }),
      mergeDiscoveryParquet: () => ({
        success: true,
        outputFile: "merged.parquet",
      }),
      analyzeParallel: () => {
        analysisCalled = true;
        return { success: true };
      },
      readDiscoveryRecords: () => ({ success: true, records: [] }),
    },
    undefined,
    undefined,
    [999999],
    true,
    true,
    (_scope, _focusList, reason) => {
      loggedReason = reason;
    },
  );

  assertEquals(
    analysisCalled,
    false,
    "Rust analysis should not run with unresolved wire identities",
  );
  assertEquals(result.result, undefined);
  assertEquals(
    loggedReason,
    "focus neuron 999999 is missing a stable wire uuid for Rust analysis",
  );
});

Deno.test("discovery disabled when library unavailable", () => {
  const creature = makeCreature();
  const focusId = output0Id(creature);
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
    "Should not call analysis when library is unavailable",
  );
  assertEquals(result.result, undefined, "Result should be undefined");
});

Deno.test("creatureToRustFormat rejects missing wire uuids", () => {
  const invalidExport: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        id: 42,
        type: "output",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      {
        fromId: 0,
        toId: 42,
        weight: 1,
      },
    ],
  };

  assertThrows(
    () => creatureToRustFormat(invalidExport),
    TopologyError,
    "Rust discovery input requires stable wire uuid",
  );
});

Deno.test("combined analysis cache key is stable", () => {
  const key1 = buildCombinedAnalysisKey("/tmp/data.parquet", [1, 2]);
  const key2 = buildCombinedAnalysisKey("/tmp/data.parquet", [1, 2]);
  assertEquals(key1, key2);

  const key3 = buildCombinedAnalysisKey("/tmp/other.parquet", [1, 2]);
  assertEquals(
    key1 !== key3,
    true,
    "Different paths should produce different keys",
  );
});
