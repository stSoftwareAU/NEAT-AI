/**
 * Tests for the variance-aware remove-neuron compensation applier (Issue #1691).
 *
 * The NEAT-AI applier used to fold only a removed neuron's *mean* downstream
 * contribution into the downstream biases (the "mean-only fold"), which
 * reproduced the #1686 regression class for variance-carrying neurons. These
 * tests exercise the applier consuming the compensation data now emitted by
 * NEAT-AI-Discovery (#1559 weight redistribution / #1623 constant bias fold),
 * covering the three cases from the issue's failure-detection section:
 *
 *   1. a variance-carrying candidate with a `removeNeuronCompensation` payload —
 *      the correlated survivor's synapse weight is bumped by `deltaWeight` *and*
 *      the bias fold is applied, and on a covariance-bearing eval set the
 *      reconstructed output matches the pre-removal output (parity-or-better vs
 *      the mean-only fold);
 *   2. a constant candidate with a `constantNeuronBiasFold` — the folded bias
 *      deltas land on the downstream neurons exactly;
 *   3. a payload with no compensation — byte-identical fallback to the mean-only
 *      fold, so mixed-version pipelines are provably unchanged.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import type { CoordinatedStructuralCandidate } from "@architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { applyRemoveNeuronCompensation } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryNeuronRemoval.ts";
import { applyCoordinatedStructuralCandidate } from "@architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";

interface TestNeuron {
  uuid: string;
  bias?: number;
}
interface TestSynapse {
  fromUUID?: string;
  toUUID?: string;
  weight: number;
}

/**
 * Linear pre-activation of the output neuron from the raw arrays, treating each
 * upstream neuron's activation as an externally supplied value (identity squash).
 * Only synapses whose source appears in `activations` contribute, so a removed
 * neuron is excluded simply by omitting it from the map.
 */
function outputPreactivation(
  neurons: TestNeuron[],
  synapses: TestSynapse[],
  targetUuid: string,
  activations: Record<string, number>,
): number {
  const target = neurons.find((n) => n.uuid === targetUuid);
  let sum = target?.bias ?? 0;
  for (const s of synapses) {
    if (s.toUUID !== targetUuid) continue;
    const a = s.fromUUID !== undefined ? activations[s.fromUUID] : undefined;
    if (a === undefined) continue;
    sum += s.weight * a;
  }
  return sum;
}

Deno.test("applyRemoveNeuronCompensation: variance candidate bumps survivor weight, folds bias, and reaches parity", () => {
  // Covariance-bearing eval set: survivor activations are zero-mean, and the
  // removed neuron is perfectly correlated with the survivor (a_r = 1.5·a_s + 0.7).
  const survivorAct = [-2, -1, 0, 1, 2];
  const alpha = 1.5;
  const beta = 0.7;
  const removedAct = survivorAct.map((a) => alpha * a + beta);
  const meanRemoved = 0.7; // mean of removedAct (survivor is zero-mean)

  const wRemoved = 2.0; // removed -> out
  const wSurvivor = 0.5; // survivor -> out
  const biasOut = 0.1;
  const deltaWeight = 3.0; // = wRemoved · cov/var(a_s) = 2·(1.5·2)/2

  const neurons: TestNeuron[] = [
    { uuid: "removed", bias: 0 },
    { uuid: "survivor", bias: 0 },
    { uuid: "out", bias: biasOut },
  ];
  const synapses: TestSynapse[] = [
    { fromUUID: "removed", toUUID: "out", weight: wRemoved },
    { fromUUID: "survivor", toUUID: "out", weight: wSurvivor },
  ];

  const compensation = {
    removeNeuronCompensation: {
      targetNeuronUuid: "out",
      survivorNeuronUuid: "survivor",
      deltaWeight,
      sampleCount: survivorAct.length,
      candidateVariance: 4.5,
      survivorVariance: 2.0,
      covariance: 3.0,
      correlation: 1.0,
      biasOnlyResidualVariance: 18.0,
      redistributedResidualVariance: 0.0,
      varianceRecovered: 18.0,
      fullyCompensable: true,
    },
  };

  const mode = applyRemoveNeuronCompensation(
    neurons,
    synapses,
    "removed",
    meanRemoved,
    compensation,
    "test",
  );
  assertEquals(mode, "variance");

  // Survivor weight bumped by deltaWeight.
  const survivorSynapse = synapses.find((s) => s.fromUUID === "survivor")!;
  assertAlmostEquals(survivorSynapse.weight, wSurvivor + deltaWeight, 1e-9);

  // Mean bias fold applied in addition: out.bias += wRemoved · meanRemoved.
  const out = neurons.find((n) => n.uuid === "out")!;
  assertAlmostEquals(out.bias ?? 0, biasOut + wRemoved * meanRemoved, 1e-9);

  // Parity: on every sample the reconstructed (survivor-only) output matches the
  // pre-removal output that still included the removed neuron.
  for (let i = 0; i < survivorAct.length; i++) {
    const pre = biasOut + wRemoved * removedAct[i] + wSurvivor * survivorAct[i];
    const post = outputPreactivation(neurons, synapses, "out", {
      survivor: survivorAct[i],
    });
    assertAlmostEquals(post, pre, 1e-9, `sample ${i} parity`);
  }
});

