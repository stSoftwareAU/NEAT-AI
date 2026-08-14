/**
 * The `analyze_parallel` payload must not carry `focusNeuronErrorShares`
 * (Issue #3449).
 *
 * The field was deprecated once the Rust library calculated impact scaling
 * internally, and NEAT-AI-Discovery's `AnalyzeParallelInput` no longer declares
 * it at all — serde silently discards the key. Computing the shares was
 * therefore pure waste on every analysis call, so NEAT-AI stops sending them.
 *
 * The FFI is mocked, so no GPU and no built NEAT-AI-Discovery library are
 * required. The assertions are on the payload NEAT-AI actually hands to Rust.
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

function captureAnalysisInput(
  focusTypes: ReadonlyArray<"hidden" | "output">,
): RustParallelAnalysisInput {
  const creature = makeTestCreature();
  const focusList = focusTypes.map((type) => {
    const neuron = creature.neurons.find((n) => n.type === type);
    assert(neuron, `test creature must have a ${type} neuron`);
    return neuron.id;
  });
  const captured: RustParallelAnalysisInput[] = [];

  ensureRustCombinedAnalysis(
    creature,
    "/tmp/discovery-3449.parquet",
    makeCapturingDeps(captured),
    undefined, // no cache
    undefined, // no analysis deadline
    focusList,
    true, // includeSynapse
    true, // includeNeuron
    () => {},
  );

  assertEquals(captured.length, 1, "expected one analyze_parallel call");
  return captured[0];
}

Deno.test("analysis request omits focusNeuronErrorShares (Issue #3449)", async () => {
  await initWasmForTests();

  const input = captureAnalysisInput(["output"]);

  assertEquals(
    Object.hasOwn(input, "focusNeuronErrorShares"),
    false,
    "the deprecated field must not appear on the FFI wire",
  );
});

Deno.test("multi-focus analysis still sends focus neuron uuids (Issue #3449)", async () => {
  await initWasmForTests();

  const input = captureAnalysisInput(["hidden", "output"]);

  // Dropping the deprecated shares must not disturb the focus list itself.
  assertEquals(input.focusNeurons.length, 2);
  assertEquals(
    input.focusNeurons.every((uuid) => typeof uuid === "string" && uuid !== ""),
    true,
    "every focus neuron must still carry a stable wire uuid",
  );
  assertEquals(Object.hasOwn(input, "focusNeuronErrorShares"), false);
});
