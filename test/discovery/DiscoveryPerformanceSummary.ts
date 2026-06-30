import { assert, assertStringIncludes } from "@std/assert";
import {
  formatDiscoveryPerformanceSummary,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";

Deno.test("Discovery performance summary omits unrecorded (zero) phase timings", () => {
  const text = formatDiscoveryPerformanceSummary(
    "deadbeef",
    {
      // Record phase
      recordsProcessed: 10,
      filesProcessed: 2,
      initializationTime: 3,
      fileProcessingTime: 2_000,
      promiseWaitTime: 0, // unrecorded
      recordPhaseTime: 2_003,

      // Analysis phase
      neuronsAnalyzed: 6,
      retryAttempts: 0,
      focusSelectionTime: 35_000,
      rustCombinedAnalysisTime: 900_000,
      neuronAnalysisTime: 0, // unrecorded
      synapseAnalysisTime: 0, // unrecorded
      harmfulSynapseAnalysisTime: 0, // unrecorded
      harmfulNeuronAnalysisTime: 0, // unrecorded
      squashAnalysisTime: 10_000,
      analysisPhaseTime: 945_000,

      // Candidate counts
      helpfulSynapseCount: 1,
      helpfulNeuronCount: 30,
      coordinatedStructuralCount: 0,
      harmfulSynapseCount: 0,
      harmfulNeuronCount: 0,
      squashCount: 1,
      removalCount: 50,

      // Overall
      cleanupTime: 0, // async/unrecorded
      totalTime: 1_200_000,
    },
    { colour: false },
  );

  // Must include core totals and counts
  assertStringIncludes(text, "Discovery Performance Summary deadbeef");
  assertStringIncludes(text, "Records processed:");
  assertStringIncludes(text, "Total record phase:");
  assertStringIncludes(text, "Total analysis phase:");
  assertStringIncludes(text, "Total time:");

  // Must not include blank/unrecorded phases
  assert(
    !text.includes("Promise wait:"),
    `Expected 'Promise wait' to be omitted when unrecorded, got:\n${text}`,
  );
  assert(
    !text.includes("Neuron analysis:"),
    `Expected 'Neuron analysis' to be omitted when unrecorded, got:\n${text}`,
  );
  assert(
    !text.includes("Synapse analysis:"),
    `Expected 'Synapse analysis' to be omitted when unrecorded, got:\n${text}`,
  );
  assert(
    !text.includes("Harmful synapse analysis:"),
    `Expected 'Harmful synapse analysis' to be omitted when unrecorded, got:\n${text}`,
  );
  assert(
    !text.includes("Harmful neuron analysis:"),
    `Expected 'Harmful neuron analysis' to be omitted when unrecorded, got:\n${text}`,
  );
  assert(
    !text.includes("Cleanup:"),
    `Expected 'Cleanup' to be omitted when unrecorded, got:\n${text}`,
  );
});

Deno.test("Discovery performance summary clamps non-finite total times to zero (Issue #3149)", () => {
  // The module-private `msOrZero` helper guards the "Total ... phase" / "Total
  // time" lines against non-finite inputs (NaN / Infinity). Exercise it through
  // the public formatter so the clamping survives even though the helper is no
  // longer exported.
  const text = formatDiscoveryPerformanceSummary(
    "feedface",
    {
      // Record phase — non-finite total
      recordsProcessed: 1,
      filesProcessed: 1,
      initializationTime: 0,
      fileProcessingTime: 0,
      promiseWaitTime: 0,
      recordPhaseTime: Number.POSITIVE_INFINITY,

      // Analysis phase — NaN total
      neuronsAnalyzed: 1,
      retryAttempts: 0,
      focusSelectionTime: 0,
      rustCombinedAnalysisTime: 0,
      neuronAnalysisTime: 0,
      synapseAnalysisTime: 0,
      harmfulSynapseAnalysisTime: 0,
      harmfulNeuronAnalysisTime: 0,
      squashAnalysisTime: 0,
      analysisPhaseTime: Number.NaN,

      // Candidate counts
      helpfulSynapseCount: 0,
      helpfulNeuronCount: 0,
      coordinatedStructuralCount: 0,
      harmfulSynapseCount: 0,
      harmfulNeuronCount: 0,
      squashCount: 0,
      removalCount: 0,

      // Overall — non-finite total
      cleanupTime: 0,
      totalTime: Number.NEGATIVE_INFINITY,
    },
    { colour: false },
  );

  // Non-finite values must never leak into the rendered summary.
  assert(
    !text.includes("Infinity") && !text.includes("NaN"),
    `Expected non-finite times to be clamped, got:\n${text}`,
  );

  // Each clamped total renders as the zero-duration form rather than a blank or
  // a garbage token.
  const zeroDuration = "0d 0h 0m 0s 0ms 0µs 0ns";
  assertStringIncludes(text, `Total record phase: ${zeroDuration}`);
  assertStringIncludes(text, `Total analysis phase: ${zeroDuration}`);
  assertStringIncludes(text, `Total time: ${zeroDuration}`);
});
