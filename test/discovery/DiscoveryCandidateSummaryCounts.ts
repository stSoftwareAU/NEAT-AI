import { assertEquals } from "@std/assert";
import {
  calculateDiscoveryCandidateSummaryCounts,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";

Deno.test("Discovery candidate summary reports raw Rust counts (no implied combos)", () => {
  const counts = calculateDiscoveryCandidateSummaryCounts({
    helpfulSynapseRawCount: 2,
    helpfulNeuronRawCount: 31,
    coordinatedStructuralRawCount: 4,
    harmfulSynapseCandidates: 0,
    harmfulNeuronCandidates: 0,
    squashRawCount: 2,
    removalRawCount: 46,
  });

  assertEquals(counts, {
    helpfulSynapses: 2,
    helpfulNeurons: 31,
    coordinatedStructural: 4,
    harmfulSynapses: 0,
    harmfulNeurons: 0,
    squashChanges: 2,
    removalCandidates: 46,
  });
});

Deno.test("Discovery candidate summary does not inflate removal counts when multiple exist", () => {
  for (const removalRawCount of [0, 1, 2, 47]) {
    const counts = calculateDiscoveryCandidateSummaryCounts({
      helpfulSynapseRawCount: 0,
      helpfulNeuronRawCount: 0,
      coordinatedStructuralRawCount: 0,
      harmfulSynapseCandidates: 0,
      harmfulNeuronCandidates: 0,
      squashRawCount: 0,
      removalRawCount,
    });
    assertEquals(counts.removalCandidates, removalRawCount);
  }
});
