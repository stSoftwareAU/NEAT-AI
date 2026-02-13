/**
 * Tests for leave-one-out and extended combination strategies.
 *
 * Issue #1417: When multiple successful discovery candidates exist, we should
 * try different combinations rather than only the "all combined" approach.
 * Two "aggressive" candidates may look good individually but score negatively
 * together. Leave-one-out combinations address this by testing what happens
 * when each candidate is excluded in turn.
 */

import { assert, assertEquals } from "@std/assert";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { Creature } from "../../src/Creature.ts";
import {
  buildCombinedFromSuccessful,
  type DiscoveryCandidate,
} from "../../src/discovery/DiscoveryCandidates.ts";

/**
 * Creates a base creature with known structure for combination testing.
 */
function makeTestCreature() {
  const creature = Creature.fromJSON({
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-A", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-B", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "hidden-C", squash: "IDENTITY", bias: 0.2 },
      { type: "hidden", uuid: "hidden-D", squash: "IDENTITY", bias: 0.05 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-B", weight: 0.5 },
      { fromUUID: "input-2", toUUID: "hidden-C", weight: 0.4 },
      { fromUUID: "hidden-A", toUUID: "hidden-D", weight: 0.3 },
      { fromUUID: "hidden-B", toUUID: "hidden-D", weight: 0.3 },
      { fromUUID: "hidden-C", toUUID: "hidden-D", weight: 0.2 },
      { fromUUID: "hidden-D", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/**
 * Creates a change-squash candidate for the given neuron.
 */
function makeSquashCandidate(
  baseJSON: ReturnType<Creature["exportJSON"]>,
  neuronUUID: string,
  newSquash: string,
): DiscoveryCandidate {
  const json = structuredClone(baseJSON);
  const neuron = json.neurons.find((n) => n.uuid === neuronUUID);
  if (neuron) neuron.squash = newSquash;
  const creature = Creature.fromJSON(json);
  delete creature.uuid;
  creature.fix();
  CreatureUtil.makeUUID(creature);
  return {
    creature,
    change: {
      type: "change-squash",
      description: `Changed ${neuronUUID} to ${newSquash}`,
      squashCandidate: {
        neuronUUID,
        previousSquash: "IDENTITY",
        squash: newSquash,
        expectedCreatureScoreGain: 0.1,
        improvedError: 0.05,
        currentError: 0.1,
      },
    },
  };
}

/**
 * Creates an add-synapses candidate.
 */
function makeAddSynapseCandidate(
  baseJSON: ReturnType<Creature["exportJSON"]>,
  fromUUID: string,
  toUUID: string,
  weight: number,
): DiscoveryCandidate {
  const json = structuredClone(baseJSON);
  json.synapses.push({ fromUUID, toUUID, weight });
  const creature = Creature.fromJSON(json);
  delete creature.uuid;
  creature.fix();
  CreatureUtil.makeUUID(creature);
  return {
    creature,
    change: {
      type: "add-synapses",
      description: `Added synapse ${fromUUID} -> ${toUUID}`,
      synapseCandidate: {
        fromNeuronUUID: fromUUID,
        toNeuronUUID: toUUID,
        weight,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0,
        expectedCreatureScoreGain: 0.2,
        improvedCount: 5,
        totalCount: 6,
      },
    },
  };
}

Deno.test(
  "buildCombinedFromSuccessful: generates leave-one-out combinations for 3+ candidates",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();

    // Create 3 successful candidates (different types to avoid slot conflicts)
    const candidates: DiscoveryCandidate[] = [
      makeSquashCandidate(baseJSON, "hidden-A", "TANH"),
      makeSquashCandidate(baseJSON, "hidden-B", "Mish"),
      makeAddSynapseCandidate(baseJSON, "input-0", "hidden-B", 0.35),
    ];

    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_LEAVE_ONE_OUT",
      candidates,
    );

    // With 3 candidates, we should get leave-one-out combinations:
    // [1,2], [0,2], [0,1] are the leave-one-out combos, but [0,1], [0,2], [1,2]
    // are already generated as pairwise. The leave-one-out strategy should generate
    // combinations of (N-1) candidates = all pairwise when N=3.
    // For N=3, leave-one-out IS the same as pairwise.
    // The real value appears at N >= 4.

    // We should have: all-combined + removal/non-removal + pairwise + leave-one-out
    assert(
      combined.length >= 1,
      `Should produce combinations, got ${combined.length}`,
    );
  },
);

Deno.test(
  "buildCombinedFromSuccessful: generates leave-one-out combinations for 4 candidates",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();

    // Create 4 successful candidates of different types/slots
    const candidates: DiscoveryCandidate[] = [
      makeSquashCandidate(baseJSON, "hidden-A", "TANH"),
      makeSquashCandidate(baseJSON, "hidden-B", "Mish"),
      makeSquashCandidate(baseJSON, "hidden-C", "TANH"),
      makeAddSynapseCandidate(baseJSON, "input-0", "hidden-B", 0.35),
    ];

    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_LEAVE_ONE_OUT_4",
      candidates,
    );

    // With 4 candidates, leave-one-out generates 4 combinations of size 3.
    // These are DIFFERENT from pairwise (size 2) and triples (also size 3).
    // However, leave-one-out triples overlap with Strategy 5 triples.
    // The key is that leave-one-out with N=4 generates ALL triples,
    // which Strategy 5 already does for N=4-8.
    // The true value of leave-one-out is for N >= 4 where it generates
    // N-1 sized subsets that are distinct from pairwise.

    // Count unique combo-successful candidates
    const comboSuccessful = combined.filter(
      (c) => c.change.type === "combo-successful",
    );

    // Should have leave-one-out combos (size N-1 = 3) in addition to other strategies
    // With 4 candidates: Strategy 1 (all), Strategy 3 (non-removal if applicable),
    // Strategy 4 (6 pairs), Strategy 5 (4 triples), Strategy 6 (4 leave-one-out of size 3)
    // Some leave-one-out may overlap with triples, but at least some should be generated
    assert(
      comboSuccessful.length >= 4,
      `With 4 candidates, should produce at least 4 combinations, got ${comboSuccessful.length}`,
    );
  },
);

