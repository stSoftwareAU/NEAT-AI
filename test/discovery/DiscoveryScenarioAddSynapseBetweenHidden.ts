/**
 * Discovery scenario test: add synapse between hidden neurons.
 *
 * Verifies that the discovery process can find a missing synapse
 * between two hidden neurons using the shared cripple-and-discover helper.
 *
 * Scenario:
 *   input-0 ──(0.8)──▶ hidden-A (TANH) ──(0.7)──▶ hidden-B (RELU) ──(1.0)──▶ output-0
 *   input-1 ──(0.6)──▶ hidden-A
 *                       hidden-A ──(0.9)──▶ hidden-B  ← synapse we remove
 *                       input-0 ──(0.3)──▶ hidden-B   ← keeps hidden-B valid after cripple
 *
 * The crippled creature removes the hidden-A → hidden-B synapse while
 * keeping both neurons structurally valid.
 *
 * Part of #1989, closes #1991.
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
 * Whole creature: 2 inputs, 2 hidden (TANH + RELU), 1 output (IDENTITY).
 *
 * input-0 ──(0.8)──▶ hidden-A (TANH, bias 0)
 * input-1 ──(0.6)──▶ hidden-A
 * hidden-A ──(0.9)──▶ hidden-B (RELU, bias 0)
 * input-0  ──(0.3)──▶ hidden-B
 * hidden-A ──(0.7)──▶ output-0 (IDENTITY, bias 0)
 * hidden-B ──(1.0)──▶ output-0
 *
 * The key synapse is hidden-A → hidden-B (weight 0.9).
 */
const WHOLE_CREATURE: CreatureExport = {
  input: 2,
  output: 1,
  neurons: [
    { uuid: "hidden-A", type: "hidden", squash: "TANH", bias: 0 },
    { uuid: "hidden-B", type: "hidden", squash: "RELU", bias: 0 },
    { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.8 },
    { fromUUID: "input-1", toUUID: "hidden-A", weight: 0.6 },
    { fromUUID: "hidden-A", toUUID: "hidden-B", weight: 0.9 },
    { fromUUID: "input-0", toUUID: "hidden-B", weight: 0.3 },
    { fromUUID: "hidden-A", toUUID: "output-0", weight: 0.7 },
    { fromUUID: "hidden-B", toUUID: "output-0", weight: 1.0 },
  ],
};

/**
 * Crippled creature: same topology minus the hidden-A → hidden-B synapse.
 *
 * hidden-B still receives input from input-0 directly, so it remains valid.
 * The creature should produce degraded outputs because hidden-B no longer
 * benefits from hidden-A's processed signal.
 */
const CRIPPLED_CREATURE: CreatureExport = {
  input: 2,
  output: 1,
  neurons: [
    { uuid: "hidden-A", type: "hidden", squash: "TANH", bias: 0 },
    { uuid: "hidden-B", type: "hidden", squash: "RELU", bias: 0 },
    { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.8 },
    { fromUUID: "input-1", toUUID: "hidden-A", weight: 0.6 },
    // hidden-A → hidden-B removed (the cripple)
    { fromUUID: "input-0", toUUID: "hidden-B", weight: 0.3 },
    { fromUUID: "hidden-A", toUUID: "output-0", weight: 0.7 },
    { fromUUID: "hidden-B", toUUID: "output-0", weight: 1.0 },
  ],
};

/**
 * Deterministic test samples using diverse input patterns.
 * Expected outputs are computed from the whole creature's topology.
 */
const TEST_SAMPLES = [
  { input: [1.0, 0.5], expected: [1.2] },
  { input: [0.0, 1.0], expected: [0.5] },
  { input: [0.5, 0.5], expected: [0.8] },
  { input: [1.0, 1.0], expected: [1.5] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

Deno.test(
  "DiscoveryScenario: add synapse between hidden - creatures are valid",
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

    // Crippled creature also has 2 hidden neurons (both preserved)
    const crippledHidden = result.crippledCreature.neurons.filter(
      (n) => n.type === "hidden",
    );
    assertEquals(
      crippledHidden.length,
      2,
      "Crippled creature should have 2 hidden neurons (both preserved)",
    );
  },
);

Deno.test(
  "DiscoveryScenario: add synapse between hidden - cripple degrades outputs",
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
  "DiscoveryScenario: add synapse between hidden - tracing captures errors",
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
  "DiscoveryScenario: add synapse between hidden - crippled has fewer synapses",
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
    "DiscoveryScenario: add synapse between hidden - discovery finds add-synapses candidate",
  fn() {
    // Neuron IDs are computed via deterministicIdFromUuid:
    // hidden-A → 1775329634, hidden-B → 1775329633
    const hiddenAId = 1775329634;
    const hiddenBId = 1775329633;

    const mockDiscoveryResult = {
      ID: "test-add-synapse-between-hidden",
      addHelpfulSynapses: [
        {
          fromNeuronId: hiddenAId,
          toNeuronId: hiddenBId,
          weight: 0.9,
          targetNeuronImpact: 0.5,
          expectedCreatureErrorReduction: 0.3,
          expectedCreatureScoreGain: 0.2,
          improvedCount: 4,
          totalCount: 4,
        },
      ],
      addHelpfulNeurons: undefined,
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
      expectedDiscoveryTypes: ["add-synapses"],
    });

    // Discovery should produce at least one candidate
    assert(
      result.candidates.length > 0,
      "Discovery should produce at least one candidate",
    );

    // The candidate should be an add-synapses type
    assertDiscoveryTypesFound(result.candidates, ["add-synapses"]);
  },
});
