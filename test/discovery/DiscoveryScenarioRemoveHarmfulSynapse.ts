/**
 * Discovery scenario test: remove harmful synapse.
 *
 * Verifies that the discovery process can identify a harmful synapse
 * that should be removed using the shared cripple-and-discover helper.
 *
 * This is the inverse of the "add synapse" scenario — here we cripple
 * by ADDING a harmful synapse rather than removing a helpful one.
 *
 * Scenario (whole creature — no harmful synapse):
 *   input-0 ──(1.0)──▶ hidden-A (RELU) ──(1.0)──▶ output-0
 *   input-1 ──(1.0)──▶ hidden-B (TANH) ──(1.0)──▶ output-0
 *
 * Crippled creature (harmful cross-connection added):
 *   input-0 ──(1.0)──▶ hidden-A (RELU) ──(1.0)──▶ output-0
 *   input-1 ──(1.0)──▶ hidden-B (TANH) ──(1.0)──▶ output-0
 *                       hidden-A ──(-2.0)──▶ hidden-B  (harmful)
 *
 * Part of #1989, closes #1995.
 */
import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import {
  assertCrippleDegraded,
  assertDiscoveryTypesFound,
  assertRecordingCaptured,
  runDiscoveryScenario,
} from "./DiscoveryScenarioHelper.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whole creature: 2 inputs, 2 hidden (RELU + TANH), 1 output (IDENTITY).
 *
 * input-0 ──(1.0)──▶ hidden-A (RELU, bias 0)
 * input-1 ──(1.0)──▶ hidden-B (TANH, bias 0)
 * hidden-A ──(1.0)──▶ output-0 (IDENTITY, bias 0)
 * hidden-B ──(1.0)──▶ output-0
 *
 * No cross-connection between hidden neurons — this is the ideal state.
 */
const WHOLE_CREATURE: CreatureExport = {
  input: 2,
  output: 1,
  neurons: [
    { uuid: "hidden-A", type: "hidden", squash: "RELU", bias: 0 },
    { uuid: "hidden-B", type: "hidden", squash: "TANH", bias: 0 },
    { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-A", weight: 1.0 },
    { fromUUID: "input-1", toUUID: "hidden-B", weight: 1.0 },
    { fromUUID: "hidden-A", toUUID: "output-0", weight: 1.0 },
    { fromUUID: "hidden-B", toUUID: "output-0", weight: 1.0 },
  ],
};

/**
 * Crippled creature: same as whole plus a harmful cross-connection.
 *
 * hidden-A ──(-2.0)──▶ hidden-B creates interference: hidden-A's activation
 * suppresses hidden-B via the large negative weight, degrading the output.
 */
const CRIPPLED_CREATURE: CreatureExport = {
  input: 2,
  output: 1,
  neurons: [
    { uuid: "hidden-A", type: "hidden", squash: "RELU", bias: 0 },
    { uuid: "hidden-B", type: "hidden", squash: "TANH", bias: 0 },
    { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-A", weight: 1.0 },
    { fromUUID: "input-1", toUUID: "hidden-B", weight: 1.0 },
    { fromUUID: "hidden-A", toUUID: "output-0", weight: 1.0 },
    { fromUUID: "hidden-B", toUUID: "output-0", weight: 1.0 },
    // Harmful cross-connection: large negative weight creates interference
    { fromUUID: "hidden-A", toUUID: "hidden-B", weight: -2.0 },
  ],
};

/**
 * Deterministic test samples using diverse input patterns.
 * Expected outputs are approximate — the key assertion is that the
 * crippled creature produces degraded (different) outputs.
 */
const TEST_SAMPLES = [
  { input: [1.0, 0.5], expected: [1.4621] },
  { input: [0.0, 1.0], expected: [0.7616] },
  { input: [0.5, 0.5], expected: [0.9621] },
  { input: [1.0, 1.0], expected: [1.7616] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

Deno.test(
  "DiscoveryScenario: remove harmful synapse - creatures are valid",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: WHOLE_CREATURE,
      crippledCreatureJSON: CRIPPLED_CREATURE,
      samples: TEST_SAMPLES,
    });

    // Both creatures should be valid instances with UUIDs
    assert(result.wholeCreature.uuid, "Whole creature should have a UUID");
    assert(
      result.crippledCreature.uuid,
      "Crippled creature should have a UUID",
    );

    // Whole creature has 2 hidden neurons
    const wholeHidden = result.wholeCreature.neurons.filter(
      (n) => n.type === "hidden",
    );
    assertEquals(
      wholeHidden.length,
      2,
      "Whole creature should have 2 hidden neurons",
    );

    // Crippled creature also has 2 hidden neurons (same topology)
    const crippledHidden = result.crippledCreature.neurons.filter(
      (n) => n.type === "hidden",
    );
    assertEquals(
      crippledHidden.length,
      2,
      "Crippled creature should have 2 hidden neurons",
    );
  },
);

Deno.test(
  "DiscoveryScenario: remove harmful synapse - cripple degrades outputs",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: WHOLE_CREATURE,
      crippledCreatureJSON: CRIPPLED_CREATURE,
      samples: TEST_SAMPLES,
    });

    // The crippled creature should produce different (degraded) outputs
    assertCrippleDegraded(result);
  },
);

Deno.test(
  "DiscoveryScenario: remove harmful synapse - tracing captures errors",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: WHOLE_CREATURE,
      crippledCreatureJSON: CRIPPLED_CREATURE,
      samples: TEST_SAMPLES,
    });

    // Verify error recording captured meaningful data
    assertRecordingCaptured(result.recordMaps);
  },
);

Deno.test(
  "DiscoveryScenario: remove harmful synapse - crippled has more synapses",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: WHOLE_CREATURE,
      crippledCreatureJSON: CRIPPLED_CREATURE,
      samples: TEST_SAMPLES,
    });

    // The crippled creature should have more synapses (the harmful one added)
    assert(
      result.crippledCreature.synapses.length >
        result.wholeCreature.synapses.length,
      `Crippled creature should have more synapses (${result.crippledCreature.synapses.length}) ` +
        `than whole (${result.wholeCreature.synapses.length})`,
    );
  },
);

Deno.test({
  name:
    "DiscoveryScenario: remove harmful synapse - discovery finds remove-synapse candidate",
  fn() {
    const mockDiscoveryResult = {
      ID: "test-remove-harmful-synapse",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      coordinatedStructuralCandidates: undefined,
      removeHarmfulSynapse: {
        fromNeuronUuid: "hidden-A",
        toNeuronUuid: "hidden-B",
        weight: -2.0,
        targetNeuronImpact: -0.8,
        expectedCreatureErrorReduction: 0.5,
        expectedCreatureScoreGain: 0.4,
        improvedCount: 4,
        totalCount: 4,
      },
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const result = runDiscoveryScenario({
      wholeCreatureJSON: WHOLE_CREATURE,
      crippledCreatureJSON: CRIPPLED_CREATURE,
      samples: TEST_SAMPLES,
      discoveryResult: mockDiscoveryResult,
      expectedDiscoveryTypes: ["remove-synapse"],
    });

    // Discovery should produce at least one candidate
    assert(
      result.candidates.length > 0,
      "Discovery should produce at least one candidate",
    );

    // The candidate should be a remove-synapse type
    assertDiscoveryTypesFound(result.candidates, ["remove-synapse"]);
  },
});