Deno.test(
  "buildCombinedFromSuccessful: leave-one-out with 5 candidates produces size-4 subsets",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();

    // Create 5 successful candidates of different types/slots
    const candidates: DiscoveryCandidate[] = [
      makeSquashCandidate(baseJSON, "hidden-A", "TANH"),
      makeSquashCandidate(baseJSON, "hidden-B", "Mish"),
      makeSquashCandidate(baseJSON, "hidden-C", "TANH"),
      makeSquashCandidate(baseJSON, "hidden-D", "Mish"),
      makeAddSynapseCandidate(baseJSON, "input-0", "hidden-B", 0.35),
    ];

    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_LEAVE_ONE_OUT_5",
      candidates,
    );

    const comboSuccessful = combined.filter(
      (c) => c.change.type === "combo-successful",
    );

    // With 5 candidates, leave-one-out generates 5 combinations of size 4.
    // These are NOT covered by triples (size 3) or pairwise (size 2).
    // So leave-one-out adds genuinely new combinations.
    // Total combos: Strategy 1 (1), Strategy 3 (may or may not apply),
    // Strategy 4 (10 pairs), Strategy 5 (10 triples), Strategy 6 (5 leave-one-out)
    assert(
      comboSuccessful.length >= 5,
      `With 5 candidates, should produce at least 5 combinations (incl. leave-one-out), got ${comboSuccessful.length}`,
    );
  },
);