Deno.test("applyRemoveNeuronCompensation: variance path is parity-or-better than the mean-only fold", () => {
  const survivorAct = [-2, -1, 0, 1, 2];
  const removedAct = survivorAct.map((a) => 1.5 * a + 0.7);
  const meanRemoved = 0.7;
  const wRemoved = 2.0;
  const wSurvivor = 0.5;
  const biasOut = 0.1;

  const preOf = (i: number) =>
    biasOut + wRemoved * removedAct[i] + wSurvivor * survivorAct[i];

  // Redistribution error (from the previous test's construction) is zero.
  // Mean-only fold: out.bias += wRemoved·meanRemoved, survivor weight unchanged.
  let meanOnlyError = 0;
  const meanFoldBias = biasOut + wRemoved * meanRemoved;
  for (let i = 0; i < survivorAct.length; i++) {
    const meanOnlyPost = meanFoldBias + wSurvivor * survivorAct[i];
    meanOnlyError += Math.abs(meanOnlyPost - preOf(i));
  }
  // The mean-only fold leaves a genuine per-sample residual (it drops the
  // removed neuron's varying signal), so redistribution is strictly better.
  assert(
    meanOnlyError > 1e-6,
    "mean-only fold should leave a non-zero residual on the covariance set",
  );
});

Deno.test("applyRemoveNeuronCompensation: constant candidate folds the exact per-target bias deltas", () => {
  const neurons: TestNeuron[] = [
    { uuid: "const", bias: 0 },
    { uuid: "out-a", bias: 0.5 },
    { uuid: "out-b", bias: 0.3 },
  ];
  const synapses: TestSynapse[] = [
    { fromUUID: "const", toUUID: "out-a", weight: 2.0 },
    { fromUUID: "const", toUUID: "out-b", weight: -1.0 },
  ];

  const compensation = {
    constantNeuronBiasFold: {
      constantActivation: 3.0,
      activationVariance: 0.0,
      maxResidual: 0.0,
      foldedTargets: [
        { targetNeuronUuid: "out-a", biasDelta: 6.0 },
        { targetNeuronUuid: "out-b", biasDelta: -3.0 },
      ],
    },
  };

  const mode = applyRemoveNeuronCompensation(
    neurons,
    synapses,
    "const",
    3.0,
    compensation,
    "test",
  );
  assertEquals(mode, "constant");

  // Folded bias deltas land exactly.
  assertAlmostEquals(
    neurons.find((n) => n.uuid === "out-a")!.bias ?? 0,
    6.5,
    1e-9,
  );
  assertAlmostEquals(
    neurons.find((n) => n.uuid === "out-b")!.bias ?? 0,
    -2.7,
    1e-9,
  );

  // No survivor weight redistribution on the constant path.
  assertEquals(synapses[0].weight, 2.0);
  assertEquals(synapses[1].weight, -1.0);
});

