import { assert } from "@std/assert";
import { formatDiscoveryPerformanceSummary } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";

Deno.test("formatDiscoveryPerformanceSummary includes coordinated structural candidate counts", () => {
  const rendered = formatDiscoveryPerformanceSummary(
    "TEST",
    {
      // Record phase stats
      recordsProcessed: 0,
      filesProcessed: 0,
      recordPhaseTime: 0,
      initializationTime: 0,
      fileProcessingTime: 0,
      promiseWaitTime: 0,

      // Analysis phase stats
      neuronsAnalyzed: 0,
      retryAttempts: 0,
      analysisPhaseTime: 0,
      focusSelectionTime: 0,
      rustCombinedAnalysisTime: 0,
      neuronAnalysisTime: 0,
      synapseAnalysisTime: 0,
      harmfulSynapseAnalysisTime: 0,
      harmfulNeuronAnalysisTime: 0,
      squashAnalysisTime: 0,

      // Candidate counts
      helpfulSynapseCount: 0,
      helpfulNeuronCount: 0,
      coordinatedStructuralCount: 7,
      harmfulSynapseCount: 0,
      harmfulNeuronCount: 0,
      squashCount: 0,
      removalCount: 0,

      // Other phases
      cleanupTime: 0,
      totalTime: 0,
    },
    { colour: false },
  );

  assert(
    rendered.includes("Coordinated structural: 7"),
    `expected coordinated structural count to be rendered, got:\n${rendered}`,
  );
});


