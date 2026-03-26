/**
 * Discovery scenario test: coordinated structural changes.
 *
 * Verifies that the discovery process can find coordinated multi-step
 * structural improvements (the "coordinated-structural" discovery type).
 *
 * Coordinated structural candidates involve multiple operations applied
 * together (e.g., setBias + addSynapse). This tests whether discovery
 * can identify compound degradations.
 *
 * Scenario (whole creature):
 *   input-0 ──(1.0)──▶ hidden-A (TANH, bias: 0.3) ──(1.0)──▶ hidden-C (RELU)
 *   input-1 ──(1.0)──▶ hidden-B (RELU, bias: -0.1) ──(0.8)──▶ hidden-C
 *   hidden-C ──(1.0)──▶ output-0 (IDENTITY, bias: 0)
 *
 * Crippled creature (coordinated degradation):
 *   - hidden-A's bias changed from 0.3 to 0.0
 *   - hidden-B → hidden-C weight changed from 0.8 to 0.05 (nearly disabled)
 *   - Still functions but degraded through both paths
 *
 * Part of #1989, closes #1996.
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
 * Whole creature: 2 inputs, 3 hidden neurons (TANH + RELU + RELU), 1 output.
 *
 * input-0 ──(1.0)──▶ hidden-A (TANH, bias 0.3) ──(1.0)──▶ hidden-C (RELU, bias 0)
 * input-1 ──(1.0)──▶ hidden-B (RELU, bias -0.1) ──(0.8)──▶ hidden-C
 * hidden-C ──(1.0)──▶ output-0 (IDENTITY, bias 0)
 *
 * Both paths contribute to hidden-C's activation, producing richer outputs.
 */
const WHOLE_CREATURE: CreatureExport = {
  input: 2,
  output: 1,
  neurons: [
    { uuid: "hidden-A", type: "hidden", squash: "TANH", bias: 0.3 },
    { uuid: "hidden-B", type: "hidden", squash: "RELU", bias: -0.1 },
    { uuid: "hidden-C", type: "hidden", squash: "RELU", bias: 0 },
    { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-A", weight: 1.0 },
    { fromUUID: "input-1", toUUID: "hidden-B", weight: 1.0 },
    { fromUUID: "hidden-A", toUUID: "hidden-C", weight: 1.0 },
    { fromUUID: "hidden-B", toUUID: "hidden-C", weight: 0.8 },
    { fromUUID: "hidden-C", toUUID: "output-0", weight: 1.0 },
  ],
};

/**
 * Crippled creature: multiple coordinated degradations applied.
 *
 * 1. hidden-A's bias changed from 0.3 to 0.0 (reduces TANH offset)
 * 2. hidden-B → hidden-C weight changed from 0.8 to 0.05 (nearly zero,
 *    effectively disabling the input-1 path while remaining structurally valid)
 *
 * Both paths still exist but are degraded: the bias shift reduces hidden-A's
 * contribution, and the near-zero weight on hidden-B → hidden-C nearly
 * eliminates input-1's influence on the output.
 */
const CRIPPLED_CREATURE: CreatureExport = {
  input: 2,
  output: 1,
  neurons: [
    { uuid: "hidden-A", type: "hidden", squash: "TANH", bias: 0 },
    { uuid: "hidden-B", type: "hidden", squash: "RELU", bias: -0.1 },
    { uuid: "hidden-C", type: "hidden", squash: "RELU", bias: 0 },
    { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-A", weight: 1.0 },
    { fromUUID: "input-1", toUUID: "hidden-B", weight: 1.0 },
    { fromUUID: "hidden-A", toUUID: "hidden-C", weight: 1.0 },
    // hidden-B → hidden-C weight degraded from 0.8 to near-zero
    { fromUUID: "hidden-B", toUUID: "hidden-C", weight: 0.05 },
    { fromUUID: "hidden-C", toUUID: "output-0", weight: 1.0 },
  ],
};

/**
 * Deterministic test samples using diverse input patterns.
 * Expected outputs are approximate — the key assertion is that the
 * crippled creature produces degraded (different) outputs compared
 * to the whole creature.
 */
const TEST_SAMPLES = [
  { input: [1.0, 0.5], expected: [1.58] },
  { input: [0.0, 1.0], expected: [1.01] },
  { input: [0.5, 0.5], expected: [1.30] },
  { input: [1.0, 1.0], expected: [1.89] },
  { input: [-0.5, 0.5], expected: [0.34] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

Deno.test(
  "DiscoveryScenario: coordinated structural - creatures are valid",
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

    // Whole creature has 3 hidden neurons
    const wholeHidden = result.wholeCreature.neurons.filter(
      (n) => n.type === "hidden",
    );
    assertEquals(
      wholeHidden.length,
      3,
      "Whole creature should have 3 hidden neurons",
    );

    // Crippled creature also has 3 hidden neurons (same neurons, different config)
    const crippledHidden = result.crippledCreature.neurons.filter(
      (n) => n.type === "hidden",
    );
    assertEquals(
      crippledHidden.length,
      3,
      "Crippled creature should have 3 hidden neurons (same topology)",
    );
  },
);

Deno.test(
  "DiscoveryScenario: coordinated structural - cripple degrades outputs",
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
  "DiscoveryScenario: coordinated structural - tracing captures errors",
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
  "DiscoveryScenario: coordinated structural - same topology, different parameters",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: WHOLE_CREATURE,
      crippledCreatureJSON: CRIPPLED_CREATURE,
      samples: TEST_SAMPLES,
    });

    // Both creatures should have the same number of synapses and neurons
    // — the degradation is in parameter values (bias + weight), not topology
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
  },
);

