/**
 * Tests for success cache deprioritisation in candidate filtering.
 *
 * Verifies that removal candidates with existing success cache entries
 * are deprioritised in favour of novel (untried) candidates.
 *
 * Part of #1716.
 */

import { assert, assertEquals } from "@std/assert";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import type { Creature } from "../../src/Creature.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
import type { DiscoveryChangeType } from "../../src/discovery/DiscoveryCandidates.ts";
import { filterCandidatesForEvaluation } from "../../src/discovery/CandidateFiltering.ts";

function makeConfig(overrides: NeatOptions = {}) {
  return createNeatConfig(overrides);
}

function makeRemovalCandidate(
  neuronUUID: string,
  impact: number,
  type: DiscoveryChangeType = "remove-low-impact",
): DiscoveryCandidate {
  return {
    creature: {} as unknown as Creature,
    change: {
      type,
      expectedErrorReduction: 0.01,
      description: `Remove neuron impact: ${impact}`,
      removalCandidate: {
        neuronUUID,
        totalError: 1.0,
        impact,
        reason: "low-impact",
      },
    },
  };
}

function makeHarmfulNeuronCandidate(
  neuronUUID: string,
  impact: number,
): DiscoveryCandidate {
  return {
    creature: {} as unknown as Creature,
    change: {
      type: "remove-neuron",
      expectedErrorReduction: 0.01,
      description: `Remove harmful neuron impact: ${impact}`,
      harmfulNeuronCandidate: {
        neuronUUID,
        errorMagnitude: impact,
        expectedCreatureScoreGain: 0.01,
        sampleCount: 100,
        averageActivation: 0.5,
      },
    },
  };
}

Deno.test("filterCandidatesForEvaluation: novel removal candidates preferred over already-successful ones", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 0,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 2,
    },
  });

  // 2 novel (uuid-a, uuid-b) and 2 already-successful (uuid-c, uuid-d)
  const candidates: DiscoveryCandidate[] = [
    makeRemovalCandidate("uuid-a", 0.001),
    makeRemovalCandidate("uuid-b", 0.002),
    makeRemovalCandidate("uuid-c", 0.001),
    makeRemovalCandidate("uuid-d", 0.002),
  ];

  const successfulUUIDs = new Set(["uuid-c", "uuid-d"]);

  const { filtered } = filterCandidatesForEvaluation(candidates, 1, config, {
    successCacheDir: "/tmp/success-cache",
    getSuccessfulRemovalUUIDs: () => successfulUUIDs,
    random: () => 0,
  });

  // Should select the 2 novel candidates (uuid-a, uuid-b)
  const removalFiltered = filtered.filter(
    (c) =>
      c.change.type === "remove-low-impact" ||
      c.change.type === "remove-neuron",
  );

  assertEquals(removalFiltered.length, 2);
  const selectedUUIDs = removalFiltered.map(
    (c) => c.change.removalCandidate?.neuronUUID,
  );
  assert(selectedUUIDs.includes("uuid-a"));
  assert(selectedUUIDs.includes("uuid-b"));
  assert(!selectedUUIDs.includes("uuid-c"));
  assert(!selectedUUIDs.includes("uuid-d"));
});

Deno.test("filterCandidatesForEvaluation: already-successful candidates used as fallback when insufficient novel candidates", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 0,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 3,
    },
  });

  // 1 novel (uuid-a) and 2 already-successful (uuid-b, uuid-c)
  const candidates: DiscoveryCandidate[] = [
    makeRemovalCandidate("uuid-a", 0.001),
    makeRemovalCandidate("uuid-b", 0.001),
    makeRemovalCandidate("uuid-c", 0.001),
  ];

  const successfulUUIDs = new Set(["uuid-b", "uuid-c"]);

  const { filtered } = filterCandidatesForEvaluation(candidates, 1, config, {
    successCacheDir: "/tmp/success-cache",
    getSuccessfulRemovalUUIDs: () => successfulUUIDs,
    random: () => 0,
  });

  const removalFiltered = filtered.filter(
    (c) =>
      c.change.type === "remove-low-impact" ||
      c.change.type === "remove-neuron",
  );

  // All 3 should be selected since we need 3 and only 1 is novel
  assertEquals(removalFiltered.length, 3);
});

