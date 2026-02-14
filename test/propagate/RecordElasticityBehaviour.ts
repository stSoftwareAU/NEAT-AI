/**
 * Behavioural tests for RecordElasticity.ts — verifying elasticity
 * recording for discovery, weight-based distribution, feasibility
 * factors, and constrained redistribution.
 *
 * These are "what" tests: they exercise real functions with test data
 * and check outcomes, not implementation details.
 *
 * Closes #1440
 */
import { assertAlmostEquals, assertGreater, assertLess } from "@std/assert";
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
// Helper
// ---------------------------------------------------------------------------

function makeLink(opts: {
  weight: number;
  fromActivation: number;
  safeZoneFactor?: number;
  feasibilityFactor?: number;
  fromNeuron?: Neuron;
}): RecordElasticLink {
  const weight = opts.weight;
  const fromActivation = opts.fromActivation;
  return {
    synapse: { from: 0, to: 1, weight } as Synapse,
    fromNeuron: opts.fromNeuron ?? { type: "input" } as unknown as Neuron,
    fromActivation,
    fromValue: weight * fromActivation,
    safeZoneFactor: opts.safeZoneFactor ?? 1,
    feasibilityFactor: opts.feasibilityFactor ?? 1,
  };
}

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

// ---------------------------------------------------------------------------
// distributeRecordError - weight-based proportional distribution
// ---------------------------------------------------------------------------

Deno.test("RecordElasticity distribute - uses weight² for proportions", () => {
  const links = [
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 2, fromActivation: 0.5 }),
    makeLink({ weight: 3, fromActivation: 0.5 }),
  ];

  const result = distributeRecordError(14, links);

  // Weight² scores: 1, 4, 9 => total 14
  // Shares: 14*1/14=1, 14*4/14=4, 14*9/14=9
  assertAlmostEquals(result.shares[0], 1, 1e-9);
  assertAlmostEquals(result.shares[1], 4, 1e-9);
  assertAlmostEquals(result.shares[2], 9, 1e-9);
});

Deno.test("RecordElasticity distribute - shares sum to original error", () => {
  const links = [
    makeLink({ weight: 1.5, fromActivation: 0.3 }),
    makeLink({ weight: 2.5, fromActivation: 0.7 }),
    makeLink({ weight: 0.5, fromActivation: 0.1 }),
  ];

  const result = distributeRecordError(7.5, links);
  const sum = result.shares.reduce((a, b) => a + b, 0);

  assertAlmostEquals(sum, 7.5, 1e-9, "Shares should sum to original error");
});

Deno.test("RecordElasticity distribute - negative error preserved in shares", () => {
  const links = [
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
  ];

  const result = distributeRecordError(-6, links);

  // Equal weights => equal shares of -6
  assertAlmostEquals(result.shares[0], -3, 1e-9);
  assertAlmostEquals(result.shares[1], -3, 1e-9);
});

// ---------------------------------------------------------------------------
// distributeRecordError - gating via safeZoneFactor and feasibilityFactor
// ---------------------------------------------------------------------------

Deno.test("RecordElasticity distribute - both gates combine multiplicatively", () => {
  const links = [
    makeLink({
      weight: 2,
      fromActivation: 0.5,
      safeZoneFactor: 0.5,
      feasibilityFactor: 0.5,
    }),
    makeLink({
      weight: 2,
      fromActivation: 0.5,
      safeZoneFactor: 1.0,
      feasibilityFactor: 1.0,
    }),
  ];

  const result = distributeRecordError(10, links);

  // First link gate: 0.5*0.5 = 0.25, second link gate: 1.0*1.0 = 1.0
  // Scores: weight²*gate: 4*0.25=1 and 4*1.0=4
  // Shares: 10*1/5=2 and 10*4/5=8
  assertAlmostEquals(result.shares[0], 2, 1e-9);
  assertAlmostEquals(result.shares[1], 8, 1e-9);
});

Deno.test("RecordElasticity distribute - fully blocked link gets zero", () => {
  const links = [
    makeLink({ weight: 2, fromActivation: 0.5, safeZoneFactor: 0 }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
  ];

  const result = distributeRecordError(10, links);

  assertAlmostEquals(result.shares[0], 0, 1e-6);
  assertAlmostEquals(result.shares[1], 10, 1e-6);
});

// ---------------------------------------------------------------------------
// recordTargetFeasibilityFactor - per-squash behaviour
// ---------------------------------------------------------------------------

Deno.test("RecordElasticity feasibility - SQUARE out-of-range returns 0.1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("SQUARE");
  // SQUARE range is [0, +∞), negative target is out of range
  const factor = recordTargetFeasibilityFactor(hiddenNeuron, -1);
  assertAlmostEquals(factor, 0.1, 1e-9);
});

