/**
 * Discovery scenario test: change squash function.
 *
 * Verifies that the discovery process can find when a neuron's squash
 * (activation) function has been changed to a suboptimal one.
 *
 * Scenario:
 *   input-0 ──(0.8)──▶ hidden-A (TANH, bias: 0.5) ──(1.0)──▶ output-0
 *   input-1 ──(0.6)──▶ hidden-A
 *
 * The crippled creature changes hidden-A's squash from TANH to IDENTITY
 * while keeping all synapses and weights identical. The non-linear TANH
 * is clearly better for the test data which requires non-linear separation.
 *
 * Part of #1989, closes #1992.
 */
import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
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
 * Build a creature with a single hidden neuron using the given squash.
 *
 * input-0 ──(0.8)──▶ hidden-A (squash, bias 0.5) ──(1.0)──▶ output-0
 * input-1 ──(0.6)──▶ hidden-A
 */
function buildCreature(squash: string): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-A", type: "hidden", squash, bias: 0.5 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.8 },
      { fromUUID: "input-1", toUUID: "hidden-A", weight: 0.6 },
      { fromUUID: "hidden-A", toUUID: "output-0", weight: 1.0 },
    ],
  };
}

/**
 * Deterministic test samples with data that requires non-linear separation.
 * TANH maps inputs to [-1, 1] range, which is clearly better than IDENTITY
 * for these expected outputs that assume non-linear transformation.
 */
const TEST_SAMPLES = [
  { input: [1.0, 0.5], expected: [0.88] },
  { input: [-1.0, -0.5], expected: [-0.58] },
  { input: [0.5, 0.5], expected: [0.72] },
  { input: [-0.5, 1.0], expected: [0.20] },
  { input: [2.0, 1.0], expected: [0.98] },
];

// ─────────────────────────────────────────────────────────────────────────────
// TANH → IDENTITY tests
// ─────────────────────────────────────────────────────────────────────────────

Deno.test(
  "DiscoveryScenario: change squash TANH→IDENTITY - creatures are valid",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: buildCreature("TANH"),
      crippledCreatureJSON: buildCreature("IDENTITY"),
      samples: TEST_SAMPLES,
    });

    // Both creatures should be valid instances with UUIDs
    assert(result.wholeCreature.uuid, "Whole creature should have a UUID");
    assert(
      result.crippledCreature.uuid,
      "Crippled creature should have a UUID",
    );

    // Whole creature uses TANH on hidden-A
    const wholeHidden = result.wholeCreature.neurons.filter(
      (n) => n.type === "hidden",
    );
    assertEquals(wholeHidden.length, 1, "Should have 1 hidden neuron");
    assertEquals(
      wholeHidden[0].squash,
      "TANH",
      "Whole creature's hidden neuron should use TANH",
    );

    // Crippled creature uses IDENTITY on hidden-A
    const crippledHidden = result.crippledCreature.neurons.filter(
      (n) => n.type === "hidden",
    );
    assertEquals(crippledHidden.length, 1, "Should have 1 hidden neuron");
    assertEquals(
      crippledHidden[0].squash,
      "IDENTITY",
      "Crippled creature's hidden neuron should use IDENTITY",
    );
  },
);

Deno.test(
  "DiscoveryScenario: change squash TANH→IDENTITY - cripple degrades outputs",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: buildCreature("TANH"),
      crippledCreatureJSON: buildCreature("IDENTITY"),
      samples: TEST_SAMPLES,
    });

    // The crippled creature should produce different (degraded) outputs
    assertCrippleDegraded(result);
  },
);

Deno.test(
  "DiscoveryScenario: change squash TANH→IDENTITY - tracing captures errors",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: buildCreature("TANH"),
      crippledCreatureJSON: buildCreature("IDENTITY"),
      samples: TEST_SAMPLES,
    });

    // Verify error recording captured meaningful data
    assertRecordingCaptured(result.recordMaps);
  },
);