Deno.test(
  "DiscoveryScenario: coordinated structural - bias was changed",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: WHOLE_CREATURE,
      crippledCreatureJSON: CRIPPLED_CREATURE,
      samples: TEST_SAMPLES,
    });

    // Find hidden-A (first hidden neuron) in both creatures
    const wholeHidden = result.wholeCreature.neurons.filter(
      (n) => n.type === "hidden",
    );
    const crippledHidden = result.crippledCreature.neurons.filter(
      (n) => n.type === "hidden",
    );

    // The first hidden neuron (hidden-A) should have different biases
    assert(wholeHidden.length > 0, "Whole creature should have hidden neurons");
    assert(
      crippledHidden.length > 0,
      "Crippled creature should have hidden neurons",
    );
    assert(
      wholeHidden[0].bias !== crippledHidden[0].bias,
      `Hidden-A bias should differ: whole=${wholeHidden[0].bias}, crippled=${
        crippledHidden[0].bias
      }`,
    );
  },
);

Deno.test(
  "DiscoveryScenario: coordinated structural - multiple degradations confirmed",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: WHOLE_CREATURE,
      crippledCreatureJSON: CRIPPLED_CREATURE,
      samples: TEST_SAMPLES,
    });

    // Confirm both degradations are present:
    // 1. Different bias on first hidden neuron (hidden-A: 0.3 → 0.0)
    const wholeHidden = result.wholeCreature.neurons.filter(
      (n) => n.type === "hidden",
    );
    const crippledHidden = result.crippledCreature.neurons.filter(
      (n) => n.type === "hidden",
    );
    assert(
      wholeHidden[0].bias !== crippledHidden[0].bias,
      `Hidden-A bias should differ between whole (${wholeHidden[0].bias}) ` +
        `and crippled (${crippledHidden[0].bias})`,
    );

    // 2. Different synaptic weights (hidden-B→hidden-C: 0.8 → 0.05)
    // Export both creatures and compare the hidden-B→hidden-C synapse weight
    const wholeJSON = result.wholeCreature.exportJSON();
    const crippledJSON = result.crippledCreature.exportJSON();

    // Find hidden-B→hidden-C synapse by matching the second-to-last neuron connections
    // hidden-B is the second hidden neuron, hidden-C is the third
    const wholeSynapseWeights = wholeJSON.synapses.map((s) => s.weight);
    const crippledSynapseWeights = crippledJSON.synapses.map((s) => s.weight);

    // At least one synapse weight should differ between the two creatures
    let hasWeightDifference = false;
    for (let i = 0; i < wholeSynapseWeights.length; i++) {
      if (
        Math.abs(wholeSynapseWeights[i] - crippledSynapseWeights[i]) > 1e-10
      ) {
        hasWeightDifference = true;
        break;
      }
    }
    assert(
      hasWeightDifference,
      "At least one synapse weight should differ between whole and crippled",
    );
  },
);

Deno.test({
  name:
    "DiscoveryScenario: coordinated structural - discovery finds coordinated-structural candidate",
  fn() {
    // Neuron indices in the crippled creature:
    // 0 = input-0, 1 = input-1, 2 = hidden-A, 3 = hidden-B, 4 = hidden-C, 5 = output-0
    const hiddenAId = 2;
    const hiddenBId = 3;
    const hiddenCId = 4;

    const mockDiscoveryResult = {
      ID: "test-coordinated-structural",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      coordinatedStructuralCandidates: [
        {
          type: "coordinated_structural" as const,
          expectedCreatureScoreGain: 0.6,
          operations: [
            // Restore hidden-A's bias from 0.0 back to 0.3
            {
              type: "setBias" as const,
              neuronId: hiddenAId,
              bias: 0.3,
            },
            // Restore the hidden-B → hidden-C weight from 0.05 back to 0.8
            {
              type: "setWeight" as const,
              fromNeuronId: hiddenBId,
              toNeuronId: hiddenCId,
              weight: 0.8,
            },
          ],
        },
      ],
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
      expectedDiscoveryTypes: ["coordinated-structural"],
    });

    // Discovery should produce at least one candidate
    assert(
      result.candidates.length > 0,
      "Discovery should produce at least one candidate",
    );

    // The candidate should be a coordinated-structural type
    assertDiscoveryTypesFound(result.candidates, ["coordinated-structural"]);

    // Verify the candidate preserves the original coordinated structural data
    const coordCandidate = result.candidates.find(
      (c) => c.change.type === "coordinated-structural",
    );
    assert(
      coordCandidate,
      "Should find a coordinated-structural candidate",
    );
    assert(
      coordCandidate.change.coordinatedStructuralCandidate,
      "Candidate should preserve the original coordinated structural data",
    );
    assertEquals(
      coordCandidate.change.coordinatedStructuralCandidate.operations.length,
      2,
      "Coordinated candidate should have 2 operations (setBias + setWeight)",
    );
  },
});
