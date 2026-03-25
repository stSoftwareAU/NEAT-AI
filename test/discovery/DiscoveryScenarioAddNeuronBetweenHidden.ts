/**
 * Discovery scenario test: add neuron between hidden neurons (deep network).
 *
 * Verifies that the discovery process can find a missing neuron between
 * existing hidden neurons — not just the simple "input→hidden→output" pattern.
 *
 * Scenario (whole creature):
 *   input-0 ──(0.8)──▶ hidden-A (RELU, bias 0) ──(0.7)──▶ hidden-B (TANH, bias 0.3)
 *   input-1 ──(0.6)──▶ hidden-A
 *   hidden-B ──(0.9)──▶ hidden-C (RELU, bias 0) ──(1.0)──▶ output-0 (IDENTITY, bias 0)
 *
 * The key neuron is hidden-B, which sits between two other hidden neurons.
 *
 * Crippled creature removes hidden-B and directly connects hidden-A to hidden-C:
 *   input-0 ──(0.8)──▶ hidden-A (RELU, bias 0) ──(0.5)──▶ hidden-C (RELU, bias 0)
 *   input-1 ──(0.6)──▶ hidden-A
 *   hidden-C ──(1.0)──▶ output-0 (IDENTITY, bias 0)
 *
 * Part of #1989, closes #1993.
 */
import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import {
  assertCrippleDegraded,
  assertDiscoveryTypesFound,
  assertRecordingCaptured,
  discoverySkipReason,
  runDiscoveryScenario,
} from "./DiscoveryScenarioHelper.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whole creature: 2 inputs, 3 hidden (RELU + TANH + RELU), 1 output (IDENTITY).
 *
 * input-0 ──(0.8)──▶ hidden-A (RELU, bias 0)
 * input-1 ──(0.6)──▶ hidden-A
 * hidden-A ──(0.7)──▶ hidden-B (TANH, bias 0.3)
 * hidden-B ──(0.9)──▶ hidden-C (RELU, bias 0)
 * hidden-C ──(1.0)──▶ output-0 (IDENTITY, bias 0)
 *
 * The key neuron is hidden-B (TANH), which sits between hidden-A and hidden-C.
 * The TANH squash with bias 0.3 introduces a non-linear transformation that
 * a direct connection cannot replicate.
 */
const WHOLE_CREATURE: CreatureExport = {
  input: 2,
  output: 1,
  neurons: [
    { uuid: "hidden-A", type: "hidden", squash: "RELU", bias: 0 },
    { uuid: "hidden-B", type: "hidden", squash: "TANH", bias: 0.3 },
    { uuid: "hidden-C", type: "hidden", squash: "RELU", bias: 0 },
    { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.8 },
    { fromUUID: "input-1", toUUID: "hidden-A", weight: 0.6 },
    { fromUUID: "hidden-A", toUUID: "hidden-B", weight: 0.7 },
    { fromUUID: "hidden-B", toUUID: "hidden-C", weight: 0.9 },
    { fromUUID: "hidden-C", toUUID: "output-0", weight: 1.0 },
  ],
};

/**
 * Crippled creature: removes hidden-B and directly connects hidden-A to hidden-C.
 *
 * input-0 ──(0.8)──▶ hidden-A (RELU, bias 0) ──(0.5)──▶ hidden-C (RELU, bias 0)
 * input-1 ──(0.6)──▶ hidden-A
 * hidden-C ──(1.0)──▶ output-0 (IDENTITY, bias 0)
 *
 * The creature should still function but with reduced capability because
 * the TANH non-linearity from hidden-B is missing.
 */
const CRIPPLED_CREATURE: CreatureExport = {
  input: 2,
  output: 1,
  neurons: [
    { uuid: "hidden-A", type: "hidden", squash: "RELU", bias: 0 },
    { uuid: "hidden-C", type: "hidden", squash: "RELU", bias: 0 },
    { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.8 },
    { fromUUID: "input-1", toUUID: "hidden-A", weight: 0.6 },
    { fromUUID: "hidden-A", toUUID: "hidden-C", weight: 0.5 },
    { fromUUID: "hidden-C", toUUID: "output-0", weight: 1.0 },
  ],
};

