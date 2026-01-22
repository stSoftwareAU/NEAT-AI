/**
 * Tests for Issue #1150: Discovery replay summary logging
 *
 * This test file verifies that:
 * 1. Replay summary is logged when a replay completes
 * 2. Successful candidates are logged in verbose mode
 * 3. No improvement case is logged correctly
 * 4. Timeout status is shown in the summary
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { stub } from "@std/testing/mock";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { DiscoveryReplayDirResult } from "../../src/discovery/DiscoveryReplayRunner.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { Neat } from "../../src/NEAT/Neat.ts";

/**
 * Creates a base creature for testing.
 */
function makeBaseCreature(): Creature {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
    ],
  };
  return Creature.fromJSON(base);
}

/**
 * Creates a minimal Neat instance for testing logReplaySummary
 */
function createMinimalNeat(verbose = false): Neat {
  // Use simple input/output counts, empty workers array for unit tests
  return new Neat(1, 1, {
    verbose,
    costOfGrowth: 0,
    elitism: 1,
    populationSize: 2,
  }, []);
}

Deno.test("logReplaySummary - logs improvement with change type and score delta", () => {
  const neat = createMinimalNeat();
  const logged: string[] = [];

  const infoStub = stub(console, "info", (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });

  try {
    const result: DiscoveryReplayDirResult = {
      original: { error: 0.5, score: 0.5 },
      improvement: {
        key: "test-key",
        changeType: "add-synapses",
        error: 0.4,
        score: 0.6,
        scoreDelta: 0.1,
        message: "Improved!",
        creature: makeBaseCreature().exportJSON(),
      },
      evaluatedSingles: 5,
      evaluatedCombos: 2,
      pruned: 1,
      skippedAlreadyApplied: 0,
      skippedNotApplicable: 0,
    };

    neat.logReplaySummary(result);

    // Should have logged the improvement
    assertEquals(logged.length >= 1, true, "Should have at least one log");

    // Check the improvement message contains expected information
    const improvementLog = logged.find((l) =>
      l.includes("Discovery replay") && l.includes("improved")
    );
    assertEquals(
      improvementLog !== undefined,
      true,
      "Should log improvement message",
    );
    assertStringIncludes(
      improvementLog!,
      "add-synapses",
      "Should include change type",
    );
    assertStringIncludes(
      improvementLog!,
      "evaluated: 7",
      "Should include total evaluated count",
    );
    assertStringIncludes(
      improvementLog!,
      "singles: 5",
      "Should include singles count",
    );
    assertStringIncludes(
      improvementLog!,
      "combos: 2",
      "Should include combos count",
    );
    assertStringIncludes(
      improvementLog!,
      "pruned: 1",
      "Should include pruned count",
    );
  } finally {
    infoStub.restore();
  }
});

Deno.test("logReplaySummary - logs no improvement case correctly", () => {
  const neat = createMinimalNeat();
  const logged: string[] = [];

  const infoStub = stub(console, "info", (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });

  try {
    const result: DiscoveryReplayDirResult = {
      original: { error: 0.5, score: 0.5 },
      evaluatedSingles: 10,
      evaluatedCombos: 0,
      pruned: 3,
      skippedAlreadyApplied: 2,
      skippedNotApplicable: 1,
    };

    neat.logReplaySummary(result);

    // Should have logged the no-improvement message
    const noImprovementLog = logged.find((l) =>
      l.includes("Discovery replay") && l.includes("no improvement")
    );
    assertEquals(
      noImprovementLog !== undefined,
      true,
      "Should log no improvement message",
    );
    assertStringIncludes(
      noImprovementLog!,
      "evaluated: 10",
      "Should include total evaluated count",
    );
    assertStringIncludes(
      noImprovementLog!,
      "pruned: 3",
      "Should include pruned count",
    );
    assertStringIncludes(
      noImprovementLog!,
      "already-applied: 2",
      "Should include already-applied count",
    );
    assertStringIncludes(
      noImprovementLog!,
      "not-applicable: 1",
      "Should include not-applicable count",
    );
  } finally {
    infoStub.restore();
  }
});

Deno.test("logReplaySummary - logs timeout status", () => {
  const neat = createMinimalNeat();
  const logged: string[] = [];

  const infoStub = stub(console, "info", (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });

  try {
    const result: DiscoveryReplayDirResult = {
      original: { error: 0.5, score: 0.5 },
      evaluatedSingles: 3,
      evaluatedCombos: 0,
      pruned: 0,
      skippedAlreadyApplied: 0,
      skippedNotApplicable: 0,
      timedOut: true,
    };

    neat.logReplaySummary(result);

    // Should include timeout indicator
    const log = logged.find((l) => l.includes("Discovery replay"));
    assertEquals(log !== undefined, true, "Should log replay message");
    assertStringIncludes(log!, "(timed out)", "Should include timeout status");
  } finally {
    infoStub.restore();
  }
});

