/**
 * Issue #3511 — 24 value-level symbols carried an `export` keyword but had
 * zero references outside their defining file. The keyword was dropped so the
 * module boundary reflects reality.
 *
 * This test imports each module for real and inspects its runtime namespace
 * object, asserting the symbol is no longer part of the module's public shape.
 * It is behaviour-based, not source-text based: it keeps passing if a symbol is
 * later renamed, moved, or deleted outright, and fails the moment someone
 * re-adds `export` without a genuine cross-file consumer.
 *
 * Each module is also asserted to still export at least one symbol, so an
 * over-eager sweep that stripped a module bare would be caught here rather
 * than by a downstream import failure.
 */

import { assert, assertEquals } from "@std/assert";

/** A module that lost one or more redundant `export` keywords. */
interface StrippedModule {
  /** Import specifier, relative to this test file. */
  readonly specifier: string;
  /** Symbols that must no longer appear in the module namespace. */
  readonly removed: readonly string[];
}

const STRIPPED_MODULES: readonly StrippedModule[] = [
  {
    specifier: "../../src/upgrade/SemanticVersionValidation.ts",
    removed: ["VALID_WRITEABLE_SEMANTIC_VERSION_RE"],
  },
  {
    specifier: "../../src/optimize/Simplify.ts",
    removed: ["removeKnownSign"],
  },
  {
    specifier: "../../src/config/parsers/MutationParsers.ts",
    removed: ["parseDiversityAwareMCMC"],
  },
  {
    specifier: "../../src/wasm/WasmBundleCache.ts",
    removed: [
      "DEFAULT_MAX_ATTEMPTS",
      "DEFAULT_BASE_DELAY_MS",
      "resolveCacheDir",
    ],
  },
  {
    specifier: "../../src/discovery/BatchValidatorTypes.ts",
    removed: ["STRUCTURAL_CHANGE_TYPES", "WEIGHT_ONLY_CHANGE_TYPES"],
  },
  {
    specifier: "../../src/discovery/DiscoveryEvaluationSummary.ts",
    removed: ["logSingleSummary"],
  },
  {
    specifier: "../../src/creature/MemeticWireExport.ts",
    removed: [
      "buildNeuronIdToWireUuidMap",
      "convertMemeticSnapshotToWireJson",
    ],
  },
  {
    specifier: "../../src/architecture/NormaliseComputationalNeuronOrder.ts",
    removed: ["moveNeuronToIndex"],
  },
  {
    specifier:
      "../../src/architecture/ErrorGuidedStructuralEvolution/DataRecorderRecording.ts",
    removed: ["processDiscoveryFile"],
  },
  {
    specifier:
      "../../src/architecture/ErrorGuidedStructuralEvolution/NeuronImpact.ts",
    removed: ["computeSquashDerivative"],
  },
  {
    specifier:
      "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverDataLoading.ts",
    removed: ["openFileWithRetry", "loadInputNeuronFromBinary"],
  },
  {
    specifier:
      "../../src/architecture/ErrorGuidedStructuralEvolution/AnalysisDegradeDecision.ts",
    removed: ["DEGRADED_MAX_NEURONS_FACTOR"],
  },
  {
    specifier:
      "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverAnalysis.ts",
    removed: [
      "candidateKey",
      "neuronCandidateKey",
      "filterTopSynapseCandidates",
      "tryRustCoordinatedStructuralCandidates",
    ],
  },
  {
    specifier:
      "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoveryAnalysisMemory.ts",
    removed: ["DEFAULT_DISCOVERY_ANALYSIS_MEMORY_DEPS"],
  },
  {
    specifier: "../../src/breed/Father.ts",
    removed: ["DEFAULT_SYNTHETIC_ALIGNMENT_THRESHOLD"],
  },
  {
    specifier: "../../src/workers/WorkerHandlerBase.ts",
    removed: ["readV8HeapLimitMb"],
  },
];

Deno.test("Issue #3511 - file-local symbols are absent from the module namespace", async () => {
  let checked = 0;

  const namespaces = await Promise.all(
    STRIPPED_MODULES.map((module) =>
      import(new URL(module.specifier, import.meta.url).href) as Promise<
        Record<string, unknown>
      >
    ),
  );

  for (const [index, { specifier, removed }] of STRIPPED_MODULES.entries()) {
    const namespace = namespaces[index];

    const exported = Object.keys(namespace);
    assert(
      exported.length > 0,
      `${specifier} exports nothing — the sweep stripped too much`,
    );

    for (const symbol of removed) {
      assertEquals(
        Object.hasOwn(namespace, symbol),
        false,
        `${specifier} still exports '${symbol}', which has no cross-file consumer`,
      );
      checked++;
    }
  }

  // All 24 symbols listed in Issue #3511 are covered.
  assertEquals(checked, 24);
});

Deno.test("Issue #3511 - modules keep the exports their consumers rely on", async () => {
  // Spot-check the surviving public shape of the two most heavily imported
  // modules touched by the sweep, so a mis-targeted line number would fail
  // here rather than at the first downstream import.
  const father = await import("../../src/breed/Father.ts") as Record<
    string,
    unknown
  >;
  assertEquals(typeof father.createCompatibleFather, "function");

  const simplify = await import("../../src/optimize/Simplify.ts") as Record<
    string,
    unknown
  >;
  assertEquals(typeof simplify.simplify, "function");
});