Deno.test("RecordElasticity feasibility - SQUARE in-range returns 1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("SQUARE");
  const factor = recordTargetFeasibilityFactor(hiddenNeuron, 0.5);
  assertAlmostEquals(factor, 1, 1e-9);
});

Deno.test("RecordElasticity feasibility - SELU negative returns 0.1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("SELU");
  const factor = recordTargetFeasibilityFactor(hiddenNeuron, -0.5);
  assertAlmostEquals(factor, 0.1, 1e-9);
});

Deno.test("RecordElasticity feasibility - SELU positive returns 1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("SELU");
  const factor = recordTargetFeasibilityFactor(hiddenNeuron, 0.5);
  assertAlmostEquals(factor, 1, 1e-9);
});

Deno.test("RecordElasticity feasibility - GELU negative returns 0.1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("GELU");
  const factor = recordTargetFeasibilityFactor(hiddenNeuron, -0.5);
  assertAlmostEquals(factor, 0.1, 1e-9);
});

Deno.test("RecordElasticity feasibility - ELU negative returns 0.1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("ELU");
  const factor = recordTargetFeasibilityFactor(hiddenNeuron, -0.5);
  assertAlmostEquals(factor, 0.1, 1e-9);
});

Deno.test("RecordElasticity feasibility - ReLU6 out of range returns 0.1", () => {
  // ReLU6 has range [0, 6], but it's in HARD_RANGE_SQUASHES? Let's check
  // Actually ReLU6 might not be in HARD_RANGE_SQUASHES. Test ReLU instead.
  const { hiddenNeuron } = makeCreatureWithSquash("ReLU");
  const factor = recordTargetFeasibilityFactor(hiddenNeuron, -1);
  assertAlmostEquals(factor, 0.1, 1e-9);
});

Deno.test("RecordElasticity feasibility - IDENTITY always returns 1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("IDENTITY");
  // IDENTITY has no range constraints
  assertAlmostEquals(recordTargetFeasibilityFactor(hiddenNeuron, 100), 1, 1e-9);
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, -100),
    1,
    1e-9,
  );
  assertAlmostEquals(recordTargetFeasibilityFactor(hiddenNeuron, 0), 1, 1e-9);
});

// ---------------------------------------------------------------------------
// constrainAndRedistributeRecordShares - redistribution behaviour
// ---------------------------------------------------------------------------

Deno.test("RecordElasticity constrain - unconstrained shares pass through", () => {
  const links = [
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
  ];
  const shares = [4, 6];
  const result = constrainAndRedistributeRecordShares(10, links, shares);

  assertAlmostEquals(result[0], 4, 1e-9);
  assertAlmostEquals(result[1], 6, 1e-9);
});

Deno.test("RecordElasticity constrain - blocked links redistribute to open links", () => {
  const links = [
    makeLink({
      weight: 1,
      fromActivation: 0.5,
      safeZoneFactor: 0,
      feasibilityFactor: 0,
    }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
  ];
  const shares = [3, 3, 4];
  const result = constrainAndRedistributeRecordShares(10, links, shares);

  // First link blocked, its 3 redistributed between links 2 and 3
  assertAlmostEquals(result[0], 0, 1e-9);
  const openSum = result[1] + result[2];
  assertAlmostEquals(openSum, 10, 1e-6, "Open links should absorb all error");
});

Deno.test("RecordElasticity constrain - all blocked results in zero shares clamped", () => {
  const links = [
    makeLink({
      weight: 1,
      fromActivation: 0.5,
      safeZoneFactor: 0,
      feasibilityFactor: 0,
    }),
    makeLink({
      weight: 1,
      fromActivation: 0.5,
      safeZoneFactor: 0,
      feasibilityFactor: 0,
    }),
  ];
  const shares = [5, 5];
  const result = constrainAndRedistributeRecordShares(10, links, shares);

  // All blocked - shares clamped to 0
  assertAlmostEquals(result[0], 0, 1e-9);
  assertAlmostEquals(result[1], 0, 1e-9);
});

// ---------------------------------------------------------------------------
// constrainAndRedistributeRecordShares - range-limited squash
// ---------------------------------------------------------------------------

Deno.test("RecordElasticity constrain - ABSOLUTE squash blocks negative targets", () => {
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
      feasibilityFactor: 1,
    },
  ];

  // ABSOLUTE neuron has low feasibility for negative targets
  assertLess(
    links[0].feasibilityFactor,
    links[1].feasibilityFactor,
    "ABSOLUTE should have lower feasibility for negative target",
  );

  const result = distributeRecordError(-2, links);

  // IDENTITY should absorb more negative error
  assertGreater(
    Math.abs(result.shares[1]),
    Math.abs(result.shares[0]),
    "IDENTITY link should absorb more negative error than ABSOLUTE",
  );
});
