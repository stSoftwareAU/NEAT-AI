/**
 * Issue #3692 — fact-check guard for docs/GPU_ACCELERATION.md and the three
 * sibling docs that repeated its CPU-fallback claim.
 *
 * Four documents told operators that discovery analysis "falls back to CPU"
 * when no GPU adapter is present. It does not: `analyzeParallel()` refuses the
 * call with "GPU adapter not available", and NEAT-AI-Discovery itself
 * hard-requires a GPU for synapse/neuron analysis. These are "what" tests —
 * each documented claim is exercised against the real code path, so the docs
 * cannot silently drift back.
 */

import { assert, assertEquals } from "@std/assert";
import { createNeatConfig, getGpuBackendInfo } from "../../mod.ts";
import {
  convertParallelAnalysisResult,
  ensureRustCombinedAnalysis,
} from "@architecture/ErrorGuidedStructuralEvolution/RustAnalysisCache.ts";
import type { RustParallelAnalysisInput } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { buildWireToRuntimeIdMap } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** The exact refusal `analyzeParallel()` returns on a GPU-less host. */
const GPU_GUARD_ERROR =
  "Rust synapse/neuron analysis unavailable (GPU adapter not available)";

/** Builds a creature with a hidden neuron suitable for discovery analysis. */
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

Deno.test({
  name:
    "GPU doc — getGpuBackendInfo() is reachable from the package entry point",
  sanitizeResources: false,
  sanitizeOps: false,
  fn() {
    // The doc's "Query Backend Info" sample must be runnable by a consumer,
    // who can only import from the root specifier (@stsoftware/neat-ai).
    const info = getGpuBackendInfo();
    assertEquals(typeof info.available, "boolean");
    if (info.available) {
      if (info.backendName) {
        assert(
          ["metal", "vulkan", "dx12", "gl"].includes(
            info.backendName.toLowerCase(),
          ),
          `Unexpected wgpu backend name: ${info.backendName}`,
        );
      }
    } else {
      assertEquals(
        typeof info.reason,
        "string",
        "an unavailable GPU must report why",
      );
    }
  },
});

Deno.test(
  "GPU doc — a GPU-less analysis yields no candidates, not CPU results",
  async () => {
    await initWasmForTests();
    const creature = makeTestCreature();
    const focusId = buildWireToRuntimeIdMap(creature).get("output-0");
    assert(focusId !== undefined, "output-0 should have a runtime id");

    const warnings: Array<{ scope: string; reason: string }> = [];
    const { result, cache } = ensureRustCombinedAnalysis(
      creature,
      "/tmp/gpu-doc.parquet",
      {
        isRustDiscoveryEnabled: () => true,
        isRustLibraryAvailable: () => true,
        recordDiscovery: () => ({ success: true, file: "chunk.parquet" }),
        mergeDiscoveryParquet: () => ({
          success: true,
          outputFile: "merged.parquet",
        }),
        // Exactly what the shipped GPU guard returns on a GPU-less host.
        analyzeParallel: ((_input: RustParallelAnalysisInput) => ({
          success: false,
          error: GPU_GUARD_ERROR,
        })) as Parameters<typeof ensureRustCombinedAnalysis>[2][
          "analyzeParallel"
        ],
        readDiscoveryRecords: () => ({ success: true, records: [] }),
      },
      undefined,
      undefined,
      [focusId],
      true,
      true,
      (scope, _focusList, reason) => warnings.push({ scope, reason }),
    );

    assertEquals(
      result,
      undefined,
      "no CPU path exists — the analysis produces no candidates at all",
    );
    assertEquals(cache, undefined, "a refused analysis must not be cached");
    assertEquals(
      warnings.map((w) => w.scope).sort(),
      ["neuron", "synapse"],
      "both analysis scopes must report the unavailability",
    );
    for (const warning of warnings) {
      assert(
        warning.reason.includes("GPU adapter not available"),
        `warning should name the GPU adapter, got: ${warning.reason}`,
      );
    }
  },
);

Deno.test("GPU doc — gpuUsed lives on the nested synapse/neuron results", () => {
  const converted = convertParallelAnalysisResult({
    success: true,
    synapseGpuUsed: true,
    neuronGpuUsed: true,
    helpfulSynapses: [
      {
        fromNeuronUuid: "input-0",
        toNeuronUuid: "output-0",
        weight: 0.25,
        targetNeuronImpact: 1,
        expectedCreatureErrorReduction: 0.05,
        expectedCreatureScoreGain: 0.1,
        improvedCount: 8,
        totalCount: 10,
      },
    ],
    helpfulNeurons: [
      {
        sourceNeuronUuid: "input-0",
        targetNeuronUuid: "output-0",
        incomingWeight: 0.5,
        outgoingWeight: 0.5,
        squash: "IDENTITY",
        bias: 0,
        targetNeuronImpact: 1,
        expectedCreatureErrorReduction: 0.05,
        expectedCreatureScoreGain: 0.1,
        improvedCount: 8,
        totalCount: 10,
      },
    ],
  });

  assertEquals(converted.synapse?.gpuUsed, true);
  assertEquals(converted.neuron?.gpuUsed, true);
  assertEquals(
    (converted as unknown as Record<string, unknown>).gpuUsed,
    undefined,
    "there is no top-level gpuUsed field to read",
  );
});

Deno.test("GPU doc — requireGpu is not a NeatOptions key", () => {
  const config = createNeatConfig({});
  assert(
    !("requireGpu" in config),
    "requireGpu is an internal FFI payload field, not user configuration",
  );
});

Deno.test("GPU doc — the corrected docs keep the false claims out", async () => {
  const forbidden: Array<{ file: string; text: string; why: string }> = [
    {
      file: "docs/GPU_ACCELERATION.md",
      text: "analyzeSynapses",
      why: "no such function exists; the entry point is analyzeParallel()",
    },
    {
      file: "docs/GPU_ACCELERATION.md",
      text: 'from "./RustDiscovery.ts"',
      why: "a relative path no consumer can resolve",
    },
    {
      file: "docs/GPU_ACCELERATION.md",
      text: "NEAT_AI_DISCOVERY_GPU_DEBUG",
      why: "read nowhere in NEAT-AI or NEAT-AI-Discovery",
    },
    {
      file: "docs/GPU_ACCELERATION.md",
      text: "requireGpu: false;",
      why: "presented as a configuration default that no caller can set",
    },
    {
      file: "docs/troubleshooting/DISCOVERY.md",
      text: "continues to run on the CPU path",
      why: "analysis is refused on a GPU-less host",
    },
    {
      file: "docs/DISCOVERY_DIR.md",
      text: "the Rust library handles CPU fallback internally",
      why: "the Rust crate hard-requires a GPU for analysis",
    },
    {
      file: "AGENTS.md",
      text: "with CPU (Central Processing Unit)\n  fallback",
      why: "there is no CPU fallback for discovery analysis",
    },
  ];

  const paths = [...new Set(forbidden.map((f) => f.file))];
  const texts = await Promise.all(
    paths.map((file) =>
      Deno.readTextFile(new URL(`../../${file}`, import.meta.url))
    ),
  );
  const cache = new Map(paths.map((file, i) => [file, texts[i]]));

  for (const { file, text, why } of forbidden) {
    assert(
      !cache.get(file)!.includes(text),
      `${file} still contains "${text}" — ${why}`,
    );
  }
});