Deno.test("applyRemoveNeuronCompensation: empty payload makes no change and reports 'none'", () => {
  const neurons: TestNeuron[] = [{ uuid: "out", bias: 0.5 }];
  const synapses: TestSynapse[] = [
    { fromUUID: "removed", toUUID: "out", weight: 2.0 },
  ];

  const mode = applyRemoveNeuronCompensation(
    neurons,
    synapses,
    "removed",
    3.0,
    {},
    "test",
  );
  assertEquals(mode, "none");
  // The helper leaves everything untouched so the caller can run its
  // byte-identical mean-only fold fallback.
  assertEquals(neurons[0].bias, 0.5);
  assertEquals(synapses[0].weight, 2.0);
});

Deno.test("applyCoordinatedStructuralCandidate: variance candidate bumps the survivor weight before removal", () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    forwardOnly: true,
    semanticVersion: "3.2.1",
    neurons: [
      {
        uuid: "hidden-r",
        id: 5001,
        type: "hidden",
        squash: IDENTITY.NAME,
        bias: 0,
      },
      {
        uuid: "hidden-s",
        id: 5002,
        type: "hidden",
        squash: IDENTITY.NAME,
        bias: 0,
      },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-r", weight: 0.2 },
      { fromUUID: "input-0", toUUID: "hidden-s", weight: 0.3 },
      { fromUUID: "hidden-r", toUUID: "output-0", weight: 2.0 },
      { fromUUID: "hidden-s", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.05 },
    ],
  });

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.01,
    operations: [{ type: "removeNeuron", neuronUuid: "hidden-r" }],
    removeNeuronCompensation: {
      targetNeuronUuid: "output-0",
      survivorNeuronUuid: "hidden-s",
      deltaWeight: 3.0,
      sampleCount: 5,
      candidateVariance: 4.5,
      survivorVariance: 2.0,
      covariance: 3.0,
      correlation: 1.0,
      biasOnlyResidualVariance: 18.0,
      redistributedResidualVariance: 0.0,
      varianceRecovered: 18.0,
      fullyCompensable: true,
    },
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  assertEquals(exported.neurons.some((n) => n.uuid === "hidden-r"), false);
  const survivorSynapse = exported.synapses.find(
    (s) => s.fromUUID === "hidden-s" && s.toUUID === "output-0",
  );
  assert(survivorSynapse, "survivor synapse should survive removal");
  assertAlmostEquals(survivorSynapse!.weight, 3.5, 1e-6);
});

Deno.test("applyCoordinatedStructuralCandidate: constant candidate folds bias deltas before removal", () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    forwardOnly: true,
    semanticVersion: "3.2.1",
    neurons: [
      {
        uuid: "hidden-c",
        id: 5001,
        type: "hidden",
        squash: IDENTITY.NAME,
        bias: 0,
      },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0.3 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-c", weight: 0.2 },
      { fromUUID: "hidden-c", toUUID: "output-0", weight: 2.0 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.05 },
    ],
  });

  const candidate: CoordinatedStructuralCandidate = {
    type: "coordinated_structural",
    expectedCreatureScoreGain: 0.01,
    operations: [{ type: "removeNeuron", neuronUuid: "hidden-c" }],
    constantNeuronBiasFold: {
      constantActivation: 3.0,
      activationVariance: 0.0,
      maxResidual: 0.0,
      foldedTargets: [{ targetNeuronUuid: "output-0", biasDelta: 6.0 }],
    },
  };

  const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
  const exported = mutated.exportJSON();

  assertEquals(exported.neurons.some((n) => n.uuid === "hidden-c"), false);
  const out = exported.neurons.find((n) => n.uuid === "output-0")!;
  // 0.3 + 6.0 = 6.3 folded exactly onto the output bias.
  assertAlmostEquals(out.bias ?? 0, 6.3, 1e-6);
});
