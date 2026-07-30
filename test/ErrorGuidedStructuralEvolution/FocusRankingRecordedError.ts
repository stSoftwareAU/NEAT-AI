/**
 * Issue #3531: NEAT-AI-Discovery's focus ranking is structure-only — it never
 * opens the discovery parquet, so every ranked neuron comes back with
 * `totalError: 0` and only a structural `impact`. NEAT-AI weights focus
 * selection by `totalError × impact`, so an un-hydrated zero collapses every
 * candidate below `costOfGrowth` and discovery selects nothing.
 *
 * These tests exercise `listViableNeurons` directly with a stubbed FFI surface,
 * so they need neither the Rust library nor a parquet file.
 */
import { assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { listViableNeurons } from "@architecture/ErrorGuidedStructuralEvolution/FocusSelectionRanking.ts";
import type { DiscoverStructureDeps } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureBase.ts";
import type { RustRankFocusResult } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryTypes.ts";
import { neuronUuid } from "@neuron/NeuronSerialization.ts";

function makeCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "hidden", uuid: "hidden-1", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

/** Runtime id of a non-input neuron, looked up by its wire UUID. */
function runtimeId(creature: Creature, wireUuid: string): number {
  const neuron = creature.neurons.find((n) =>
    n.type !== "input" && neuronUuid(n) === wireUuid
  );
  if (!neuron) throw new Error(`No neuron with wire uuid ${wireUuid}`);
  return neuron.id;
}

/**
 * Deps whose focus ranking mirrors the structure-only Rust contract: real
 * structural impact, record-derived `totalError` always 0.
 */
function structureOnlyDeps(
  impacts: Map<string, number>,
): DiscoverStructureDeps {
  const result: RustRankFocusResult = {
    success: true,
    neurons: [...impacts.entries()].map(([neuronUuid, impact]) => ({
      neuronUuid,
      totalError: 0,
      impact,
    })),
    processedNeurons: impacts.size,
    totalNeurons: impacts.size,
    durationMs: 0,
  };
  return {
    isRustDiscoveryEnabled: () => true,
    isRustLibraryAvailable: () => true,
    recordDiscovery: () => {
      throw new Error("recordDiscovery must not be called");
    },
    mergeDiscoveryParquet: () => {
      throw new Error("mergeDiscoveryParquet must not be called");
    },
    analyzeParallel: () => {
      throw new Error("analyzeParallel must not be called");
    },
    readDiscoveryRecords: () => {
      throw new Error("readDiscoveryRecords must not be called");
    },
    rankFocusNeurons: () => result,
  };
}

function callListViableNeurons(
  creature: Creature,
  deps: DiscoverStructureDeps,
  recordedNeuronTotalAbsError: Map<number, number>,
) {
  return listViableNeurons(
    creature,
    true,
    "unused-by-the-structure-only-ranking.parquet",
    deps,
    false,
    "test-discovery",
    recordedNeuronTotalAbsError,
    () => 0,
    () => {},
  );
}

Deno.test("Focus ranking hydrates structure-only totalError from recorded errors", () => {
  const creature = makeCreature();
  const impacts = new Map([
    ["output-0", 1],
    ["hidden-0", 0.6],
    ["hidden-1", 0.3],
  ]);
  const recorded = new Map([
    [runtimeId(creature, "output-0"), 12.5],
    [runtimeId(creature, "hidden-0"), 7.25],
    [runtimeId(creature, "hidden-1"), 3.5],
  ]);

  const result = callListViableNeurons(
    creature,
    structureOnlyDeps(impacts),
    recorded,
  );

  assertEquals(result.neurons.length, 3, "all ranked neurons are returned");
  for (const neuron of result.neurons) {
    assertEquals(
      neuron.totalError,
      recorded.get(neuron.id),
      `neuron ${neuron.id} carries its recorded absolute error`,
    );
  }
  // Structural impact from the ranking is preserved untouched.
  assertEquals(
    result.neurons.find((n) => n.id === runtimeId(creature, "hidden-1"))
      ?.impact,
    0.3,
  );
});

Deno.test("Focus ranking keeps a non-zero ranking totalError over the recorded error", () => {
  const creature = makeCreature();
  const outputId = runtimeId(creature, "output-0");
  const deps = structureOnlyDeps(new Map([["output-0", 1]]));
  const ranked = deps.rankFocusNeurons?.({
    parquetFile: "",
    creature: { neurons: [], synapses: [], input: 0, output: 0 },
  });
  // Simulate a ranking that does carry record-derived error.
  ranked!.neurons![0].totalError = 9;

  const result = callListViableNeurons(
    creature,
    deps,
    new Map([[outputId, 4]]),
  );

  assertEquals(result.neurons, [{ id: outputId, totalError: 9, impact: 1 }]);
});

Deno.test("Focus ranking leaves totalError at zero when nothing was recorded", () => {
  const creature = makeCreature();
  const outputId = runtimeId(creature, "output-0");

  const result = callListViableNeurons(
    creature,
    structureOnlyDeps(new Map([["output-0", 1]])),
    new Map(),
  );

  assertEquals(result.neurons, [{ id: outputId, totalError: 0, impact: 1 }]);
});
