/**
 * Unit tests for RecordElasticity.ts - distributeRecordError,
 * constrainAndRedistributeRecordShares, recordTargetFeasibilityFactor.
 *
 * Closes #1399
 */
import { assertAlmostEquals, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { Neuron } from "../../src/architecture/Neuron.ts";
import type { Synapse } from "../../src/architecture/Synapse.ts";
import {
  constrainAndRedistributeRecordShares,
  distributeRecordError,
  type RecordElasticLink,
  recordTargetFeasibilityFactor,
} from "../../src/propagate/RecordElasticity.ts";

// ---------------------------------------------------------------------------
// Helper: make minimal RecordElasticLink objects for unit testing
// ---------------------------------------------------------------------------

function makeLink(opts: {
  weight: number;
  fromActivation: number;
  safeZoneFactor?: number;
  feasibilityFactor?: number;
  fromNeuron?: Neuron;
}): RecordElasticLink {
  const fromActivation = opts.fromActivation;
  const weight = opts.weight;
  return {
    synapse: { from: 0, to: 1, weight } as Synapse,
    fromNeuron: opts.fromNeuron ?? { type: "input" } as unknown as Neuron,
    fromActivation,
    fromValue: weight * fromActivation,
    safeZoneFactor: opts.safeZoneFactor ?? 1,
    feasibilityFactor: opts.feasibilityFactor ?? 1,
  };
}

// ---------------------------------------------------------------------------
// recordTargetFeasibilityFactor
// ---------------------------------------------------------------------------

function makeCreatureWithSquash(squashName: string): {
  creature: Creature;
  hiddenNeuron: Neuron;
} {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: squashName, bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1 },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return { creature, hiddenNeuron: creature.neurons[1] };
}

Deno.test("recordTargetFeasibilityFactor - returns 1 for input neurons", () => {
  // Input neurons always have feasibilityFactor 1 by design;
  // the function itself only applies to hidden/output neurons.
  // We test a hidden neuron with IDENTITY (no range constraint).
  const { hiddenNeuron } = makeCreatureWithSquash("IDENTITY");
  const factor = recordTargetFeasibilityFactor(hiddenNeuron, 0.5);
  assertAlmostEquals(factor, 1, 1e-9);
});

Deno.test("recordTargetFeasibilityFactor - returns 0.1 for out-of-range ReLU target", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("ReLU");
  // ReLU range is [0, +∞), a negative target is out of range
  const factor = recordTargetFeasibilityFactor(hiddenNeuron, -1);
  assertAlmostEquals(factor, 0.1, 1e-9);
});

Deno.test("recordTargetFeasibilityFactor - returns 1 for in-range ReLU target", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("ReLU");
  const factor = recordTargetFeasibilityFactor(hiddenNeuron, 0.5);
  assertAlmostEquals(factor, 1, 1e-9);
});

Deno.test("recordTargetFeasibilityFactor - returns 0.1 for negative Swish target", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("Swish");
  // Swish is in NEGATIVE_RESIST_SQUASHES: negative targets get 0.1
  const factor = recordTargetFeasibilityFactor(hiddenNeuron, -0.5);
  assertAlmostEquals(factor, 0.1, 1e-9);
});

Deno.test("recordTargetFeasibilityFactor - returns 1 for positive Swish target", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("Swish");
  const factor = recordTargetFeasibilityFactor(hiddenNeuron, 0.5);
  assertAlmostEquals(factor, 1, 1e-9);
});

Deno.test("recordTargetFeasibilityFactor - returns 0 for non-finite target", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("IDENTITY");
  assertEquals(recordTargetFeasibilityFactor(hiddenNeuron, NaN), 0);
  assertEquals(recordTargetFeasibilityFactor(hiddenNeuron, Infinity), 0);
  assertEquals(recordTargetFeasibilityFactor(hiddenNeuron, -Infinity), 0);
});

Deno.test("recordTargetFeasibilityFactor - returns 0.1 for out-of-range ABSOLUTE target", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("ABSOLUTE");
  // ABSOLUTE range is [0, +∞), negative is out of range
  const factor = recordTargetFeasibilityFactor(hiddenNeuron, -1);
  assertAlmostEquals(factor, 0.1, 1e-9);
});

// ---------------------------------------------------------------------------
// distributeRecordError
// ---------------------------------------------------------------------------