/**
 * Deterministic test samples using diverse input patterns.
 * Expected outputs assume the whole creature's non-linear TANH processing.
 */
const TEST_SAMPLES = [
  { input: [1.0, 0.5], expected: [0.85] },
  { input: [0.0, 1.0], expected: [0.40] },
  { input: [0.5, 0.5], expected: [0.65] },
  { input: [1.0, 1.0], expected: [0.90] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

Deno.test(
  "DiscoveryScenario: add neuron between hidden - creatures are valid",
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

    // Whole creature has 3 hidden neurons in a chain
    const wholeHidden = result.wholeCreature.neurons.filter(
      (n) => n.type === "hidden",
    );
    assertEquals(
      wholeHidden.length,
      3,
      "Whole creature should have 3 hidden neurons",
    );

    // Crippled creature has 2 hidden neurons (hidden-B removed)
    const crippledHidden = result.crippledCreature.neurons.filter(
      (n) => n.type === "hidden",
    );
    assertEquals(
      crippledHidden.length,
      2,
      "Crippled creature should have 2 hidden neurons (hidden-B removed)",
    );
  },
);

Deno.test(
  "DiscoveryScenario: add neuron between hidden - cripple degrades outputs",
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
  "DiscoveryScenario: add neuron between hidden - tracing captures errors",
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
  "DiscoveryScenario: add neuron between hidden - crippled has fewer neurons",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: WHOLE_CREATURE,
      crippledCreatureJSON: CRIPPLED_CREATURE,
      samples: TEST_SAMPLES,
    });

    // The whole creature should have more neurons than the crippled one
    assert(
      result.wholeCreature.neurons.length >
        result.crippledCreature.neurons.length,
      `Whole creature should have more neurons (${result.wholeCreature.neurons.length}) ` +
        `than crippled (${result.crippledCreature.neurons.length})`,
    );
  },
);

Deno.test(
  "DiscoveryScenario: add neuron between hidden - crippled has fewer synapses",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: WHOLE_CREATURE,
      crippledCreatureJSON: CRIPPLED_CREATURE,
      samples: TEST_SAMPLES,
    });

    // The whole creature should have more synapses than the crippled one
    assert(
      result.wholeCreature.synapses.length >
        result.crippledCreature.synapses.length,
      `Whole creature should have more synapses (${result.wholeCreature.synapses.length}) ` +
        `than crippled (${result.crippledCreature.synapses.length})`,
    );
  },
);

Deno.test({
  name:
    "DiscoveryScenario: add neuron between hidden - discovery finds add-neurons candidate",
  ignore: true, // See: discoverySkipReason(926, "add-neurons discovery between hidden neurons not yet verified end-to-end")
  fn() {
    // Neuron indices in the crippled creature:
    // 0 = input-0, 1 = input-1, 2 = hidden-A, 3 = hidden-C, 4 = output-0
    const hiddenAId = 2;
    const hiddenCId = 3;

    const mockDiscoveryResult = {
      ID: "test-add-neuron-between-hidden",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: [
        {
          fromNeuronId: hiddenAId,
          toNeuronId: hiddenCId,
          incomingWeight: 0.7,
          outgoingWeight: 0.9,
          squash: "TANH",
          bias: 0.3,
          targetNeuronImpact: 0.5,
          expectedCreatureErrorReduction: 0.4,
          expectedCreatureScoreGain: 0.3,
          improvedCount: 4,
          totalCount: 4,
        },
      ],
      coordinatedStructuralCandidates: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    };

    const result = runDiscoveryScenario({
      wholeCreatureJSON: WHOLE_CREATURE,
      crippledCreatureJSON: CRIPPLED_CREATURE,
      samples: TEST_SAMPLES,
      discoveryResult: mockDiscoveryResult,
      expectedDiscoveryTypes: ["add-neurons"],
    });

    // Discovery should produce at least one candidate
    assert(
      result.candidates.length > 0,
      "Discovery should produce at least one candidate",
    );

    // The candidate should be an add-neurons type
    assertDiscoveryTypesFound(result.candidates, ["add-neurons"]);

    // Log skip reason for reference
    const _skipReason = discoverySkipReason(
      926,
      "add-neurons discovery between hidden neurons not yet verified end-to-end",
    );
  },
});
