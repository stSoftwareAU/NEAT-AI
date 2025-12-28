import { assert, assertEquals } from "@std/assert";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import type { Creature } from "../../src/Creature.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
import type { DiscoveryChangeType } from "../../src/discovery/DiscoveryCandidates.ts";
import { filterCandidatesForEvaluation } from "../../src/discovery/DiscoveryRunner.ts";

function makeConfig(overrides: NeatOptions = {}) {
  return createNeatConfig(overrides);
}

function makeCandidate(
  type: DiscoveryChangeType,
  expected: number | undefined,
  description: string,
): DiscoveryCandidate {
  return {
    // The selection helper is intentionally pure and does not touch the creature.
    // We stub it here to keep the tests small and focused.
    creature: {} as unknown as Creature,
    change: { type, expectedErrorReduction: expected, description },
  };
}

Deno.test("filterCandidatesForEvaluation: cached candidates are never selected", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 1,
      addSynapses: 1,
      changeSquash: 1,
      removeLowImpact: 0,
    },
  });

  const candidates: DiscoveryCandidate[] = [
    makeCandidate("add-neurons", 0.2, "ok-add-neurons"),
    makeCandidate("add-synapses", 0.9, "CACHED"),
    makeCandidate("change-squash", 0.1, "ok-change-squash"),
  ];

  const { filtered } = filterCandidatesForEvaluation(candidates, 1, config, {
    failureCacheDir: "/tmp/does-not-matter",
    isCandidateCached: (_dir: string, candidate: DiscoveryCandidate) =>
      candidate.change.description === "CACHED",
    random: () => 0,
  });

  assert(
    filtered.every((c: DiscoveryCandidate) =>
      c.change.description !== "CACHED"
    ),
  );
});

Deno.test("filterCandidatesForEvaluation: ensures category coverage (minPerCategory)", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 1,
      addSynapses: 1,
      changeSquash: 1,
      removeLowImpact: 0,
    },
  });

  const candidates: DiscoveryCandidate[] = [
    makeCandidate("add-neurons", 0.2, "n1"),
    makeCandidate("add-synapses", 0.3, "s1"),
    makeCandidate("change-squash", 0.4, "q1"),
    // Extra candidates should not break coverage.
    makeCandidate("add-neurons", 0.1, "n2"),
    makeCandidate("add-synapses", 0.1, "s2"),
    makeCandidate("change-squash", 0.1, "q2"),
  ];

  const { filtered } = filterCandidatesForEvaluation(candidates, 1, config, {
    random: () => 0,
  });

  const selectedTypes = new Set(
    filtered.map((c: DiscoveryCandidate) => c.change.type),
  );
  assert(selectedTypes.has("add-neurons"));
  assert(selectedTypes.has("add-synapses"));
  assert(selectedTypes.has("change-squash"));
  assertEquals(filtered.length, 3);
});

Deno.test("filterCandidatesForEvaluation: weighted selection is deterministic with random=() => 0", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 0,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 0,
    },
  });

  const candidates: DiscoveryCandidate[] = [
    makeCandidate("add-synapses", 0.1, "w0.1"),
    makeCandidate("add-synapses", 0.2, "w0.2"),
    makeCandidate("add-synapses", 0.3, "w0.3"),
    makeCandidate("add-synapses", 0.4, "w0.4"),
    makeCandidate("add-synapses", 0.5, "w0.5"),
  ];

  const { filtered } = filterCandidatesForEvaluation(candidates, 1, config, {
    random: () => 0,
  });

  // threadCount=1 => maxCandidates=max(2*1, categories=1)=2
  assertEquals(
    filtered.map((c: DiscoveryCandidate) => c.change.description),
    ["w0.5", "w0.4"],
  );
});

Deno.test("filterCandidatesForEvaluation: no-positive-weights falls back to stable uniform selection", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 0,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 0,
    },
  });

  const candidates: DiscoveryCandidate[] = [
    makeCandidate("add-synapses", undefined, "a"),
    makeCandidate("add-synapses", 0, "b"),
    makeCandidate("add-synapses", undefined, "c"),
    makeCandidate("add-synapses", 0, "d"),
  ];

  const { filtered } = filterCandidatesForEvaluation(candidates, 1, config, {
    random: () => 0,
  });

  assertEquals(
    filtered.map((c: DiscoveryCandidate) => c.change.description),
    ["a", "b"],
  );
});