Deno.test("distributeRecordError - empty links returns empty shares", () => {
  const result = distributeRecordError(1.0, []);
  assertEquals(result.links.length, 0);
  assertEquals(result.shares.length, 0);
});

Deno.test("distributeRecordError - non-finite error returns zero shares", () => {
  const links = [makeLink({ weight: 1, fromActivation: 0.5 })];
  const result = distributeRecordError(NaN, links);
  assertEquals(result.shares[0], 0);
});

Deno.test("distributeRecordError - single link gets all error", () => {
  const links = [makeLink({ weight: 2.0, fromActivation: 0.5 })];
  const result = distributeRecordError(3.0, links);
  assertAlmostEquals(result.shares[0], 3.0, 1e-9);
});

Deno.test("distributeRecordError - distributes proportional to weight squared", () => {
  // distributeRecordError uses weight² as the "activation" for elastic scoring
  const links = [
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 3, fromActivation: 0.5 }),
  ];
  const result = distributeRecordError(10, links);

  // weight² scores: 1 and 9 => shares: 1 and 9
  assertAlmostEquals(result.shares[0], 1, 1e-9);
  assertAlmostEquals(result.shares[1], 9, 1e-9);
});

Deno.test("distributeRecordError - safeZoneFactor gates contribution", () => {
  const links = [
    makeLink({ weight: 2, fromActivation: 0.5, safeZoneFactor: 1 }),
    makeLink({ weight: 2, fromActivation: 0.5, safeZoneFactor: 0 }),
  ];
  const result = distributeRecordError(10, links);

  // Second link has safeZoneFactor=0 and feasibilityFactor=1 => gate = 0
  // All error should go to first link
  assertAlmostEquals(result.shares[0], 10, 1e-6);
  assertAlmostEquals(result.shares[1], 0, 1e-6);
});

Deno.test("distributeRecordError - feasibilityFactor gates contribution", () => {
  const links = [
    makeLink({ weight: 2, fromActivation: 0.5, feasibilityFactor: 1 }),
    makeLink({
      weight: 2,
      fromActivation: 0.5,
      safeZoneFactor: 1,
      feasibilityFactor: 0,
    }),
  ];
  const result = distributeRecordError(10, links);

  // Second link has feasibilityFactor=0 => gate = 0
  assertAlmostEquals(result.shares[0], 10, 1e-6);
  assertAlmostEquals(result.shares[1], 0, 1e-6);
});

Deno.test("distributeRecordError - all blocked with allowEqualFallback gives zeros", () => {
  const links = [
    makeLink({ weight: 2, fromActivation: 0.5, safeZoneFactor: 0 }),
    makeLink({ weight: 3, fromActivation: 0.5, safeZoneFactor: 0 }),
  ];
  const result = distributeRecordError(10, links, {
    allowEqualFallback: false,
  });

  // All blocked + no fallback => zero shares
  assertAlmostEquals(result.shares[0], 0, 1e-12);
  assertAlmostEquals(result.shares[1], 0, 1e-12);
});

Deno.test("distributeRecordError - shares sum to error", () => {
  const links = [
    makeLink({ weight: 1, fromActivation: 0.3 }),
    makeLink({ weight: 2, fromActivation: 0.5 }),
    makeLink({ weight: 3, fromActivation: 0.7 }),
  ];
  const result = distributeRecordError(7.0, links);
  const sum = result.shares.reduce((a, b) => a + b, 0);
  assertAlmostEquals(sum, 7.0, 1e-9, "Shares should sum to error");
});

Deno.test("distributeRecordError - negative error distributes correctly", () => {
  const links = [
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 3, fromActivation: 0.5 }),
  ];
  const result = distributeRecordError(-10, links);

  // Same weight² proportions but negative
  assertAlmostEquals(result.shares[0], -1, 1e-9);
  assertAlmostEquals(result.shares[1], -9, 1e-9);
});

// ---------------------------------------------------------------------------
// constrainAndRedistributeRecordShares
// ---------------------------------------------------------------------------

Deno.test("constrainAndRedistributeRecordShares - input links pass through unchanged", () => {
  // Input neurons have no range constraints
  const links = [
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
  ];
  const shares = [3, 7];
  const result = constrainAndRedistributeRecordShares(10, links, shares);

  assertAlmostEquals(result[0], 3, 1e-9);
  assertAlmostEquals(result[1], 7, 1e-9);
});

