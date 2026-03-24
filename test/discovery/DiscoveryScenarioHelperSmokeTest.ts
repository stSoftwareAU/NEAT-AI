/**
 * Smoke tests for the DiscoveryScenarioHelper utility.
 *
 * These tests verify that the shared "cripple and discover" helper
 * correctly orchestrates the full discovery scenario workflow:
 * validating creatures, recording outputs, tracing errors, and
 * building candidates.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import {
  assertCrippleDegraded,
  assertRecordingCaptured,
  discoverySkipReason,
  runDiscoveryScenario,
  traceAllConfig,
} from "./DiscoveryScenarioHelper.ts";
import { Creature } from "../../src/Creature.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures: a trivial "whole" creature and a "crippled" variant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whole creature: 2 inputs, 1 hidden (IDENTITY, bias 0), 1 output (IDENTITY, bias 0).
 *
 * input-0 ──(0.5)──▶ hidden-1 ──(1.0)──▶ output-0
 * input-1 ──(0.5)──▶ hidden-1
 *
 * For input [1, 1]: hidden = 0.5*1 + 0.5*1 = 1.0, output = 1.0*1.0 = 1.0
 */
const WHOLE_CREATURE: CreatureExport = {
  input: 2,
  output: 1,
  neurons: [
    { uuid: "hidden-1", type: "hidden", squash: "IDENTITY", bias: 0 },
    { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
    { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.5 },
    { fromUUID: "hidden-1", toUUID: "output-0", weight: 1.0 },
  ],
};

/**
 * Crippled creature: same topology but the input-1 → hidden-1 synapse
 * is removed, degrading the creature's ability to use the second input.
 *
 * input-0 ──(0.5)──▶ hidden-1 ──(1.0)──▶ output-0
 *
 * For input [1, 1]: hidden = 0.5*1 = 0.5, output = 1.0*0.5 = 0.5
 */
const CRIPPLED_CREATURE: CreatureExport = {
  input: 2,
  output: 1,
  neurons: [
    { uuid: "hidden-1", type: "hidden", squash: "IDENTITY", bias: 0 },
    { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
    { fromUUID: "hidden-1", toUUID: "output-0", weight: 1.0 },
  ],
};

/** Deterministic test samples where the second input matters. */
const TEST_SAMPLES = [
  { input: [1, 1], expected: [1.0] },
  { input: [0, 2], expected: [1.0] },
  { input: [1, 0], expected: [0.5] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("DiscoveryScenarioHelper: runDiscoveryScenario returns valid results", () => {
  const result = runDiscoveryScenario({
    wholeCreatureJSON: WHOLE_CREATURE,
    crippledCreatureJSON: CRIPPLED_CREATURE,
    samples: TEST_SAMPLES,
  });

  // Both creatures should be valid instances
  assert(result.wholeCreature instanceof Creature);
  assert(result.crippledCreature instanceof Creature);

  // Should have one output per sample
  assertEquals(result.wholeOutputs.length, TEST_SAMPLES.length);
  assertEquals(result.crippledOutputs.length, TEST_SAMPLES.length);
  assertEquals(result.recordMaps.length, TEST_SAMPLES.length);

  // No discovery result provided, so no candidates
  assertEquals(result.candidates.length, 0);
});

Deno.test("DiscoveryScenarioHelper: whole and crippled creatures produce different outputs", () => {
  const result = runDiscoveryScenario({
    wholeCreatureJSON: WHOLE_CREATURE,
    crippledCreatureJSON: CRIPPLED_CREATURE,
    samples: TEST_SAMPLES,
  });

  // For input [1, 1]: whole outputs 1.0, crippled outputs 0.5
  assertNotEquals(
    result.wholeOutputs[0][0],
    result.crippledOutputs[0][0],
    "Outputs should differ for sample [1, 1]",
  );

  // For input [0, 2]: whole outputs 1.0, crippled outputs 0.0
  assertNotEquals(
    result.wholeOutputs[1][0],
    result.crippledOutputs[1][0],
    "Outputs should differ for sample [0, 2]",
  );
});

Deno.test("DiscoveryScenarioHelper: assertCrippleDegraded succeeds for degraded creature", () => {
  const result = runDiscoveryScenario({
    wholeCreatureJSON: WHOLE_CREATURE,
    crippledCreatureJSON: CRIPPLED_CREATURE,
    samples: TEST_SAMPLES,
  });

  // Should not throw — the crippled creature does produce different outputs
  assertCrippleDegraded(result);
});

Deno.test("DiscoveryScenarioHelper: tracing captures error records", () => {
  const result = runDiscoveryScenario({
    wholeCreatureJSON: WHOLE_CREATURE,
    crippledCreatureJSON: CRIPPLED_CREATURE,
    samples: TEST_SAMPLES,
  });

  // Should not throw — tracing should have captured errors
  assertRecordingCaptured(result.recordMaps);
});

Deno.test("DiscoveryScenarioHelper: traceAllConfig creates valid sparse config", () => {
  const creature = Creature.fromJSON(WHOLE_CREATURE);
  const config = traceAllConfig(creature);
  assert(config, "traceAllConfig should return a SparseConfig");
});

Deno.test("DiscoveryScenarioHelper: discoverySkipReason formats correctly", () => {
  const reason = discoverySkipReason(42, "synapse discovery not yet supported");
  assert(reason.includes("42"), "Should include issue number");
  assert(
    reason.includes("NEAT-AI-Discovery"),
    "Should reference the repository",
  );
  assert(
    reason.includes("synapse discovery not yet supported"),
    "Should include description",
  );
});

Deno.test("DiscoveryScenarioHelper: creatures are validated and have UUIDs", () => {
  const result = runDiscoveryScenario({
    wholeCreatureJSON: WHOLE_CREATURE,
    crippledCreatureJSON: CRIPPLED_CREATURE,
    samples: [{ input: [1, 0], expected: [0.5] }],
  });

  assert(result.wholeCreature.uuid, "Whole creature should have a UUID");
  assert(result.crippledCreature.uuid, "Crippled creature should have a UUID");
});