Deno.test("filterCandidatesForEvaluation: behaviour unchanged when no success cache dir provided", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 0,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 2,
    },
  });

  const candidates: DiscoveryCandidate[] = [
    makeRemovalCandidate("uuid-a", 0.001),
    makeRemovalCandidate("uuid-b", 0.002),
    makeRemovalCandidate("uuid-c", 0.001),
  ];

  // No successCacheDir provided - should behave like before
  const { filtered } = filterCandidatesForEvaluation(candidates, 1, config, {
    random: () => 0,
  });

  const removalFiltered = filtered.filter(
    (c) =>
      c.change.type === "remove-low-impact" ||
      c.change.type === "remove-neuron",
  );

  assertEquals(removalFiltered.length, 2);
});

Deno.test("filterCandidatesForEvaluation: diagnostics include novel vs already-successful counts", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 0,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 2,
    },
  });

  const candidates: DiscoveryCandidate[] = [
    makeRemovalCandidate("uuid-a", 0.001),
    makeRemovalCandidate("uuid-b", 0.002),
    makeRemovalCandidate("uuid-c", 0.001),
    makeRemovalCandidate("uuid-d", 0.002),
  ];

  const successfulUUIDs = new Set(["uuid-c", "uuid-d"]);

  const { diagnostics } = filterCandidatesForEvaluation(
    candidates,
    1,
    config,
    {
      successCacheDir: "/tmp/success-cache",
      getSuccessfulRemovalUUIDs: () => successfulUUIDs,
      random: () => 0,
    },
  );

  assert(diagnostics?.removalSelection);
  assertEquals(diagnostics.removalSelection.novelCount, 2);
  assertEquals(diagnostics.removalSelection.alreadySuccessfulCount, 2);
});

Deno.test("filterCandidatesForEvaluation: harmful neuron candidates also deprioritised by success cache", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 0,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 2,
    },
  });

  const candidates: DiscoveryCandidate[] = [
    makeRemovalCandidate("uuid-a", 0.001),
    makeHarmfulNeuronCandidate("uuid-b", 0.001),
    makeHarmfulNeuronCandidate("uuid-c", 0.001),
  ];

  // uuid-c is already successful
  const successfulUUIDs = new Set(["uuid-c"]);

  const { filtered } = filterCandidatesForEvaluation(candidates, 1, config, {
    successCacheDir: "/tmp/success-cache",
    getSuccessfulRemovalUUIDs: () => successfulUUIDs,
    random: () => 0,
  });

  const removalFiltered = filtered.filter(
    (c) =>
      c.change.type === "remove-low-impact" ||
      c.change.type === "remove-neuron",
  );

  assertEquals(removalFiltered.length, 2);
  // Should prefer uuid-a and uuid-b (novel) over uuid-c (already successful)
  const selectedUUIDs = removalFiltered.map(
    (c) =>
      c.change.removalCandidate?.neuronUUID ??
        c.change.harmfulNeuronCandidate?.neuronUUID,
  );
  assert(selectedUUIDs.includes("uuid-a"));
  assert(selectedUUIDs.includes("uuid-b"));
  assert(!selectedUUIDs.includes("uuid-c"));
});

Deno.test("filterCandidatesForEvaluation: no diagnostics novelCount when no successCacheDir", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 0,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 2,
    },
  });

  const candidates: DiscoveryCandidate[] = [
    makeRemovalCandidate("uuid-a", 0.001),
    makeRemovalCandidate("uuid-b", 0.002),
  ];

  const { diagnostics } = filterCandidatesForEvaluation(
    candidates,
    1,
    config,
    {
      random: () => 0,
    },
  );

  // Without successCacheDir, novelCount/alreadySuccessfulCount should not be present
  if (diagnostics?.removalSelection) {
    assertEquals(diagnostics.removalSelection.novelCount, undefined);
    assertEquals(
      diagnostics.removalSelection.alreadySuccessfulCount,
      undefined,
    );
  }
});