Deno.test("constrainAndRedistributeRecordShares - zero-weight link gets zero share", () => {
  const links = [
    makeLink({ weight: 0, fromActivation: 0.5 }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
  ];
  const shares = [5, 5];
  const result = constrainAndRedistributeRecordShares(10, links, shares);

  // Zero-weight link should be clamped to 0 share
  assertAlmostEquals(result[0], 0, 1e-9);
  // The remaining error should redistribute to the second link
  assertAlmostEquals(result[1], 10, 1e-6);
});

Deno.test("constrainAndRedistributeRecordShares - blocked safe zone gives zero share", () => {
  const links = [
    makeLink({
      weight: 1,
      fromActivation: 0.5,
      safeZoneFactor: 0,
      feasibilityFactor: 0,
    }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
  ];
  const shares = [5, 5];
  const result = constrainAndRedistributeRecordShares(10, links, shares);

  // First link is fully blocked
  assertAlmostEquals(result[0], 0, 1e-9);
  // Redistribution should push error to second link
  assertAlmostEquals(result[1], 10, 1e-6);
});

Deno.test("constrainAndRedistributeRecordShares - shares sum preserved", () => {
  const links = [
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 2, fromActivation: 0.5 }),
    makeLink({ weight: 3, fromActivation: 0.5 }),
  ];
  const shares = [2, 3, 5];
  const result = constrainAndRedistributeRecordShares(10, links, shares);

  const sum = result.reduce((a, b) => a + b, 0);
  assertAlmostEquals(sum, 10, 1e-6, "Total shares should be preserved");
});

Deno.test("constrainAndRedistributeRecordShares - handles negative error", () => {
  const links = [
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
  ];
  const shares = [-3, -7];
  const result = constrainAndRedistributeRecordShares(-10, links, shares);

  const sum = result.reduce((a, b) => a + b, 0);
  assertAlmostEquals(sum, -10, 1e-6);
});

// ---------------------------------------------------------------------------
// constrainAndRedistributeRecordShares - with real creature for range tests
// ---------------------------------------------------------------------------

Deno.test("constrainAndRedistributeRecordShares - redistributes away from range-limited squash", () => {
  // Build a creature where one hidden neuron has ABSOLUTE squash (range [0, +∞))
  // and another has IDENTITY (no limit). When we try to push negative error
  // through ABSOLUTE, it should be redistributed to IDENTITY.
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-abs", squash: "ABSOLUTE", bias: 0 },
      { type: "hidden", uuid: "hidden-id", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-abs", weight: 1 },
      { fromUUID: "input-0", toUUID: "hidden-id", weight: 1 },
      { fromUUID: "hidden-abs", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-id", toUUID: "output-0", weight: 1 },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  // Activate to populate state
  creature.activate(new Float32Array([0.5]));

  const absNeuron = creature.neurons[1]; // hidden-abs
  const idNeuron = creature.neurons[2]; // hidden-id

  const links: RecordElasticLink[] = [
    {
      synapse: creature.synapses[2], // hidden-abs -> output
      fromNeuron: absNeuron,
      fromActivation: 0.5,
      fromValue: 0.5,
      safeZoneFactor: 1,
      feasibilityFactor: recordTargetFeasibilityFactor(absNeuron, -1),
    },
    {
      synapse: creature.synapses[3], // hidden-id -> output
      fromNeuron: idNeuron,
      fromActivation: 0.5,
      fromValue: 0.5,
      safeZoneFactor: 1,
      feasibilityFactor: recordTargetFeasibilityFactor(idNeuron, -1),
    },
  ];

  // ABSOLUTE neuron should have feasibilityFactor 0.1 for negative target
  assertAlmostEquals(links[0].feasibilityFactor, 0.1, 1e-9);
  // IDENTITY neuron should have feasibilityFactor 1.0
  assertAlmostEquals(links[1].feasibilityFactor, 1, 1e-9);

  const result = distributeRecordError(-2, links);

  // IDENTITY link should receive more of the error due to higher feasibility
  assertGreater(
    Math.abs(result.shares[1]),
    Math.abs(result.shares[0]),
    "IDENTITY link should absorb more error than ABSOLUTE link",
  );
});
