/**
 * Pins the `analyze_parallel` FFI wire shape (Issue #3886).
 *
 * NEAT-AI-Discovery deserialises the analysis request into a **flat**
 * camelCase `AnalyzeParallelInput`, whose `creature` is a `CreatureJson` with
 * **required** `input` and `output` widths. A payload missing those widths is
 * rejected with `missing field 'input'` / `errorKind: "data_validation"` before
 * any analysis or GPU probing happens — which reads like a schema-envelope
 * mismatch but is really a missing observation width nested inside `creature`.
 *
 * The FFI is mocked, so these assertions run everywhere — including CI, where
 * no NEAT-AI-Discovery library is built and every live-FFI test is skipped.
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

/** Runs one analysis pass and returns the payload NEAT-AI handed to Rust. */
function captureAnalysisRequest(): RustParallelAnalysisInput {
  const creature = makeTestCreature();
  const output = creature.neurons.find((n) => n.type === "output");
  assert(output, "test creature must have an output neuron");
  const captured: RustParallelAnalysisInput[] = [];

  ensureRustCombinedAnalysis(
    creature,
    "/tmp/discovery-3886.parquet",
    makeCapturingDeps(captured),
    undefined, // no cache
    undefined, // no analysis deadline
    [output.id],
    true, // includeSynapse
    false, // includeNeuron
    () => {},
  );

  assertEquals(captured.length, 1, "expected one analyze_parallel call");
  return captured[0];
}

Deno.test("analysis request carries the creature observation widths (Issue #3886)", async () => {
  await initWasmForTests();

  const creature = captureAnalysisRequest().creature;

  // Discovery's `CreatureJson` requires both widths and rejects anything < 1.
  assertEquals(creature.input, 2, "input width must reach Discovery");
  assertEquals(creature.output, 1, "output width must reach Discovery");
});

Deno.test("analysis request is serialised flat, with no envelope (Issue #3886)", async () => {
  await initWasmForTests();

  // Assert on the bytes that actually cross the FFI boundary.
  const wire = JSON.parse(
    JSON.stringify(captureAnalysisRequest()),
  ) as Record<string, unknown>;

  assert(
    typeof wire.parquetFile === "string",
    "parquetFile must sit at the top level of the payload",
  );
  assert(
    Array.isArray(wire.focusNeurons),
    "focusNeurons must sit at the top level of the payload",
  );
  assertEquals(
    Object.hasOwn(wire, "input"),
    false,
    "the payload is flat — a top-level `input` key would be an envelope Discovery does not deserialise",
  );

  const creature = wire.creature as Record<string, unknown>;
  assertEquals(
    Object.hasOwn(creature, "input"),
    true,
    "`input` belongs inside `creature` — that is the field Discovery reports as missing",
  );
  assertEquals(Object.hasOwn(creature, "output"), true);
});