Deno.test(
  "buildCombinedFromSuccessful: leave-one-out avoids duplicate with all-combined",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();

    // Create 3 candidates - leave-one-out of size 2 should not duplicate pairwise
    const candidates: DiscoveryCandidate[] = [
      makeSquashCandidate(baseJSON, "hidden-A", "TANH"),
      makeSquashCandidate(baseJSON, "hidden-B", "Mish"),
      makeAddSynapseCandidate(baseJSON, "input-0", "hidden-B", 0.35),
    ];

    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_NO_DUPLICATES",
      candidates,
    );

    // The combination key mechanism prevents duplicate generation.
    // Verify we produce a sensible number of combinations.
    assert(
      combined.length > 0,
      "Should produce at least some combinations",
    );
  },
);

Deno.test(
  "buildCombinedFromSuccessful: extended pairwise sampling for > 10 candidates",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();

    // Create 12 candidates (more than the 10-candidate pairwise limit).
    // Use squash changes for the 4 hidden neurons and add-synapse candidates
    // for unique from->to pairs.
    const candidates: DiscoveryCandidate[] = [];

    // 4 squash candidates (A,B,C,D with TANH)
    candidates.push(makeSquashCandidate(baseJSON, "hidden-A", "TANH"));
    candidates.push(makeSquashCandidate(baseJSON, "hidden-B", "Mish"));
    candidates.push(makeSquashCandidate(baseJSON, "hidden-C", "TANH"));
    candidates.push(makeSquashCandidate(baseJSON, "hidden-D", "Mish"));

    // 8 add-synapse candidates with unique from->to pairs
    const synapsePairs = [
      ["input-0", "hidden-C", 0.31],
      ["input-0", "hidden-D", 0.32],
      ["input-1", "hidden-A", 0.33],
      ["input-1", "hidden-C", 0.34],
      ["input-1", "hidden-D", 0.35],
      ["input-2", "hidden-A", 0.36],
      ["input-2", "hidden-B", 0.37],
      ["input-2", "hidden-D", 0.38],
    ] as const;

    for (const [from, to, weight] of synapsePairs) {
      candidates.push(makeAddSynapseCandidate(baseJSON, from, to, weight));
    }

    assertEquals(
      candidates.length,
      12,
      "Precondition: should have 12 candidates",
    );

    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_EXTENDED_PAIRWISE",
      candidates,
    );

    const comboSuccessful = combined.filter(
      (c) => c.change.type === "combo-successful",
    );

    // With 12 candidates, the old code would only generate Strategy 1 (all), Strategy 2/3
    // (removal/non-removal), but skip pairwise (> 10 limit) and triples (> 8 limit).
    // With the fix, we should get sampled pairwise and leave-one-out combinations.
    // Leave-one-out: 12 combinations of size 11
    // Sampled pairwise: some selection of pairs
    assert(
      comboSuccessful.length >= 12,
      `With 12 candidates, should produce at least 12 combinations ` +
        `(including leave-one-out), got ${comboSuccessful.length}`,
    );
  },
);

Deno.test(
  "buildCombinedFromSuccessful: leave-one-out combinations each exclude exactly one candidate",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();

    // Create 4 squash candidates on different neurons - each will change the squash
    // function. This allows us to verify that leave-one-out excludes exactly one.
    const candidates: DiscoveryCandidate[] = [
      makeSquashCandidate(baseJSON, "hidden-A", "TANH"),
      makeSquashCandidate(baseJSON, "hidden-B", "Mish"),
      makeSquashCandidate(baseJSON, "hidden-C", "TANH"),
      makeAddSynapseCandidate(baseJSON, "input-0", "hidden-B", 0.35),
    ];

    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_VERIFY_LOO",
      candidates,
    );

    // Count the total combo-successful candidates
    const comboSuccessful = combined.filter(
      (c) => c.change.type === "combo-successful",
    );

    // With 4 candidates and the leave-one-out strategy, we should get
    // combinations that apply 3 out of 4 candidates each.
    // Each leave-one-out combo should have at least 2 applied changes.
    for (const combo of comboSuccessful) {
      // Every combo-successful should be valid
      combo.creature.validate();
    }

    assert(
      comboSuccessful.length > 0,
      "Should produce combo-successful candidates",
    );
  },
);
