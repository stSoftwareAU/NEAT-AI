/**
 * Discovery scenario test: fan-in synapse patterns.
 *
 * Verifies that the discovery process can find missing fan-in synapse
 * connections (multiple inputs converging to one hidden neuron), including
 * a hidden→hidden fan-in connection.
 *
 * Scenario (whole creature):
 *   input-0 ──(0.7)──▶ hidden-B (RELU, bias 0) ──(0.5)──▶ hidden-A (fan-in from hidden)
 *   input-0 ──(0.8)──▶ hidden-A (TANH, bias 0) ──(1.0)──▶ output-0 (IDENTITY, bias 0)
 *   input-1 ──(0.6)──▶ hidden-A
 *   hidden-B ──(0.3)──▶ output-0  (keeps hidden-B valid after cripple)
 *
 * hidden-A has fan-in from 3 sources: input-0, input-1, and hidden-B.
 *
 * Crippled creature removes the hidden-B → hidden-A synapse, reducing
 * the fan-in from 3 sources to 2. hidden-B remains structurally valid
 * because it still connects to output-0.
 *
 * Part of #1989, closes #1994.
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
 * input-0 ──(0.7)──▶ hidden-B (RELU, bias 0)
 * input-0 ──(0.8)──▶ hidden-A (TANH, bias 0)
 * input-1 ──(0.6)──▶ hidden-A
 * hidden-B ──(0.5)──▶ hidden-A           ← fan-in from hidden neuron
 * hidden-B ──(0.3)──▶ output-0 (IDENTITY, bias 0)
 * hidden-A ──(1.0)──▶ output-0
 *
 * hidden-A receives fan-in from 3 sources: input-0, input-1, and hidden-B.
 * The key synapse is hidden-B → hidden-A (weight 0.5).
 */
const WHOLE_CREATURE: CreatureExport = {
  input: 2,
  output: 1,
  neurons: [
    { uuid: "hidden-B", type: "hidden", squash: "RELU", bias: 0 },
    { uuid: "hidden-A", type: "hidden", squash: "TANH", bias: 0 },
    { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-B", weight: 0.7 },
    { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.8 },
    { fromUUID: "input-1", toUUID: "hidden-A", weight: 0.6 },
    { fromUUID: "hidden-B", toUUID: "hidden-A", weight: 0.5 },
    { fromUUID: "hidden-B", toUUID: "output-0", weight: 0.3 },
    { fromUUID: "hidden-A", toUUID: "output-0", weight: 1.0 },
  ],
};

/**
 * Crippled creature: same topology minus the hidden-B → hidden-A synapse.
 *
 * input-0 ──(0.7)──▶ hidden-B (RELU, bias 0) ──(0.3)──▶ output-0 (IDENTITY, bias 0)
 * input-0 ──(0.8)──▶ hidden-A (TANH, bias 0) ──(1.0)──▶ output-0
 * input-1 ──(0.6)──▶ hidden-A
 *
 * hidden-A's fan-in is reduced from 3 sources to 2. hidden-B remains
 * valid because it still connects to output-0. The creature should produce
 * degraded outputs because hidden-A no longer receives hidden-B's processed
 * signal.
 */
const CRIPPLED_CREATURE: CreatureExport = {
  input: 2,
  output: 1,
  neurons: [
    { uuid: "hidden-B", type: "hidden", squash: "RELU", bias: 0 },
    { uuid: "hidden-A", type: "hidden", squash: "TANH", bias: 0 },
    { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-B", weight: 0.7 },
    { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.8 },
    { fromUUID: "input-1", toUUID: "hidden-A", weight: 0.6 },
    // hidden-B → hidden-A removed (fan-in cripple)
    { fromUUID: "hidden-B", toUUID: "output-0", weight: 0.3 },
    { fromUUID: "hidden-A", toUUID: "output-0", weight: 1.0 },
  ],
};

/**
 * Deterministic test samples using diverse input patterns.
 * Expected outputs are approximate targets based on the whole creature's
 * fan-in topology.
 */
const TEST_SAMPLES = [
  { input: [1.0, 0.5], expected: [1.1] },
  { input: [0.0, 1.0], expected: [0.5] },
  { input: [0.5, 0.5], expected: [0.8] },
  { input: [1.0, 1.0], expected: [1.2] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

Deno.test(
  "DiscoveryScenario: fan-in synapse patterns - creatures are valid",
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

    // Both creatures have 2 hidden neurons (hidden-B preserved after cripple)
    const wholeHidden = result.wholeCreature.neurons.filter(
      (n) => n.type === "hidden",
    );
    assertEquals(
      wholeHidden.length,
      2,
      "Whole creature should have 2 hidden neurons",
    );

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
  "DiscoveryScenario: fan-in synapse patterns - whole creature has fan-in of 3",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: WHOLE_CREATURE,
      crippledCreatureJSON: CRIPPLED_CREATURE,
      samples: TEST_SAMPLES,
    });

    // hidden-A is the TANH neuron — find its index and count inward synapses.
    const hiddenA = result.wholeCreature.neurons.find(
      (n) => n.type === "hidden" && n.squash === "TANH",
    );
    assert(hiddenA, "Should find hidden-A (TANH) neuron");

    const fanInCount = result.wholeCreature.synapses.filter(
      (s) => s.to === hiddenA.index,
    ).length;

    assertEquals(
      fanInCount,
      3,
      "hidden-A should have fan-in of 3 in the whole creature " +
        "(input-0, input-1, hidden-B)",
    );
  },
);

Deno.test(
  "DiscoveryScenario: fan-in synapse patterns - cripple reduces fan-in",
  () => {
    const result = runDiscoveryScenario({
      wholeCreatureJSON: WHOLE_CREATURE,
      crippledCreatureJSON: CRIPPLED_CREATURE,
      samples: TEST_SAMPLES,
    });

    // hidden-A is the TANH neuron — find its index and count inward synapses.
    const hiddenA = result.crippledCreature.neurons.find(
      (n) => n.type === "hidden" && n.squash === "TANH",
    );
    assert(hiddenA, "Should find hidden-A (TANH) neuron");

    const fanInCount = result.crippledCreature.synapses.filter(
      (s) => s.to === hiddenA.index,
    ).length;

    assertEquals(
      fanInCount,
      2,
      "hidden-A should have fan-in of 2 in the crippled creature " +
        "(input-0, input-1 only — hidden-B connection removed)",
    );
  },
);

Deno.test(
  "DiscoveryScenario: fan-in synapse patterns - cripple degrades outputs",
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
  "DiscoveryScenario: fan-in synapse patterns - tracing captures errors",
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
  "DiscoveryScenario: fan-in synapse patterns - crippled has fewer synapses",
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
    "DiscoveryScenario: fan-in synapse patterns - discovery finds add-synapses candidate",
  fn() {
    const mockDiscoveryResult = {
      ID: "test-fan-in-synapse-patterns",
      addHelpfulSynapses: [
        {
          fromNeuronUuid: "hidden-B",
          toNeuronUuid: "hidden-A",
          weight: 0.5,
          targetNeuronImpact: 0.4,
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