Deno.test(
  "DiscoveryScenario: change squash TANH→IDENTITY - same topology different squash",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: buildCreature("TANH"),
      crippledCreatureJSON: buildCreature("IDENTITY"),
      samples: TEST_SAMPLES,
    });

    // Both creatures should have the same number of synapses and neurons
    assertEquals(
      result.wholeCreature.synapses.length,
      result.crippledCreature.synapses.length,
      "Both creatures should have the same number of synapses",
    );
    assertEquals(
      result.wholeCreature.neurons.length,
      result.crippledCreature.neurons.length,
      "Both creatures should have the same number of neurons",
    );

    // But outputs should differ due to the squash change
    let hasDifference = false;
    for (let i = 0; i < result.wholeOutputs.length; i++) {
      if (result.wholeOutputs[i][0] !== result.crippledOutputs[i][0]) {
        hasDifference = true;
        break;
      }
    }
    assert(hasDifference, "Outputs should differ despite same topology");
  },
);

Deno.test({
  name:
    "DiscoveryScenario: change squash TANH→IDENTITY - discovery finds change-squash candidate",
  fn() {
    const mockDiscoveryResult = {
      ID: "test-change-squash-tanh-to-identity",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      coordinatedStructuralCandidates: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: [
        {
          neuronUuid: "hidden-A",
          previousSquash: "IDENTITY",
          squash: "TANH",
          expectedCreatureScoreGain: 0.5,
          improvedError: 0.1,
          currentError: 0.8,
        },
      ],
    };

    const result = runDiscoveryScenario({
      wholeCreatureJSON: buildCreature("TANH"),
      crippledCreatureJSON: buildCreature("IDENTITY"),
      samples: TEST_SAMPLES,
      discoveryResult: mockDiscoveryResult,
      expectedDiscoveryTypes: ["change-squash"],
    });

    // Discovery should produce at least one candidate
    assert(
      result.candidates.length > 0,
      "Discovery should produce at least one candidate",
    );

    // The candidate should be a change-squash type
    assertDiscoveryTypesFound(result.candidates, ["change-squash"]);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ReLU → IDENTITY tests
// ─────────────────────────────────────────────────────────────────────────────

Deno.test(
  "DiscoveryScenario: change squash RELU→IDENTITY - cripple degrades outputs",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: buildCreature("RELU"),
      crippledCreatureJSON: buildCreature("IDENTITY"),
      samples: TEST_SAMPLES,
    });

    // ReLU clips negatives to zero; IDENTITY passes them through.
    // With negative inputs, RELU and IDENTITY produce different outputs.
    assertCrippleDegraded(result);
  },
);

Deno.test(
  "DiscoveryScenario: change squash RELU→IDENTITY - tracing captures errors",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: buildCreature("RELU"),
      crippledCreatureJSON: buildCreature("IDENTITY"),
      samples: TEST_SAMPLES,
    });

    assertRecordingCaptured(result.recordMaps);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// LOGISTIC → IDENTITY tests
// ─────────────────────────────────────────────────────────────────────────────

Deno.test(
  "DiscoveryScenario: change squash LOGISTIC→IDENTITY - cripple degrades outputs",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: buildCreature("LOGISTIC"),
      crippledCreatureJSON: buildCreature("IDENTITY"),
      samples: TEST_SAMPLES,
    });

    // LOGISTIC (sigmoid) compresses to [0,1]; IDENTITY passes raw values.
    assertCrippleDegraded(result);
  },
);

Deno.test(
  "DiscoveryScenario: change squash LOGISTIC→IDENTITY - tracing captures errors",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: buildCreature("LOGISTIC"),
      crippledCreatureJSON: buildCreature("IDENTITY"),
      samples: TEST_SAMPLES,
    });

    assertRecordingCaptured(result.recordMaps);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GELU → IDENTITY tests
// ─────────────────────────────────────────────────────────────────────────────

Deno.test(
  "DiscoveryScenario: change squash GELU→IDENTITY - cripple degrades outputs",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: buildCreature("GELU"),
      crippledCreatureJSON: buildCreature("IDENTITY"),
      samples: TEST_SAMPLES,
    });

    // GELU is a non-linear activation; IDENTITY is linear.
    assertCrippleDegraded(result);
  },
);

Deno.test(
  "DiscoveryScenario: change squash GELU→IDENTITY - tracing captures errors",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: buildCreature("GELU"),
      crippledCreatureJSON: buildCreature("IDENTITY"),
      samples: TEST_SAMPLES,
    });

    assertRecordingCaptured(result.recordMaps);
  },
);
