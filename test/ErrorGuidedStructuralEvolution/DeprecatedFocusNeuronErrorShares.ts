/**
 * Tests that the deprecated `focusNeuronErrorShares` field no longer reaches
 * the Rust `analyze_parallel` payload (Issue #3449).
 *
 * The Rust library (v0.2.0+) calculates impact scaling internally and does not
 * read the field, so computing and sending it was wasted work on every
 * parallel-analysis call. The FFI is mocked, so no GPU and no built
 * NEAT-AI-Discovery library are required — the assertions are on the payload
 * NEAT-AI actually hands to Rust.
 */
import { assert, assertEquals } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { ensureRustCombinedAnalysis } from "@architecture/ErrorGuidedStructuralEvolution/RustAnalysisCache.ts";
import type { DiscoverStructureDeps } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type {
  RustParallelAnalysisInput,
  RustParallelAnalysisResult,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
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

function focusRuntimeIds(creature: Creature): number[] {
  const output = creature.neurons.find((n) => n.type === "output");
  const hidden = creature.neurons.find((n) => n.type === "hidden");
  assert(output, "test creature must have an output neuron");
  assert(hidden, "test creature must have a hidden neuron");
  return [hidden.id, output.id];
}

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
) {
  return ensureRustCombinedAnalysis(
    creature,
    "/tmp/discovery-3449.parquet",
    makeCapturingDeps(captured),
    undefined, // no cache
    undefined, // no analysis deadline
    focusRuntimeIds(creature),
    true, // includeSynapse
    true, // includeNeuron
    () => {},
  );
}

Deno.test("analysis request omits the deprecated focus error shares (Issue #3449)", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const captured: RustParallelAnalysisInput[] = [];

  runAnalysis(creature, captured);

  assertEquals(captured.length, 1, "expected one analyze_parallel call");
  assertEquals(
    Object.hasOwn(captured[0], "focusNeuronErrorShares"),
    false,
    "deprecated focusNeuronErrorShares must not appear on the FFI wire",
  );
});

Deno.test("analysis request still carries the focus neuron wire uuids (Issue #3449)", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const captured: RustParallelAnalysisInput[] = [];

  const { result } = runAnalysis(creature, captured);

  assert(result?.success, "analysis should succeed with the mocked FFI");
  assertEquals(captured[0].focusNeurons.length, 2);
  assertEquals(captured[0].focusNeurons.includes("output-0"), true);
});