Deno.test("logReplaySummary - logs successful candidates in verbose mode", () => {
  const neat = createMinimalNeat(true); // Enable verbose mode
  const logged: string[] = [];

  const infoStub = stub(console, "info", (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });

  try {
    const result: DiscoveryReplayDirResult = {
      original: { error: 0.5, score: 0.5 },
      improvement: {
        key: "best-key",
        changeType: "remove-low-impact",
        error: 0.4,
        score: 0.6,
        scoreDelta: 0.1,
        message: "Best improvement!",
        creature: makeBaseCreature().exportJSON(),
      },
      evaluatedSingles: 5,
      evaluatedCombos: 2,
      pruned: 0,
      skippedAlreadyApplied: 0,
      skippedNotApplicable: 0,
      evaluations: [
        {
          kind: "original",
          score: 0.5,
          error: 0.5,
          improved: false,
        },
        {
          kind: "single",
          key: "add-syn-1",
          changeType: "add-synapses",
          description: "Added synapse input-0 -> output-0",
          score: 0.55,
          error: 0.45,
          scoreDelta: 0.05,
          improved: true,
        },
        {
          kind: "single",
          key: "remove-1",
          changeType: "remove-low-impact",
          description: "Removed hidden-0",
          score: 0.6,
          error: 0.4,
          scoreDelta: 0.1,
          improved: true,
        },
        {
          kind: "combo",
          changeType: "combo",
          description: "Combined: add-synapses + remove-low-impact",
          score: 0.58,
          error: 0.42,
          scoreDelta: 0.08,
          improved: true,
        },
      ],
    };

    neat.logReplaySummary(result);

    // Should log successful candidates header
    const candidatesHeader = logged.find((l) =>
      l.includes("Successful replay candidates")
    );
    assertEquals(
      candidatesHeader !== undefined,
      true,
      "Should log successful candidates header in verbose mode",
    );

    // Should log each successful candidate
    const addSynapseLog = logged.find((l) =>
      l.includes("add-synapses") && l.includes("Added synapse")
    );
    assertEquals(
      addSynapseLog !== undefined,
      true,
      "Should log add-synapses candidate",
    );

    const removeLog = logged.find((l) =>
      l.includes("remove-low-impact") && l.includes("Removed hidden-0")
    );
    assertEquals(
      removeLog !== undefined,
      true,
      "Should log remove-low-impact candidate",
    );

    const comboLog = logged.find((l) =>
      l.includes("[combo]") && l.includes("Combined:")
    );
    assertEquals(comboLog !== undefined, true, "Should log combo candidate");
  } finally {
    infoStub.restore();
  }
});

Deno.test("logReplaySummary - does not log candidates when not in verbose mode", () => {
  const neat = createMinimalNeat(false); // Disable verbose mode
  const logged: string[] = [];

  const infoStub = stub(console, "info", (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });

  try {
    const result: DiscoveryReplayDirResult = {
      original: { error: 0.5, score: 0.5 },
      improvement: {
        key: "best-key",
        changeType: "add-synapses",
        error: 0.4,
        score: 0.6,
        scoreDelta: 0.1,
        message: "Best improvement!",
        creature: makeBaseCreature().exportJSON(),
      },
      evaluatedSingles: 5,
      evaluatedCombos: 0,
      pruned: 0,
      skippedAlreadyApplied: 0,
      skippedNotApplicable: 0,
      evaluations: [
        {
          kind: "single",
          key: "add-syn-1",
          changeType: "add-synapses",
          description: "Added synapse",
          score: 0.6,
          error: 0.4,
          scoreDelta: 0.1,
          improved: true,
        },
      ],
    };

    neat.logReplaySummary(result);

    // Should only have the main summary log, not the candidates header
    const candidatesHeader = logged.find((l) =>
      l.includes("Successful replay candidates")
    );
    assertEquals(
      candidatesHeader,
      undefined,
      "Should not log successful candidates header when not in verbose mode",
    );

    // Should still log the main summary
    const summaryLog = logged.find((l) => l.includes("Discovery replay"));
    assertEquals(
      summaryLog !== undefined,
      true,
      "Should still log the main summary",
    );
  } finally {
    infoStub.restore();
  }
});

Deno.test("logReplaySummary - handles minimal result with zeros correctly", () => {
  const neat = createMinimalNeat();
  const logged: string[] = [];

  const infoStub = stub(console, "info", (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });

  try {
    const result: DiscoveryReplayDirResult = {
      original: { error: 0.5, score: 0.5 },
      evaluatedSingles: 0,
      evaluatedCombos: 0,
      pruned: 0,
      skippedAlreadyApplied: 0,
      skippedNotApplicable: 0,
    };

    neat.logReplaySummary(result);

    // Should log a minimal summary
    const log = logged.find((l) => l.includes("Discovery replay"));
    assertEquals(log !== undefined, true, "Should log replay message");
    assertStringIncludes(log!, "evaluated: 0", "Should show zero evaluated");
    assertStringIncludes(log!, "no improvement", "Should show no improvement");

    // Should not include zero counts for optional fields
    assertEquals(
      log!.includes("pruned:"),
      false,
      "Should not include pruned when zero",
    );
    assertEquals(
      log!.includes("already-applied:"),
      false,
      "Should not include already-applied when zero",
    );
  } finally {
    infoStub.restore();
  }
});
