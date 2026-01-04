import { assert, assertStringIncludes } from "@std/assert";
import {
  formatDiscoveryPerformanceSummary,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";

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
