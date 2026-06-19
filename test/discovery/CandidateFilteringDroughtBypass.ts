/**
 * Tests for the failure-cache drought bypass in candidate filtering (Issue #3072).
 *
 * When the Rust discovery engine signals a drought escalation (novelty
 * escalation active or the creature drought alarm), the candidate filter must
 * re-admit the top-K failure-cache hits for evaluation rather than dropping
 * them. Without this, a plateaued creature whose candidates are all cached as
 * failures would never have a single candidate reach Phase-1 evaluation.
 */

import { assert, assertEquals } from "@std/assert";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { Creature } from "@creature";
import type {
  DiscoveryCandidate,
  DiscoveryChangeType,
} from "@discovery/DiscoveryCandidates.ts";
import { filterCandidatesForEvaluation } from "@discovery/CandidateFiltering.ts";

function makeConfig(overrides: NeatOptions = {}) {
  return createNeatConfig(overrides);
}

function makeCandidate(
  type: DiscoveryChangeType,
  expected: number,
  description: string,
): DiscoveryCandidate {
  return {
    creature: {} as unknown as Creature,
    change: { type, expectedErrorReduction: expected, description },
  };
}

const ALL_CACHED = () => true;

Deno.test("filterCandidatesForEvaluation: drought bypass re-admits cached candidates for evaluation", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 1,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 0,
    },
  });

  // Every candidate is a failure-cache hit (drought scenario).
  const candidates: DiscoveryCandidate[] = [
    makeCandidate("add-neurons", 0.2, "cached-1"),
    makeCandidate("add-neurons", 0.5, "cached-2"),
  ];

  const { filtered, diagnostics } = filterCandidatesForEvaluation(
    candidates,
    1,
    config,
    {
      failureCacheDir: "/tmp/failure-cache",
      isCandidateCached: ALL_CACHED,
      random: () => 0,
      droughtEscalationActive: true,
    },
  );

  // At least one candidate must reach evaluation despite the full failure cache.
  assert(filtered.length >= 1, "expected at least one candidate after bypass");
  assertEquals(diagnostics?.failureCacheBypass?.count, 1);
});

Deno.test("filterCandidatesForEvaluation: drought bypass selects the highest-value cached candidate", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 1,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 0,
    },
  });

  const candidates: DiscoveryCandidate[] = [
    makeCandidate("add-neurons", 0.1, "low"),
    makeCandidate("add-neurons", 0.9, "high"),
    makeCandidate("add-neurons", 0.4, "mid"),
  ];

  // threadCount 1 → top-K = 1, so only the highest expected reduction is rescued.
  const { filtered, diagnostics } = filterCandidatesForEvaluation(
    candidates,
    1,
    config,
    {
      failureCacheDir: "/tmp/failure-cache",
      isCandidateCached: ALL_CACHED,
      random: () => 0,
      droughtEscalationActive: true,
    },
  );

  assertEquals(diagnostics?.failureCacheBypass?.count, 1);
  assertEquals(filtered.length, 1);
  assertEquals(filtered[0].change.description, "high");
});

Deno.test("filterCandidatesForEvaluation: top-K scales with thread count", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 2,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 0,
    },
  });

  const candidates: DiscoveryCandidate[] = [
    makeCandidate("add-neurons", 0.1, "c1"),
    makeCandidate("add-neurons", 0.9, "c2"),
    makeCandidate("add-neurons", 0.4, "c3"),
  ];

  // threadCount 2 → top-K = 2 cached candidates re-admitted.
  const { diagnostics } = filterCandidatesForEvaluation(candidates, 2, config, {
    failureCacheDir: "/tmp/failure-cache",
    isCandidateCached: ALL_CACHED,
    random: () => 0,
    droughtEscalationActive: true,
  });

  assertEquals(diagnostics?.failureCacheBypass?.count, 2);
});

Deno.test("filterCandidatesForEvaluation: no bypass when drought escalation inactive", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 1,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 0,
    },
  });

  const candidates: DiscoveryCandidate[] = [
    makeCandidate("add-neurons", 0.2, "cached-1"),
    makeCandidate("add-neurons", 0.5, "cached-2"),
  ];

  // Drought not active → cached candidates dropped as before.
  const { filtered, diagnostics } = filterCandidatesForEvaluation(
    candidates,
    1,
    config,
    {
      failureCacheDir: "/tmp/failure-cache",
      isCandidateCached: ALL_CACHED,
      random: () => 0,
      droughtEscalationActive: false,
    },
  );

  assertEquals(filtered.length, 0);
  assertEquals(diagnostics?.failureCacheBypass, undefined);
});

Deno.test("filterCandidatesForEvaluation: no bypass when option disabled even during drought", () => {
  const config = makeConfig({
    discoveryFailureCacheBypassOnDrought: false,
    discoveryMinCandidatesPerCategory: {
      addNeurons: 1,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 0,
    },
  });

  const candidates: DiscoveryCandidate[] = [
    makeCandidate("add-neurons", 0.2, "cached-1"),
    makeCandidate("add-neurons", 0.5, "cached-2"),
  ];

  const { filtered, diagnostics } = filterCandidatesForEvaluation(
    candidates,
    1,
    config,
    {
      failureCacheDir: "/tmp/failure-cache",
      isCandidateCached: ALL_CACHED,
      random: () => 0,
      droughtEscalationActive: true,
    },
  );

  assertEquals(filtered.length, 0);
  assertEquals(diagnostics?.failureCacheBypass, undefined);
});

Deno.test("filterCandidatesForEvaluation: non-cached candidates are unaffected by drought bypass", () => {
  const config = makeConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 1,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 0,
    },
  });

  const candidates: DiscoveryCandidate[] = [
    makeCandidate("add-neurons", 0.2, "fresh-1"),
    makeCandidate("add-neurons", 0.5, "fresh-2"),
  ];

  // Nothing is cached → bypass is a no-op, both fresh candidates flow through.
  const { filtered, diagnostics } = filterCandidatesForEvaluation(
    candidates,
    1,
    config,
    {
      failureCacheDir: "/tmp/failure-cache",
      isCandidateCached: () => false,
      random: () => 0,
      droughtEscalationActive: true,
    },
  );

  assertEquals(filtered.length, 2);
  assertEquals(diagnostics?.failureCacheBypass, undefined);
});

Deno.test("createNeatConfig: discoveryFailureCacheBypassOnDrought defaults to true", () => {
  const config = createNeatConfig({});
  assertEquals(config.discoveryFailureCacheBypassOnDrought, true);
});
