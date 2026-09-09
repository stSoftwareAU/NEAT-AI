/**
 * Tests for GradientDepthProbe.ts
 *
 * Issue #3972 — the probe answers "how much gradient actually reaches a neuron
 * at depth d". Every case below has a gradient that can be worked out by hand
 * from the topology, so the assertions are on measured numbers rather than on
 * the shape of the implementation.
 */

import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  type GradientDepthProfile,
  probeGradientDepth,
} from "@propagate/GradientDepthProbe.ts";
import { initWasmForTests } from "../_initWasm.ts";

function bucketAt(profile: GradientDepthProfile, depth: number) {
  const bucket = profile.buckets.find((b) => b.depth === depth);
  if (bucket === undefined) {
    throw new Error(
      `no bucket at depth ${depth}; have ${
        profile.buckets.map((b) => b.depth).join(", ")
      }`,
    );
  }
  return bucket;
}

/** input-0 → h1 (×2) → h2 (×3) → output (×4), all IDENTITY. */
const linearChain: CreatureExport = {
  input: 1,
  output: 1,
  neurons: [
    { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
    { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
    { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "h1", weight: 2 },
    { fromUUID: "h1", toUUID: "h2", weight: 3 },
    { fromUUID: "h2", toUUID: "output-0", weight: 4 },
  ],
};

Deno.test("GradientDepthProbe - measures the hand-computable chain gradient", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(linearChain);

  const profile = probeGradientDepth(creature, [new Float32Array([0.25])]);

  assertEquals(profile.samples, 1);
  // d(output)/d(h2) = 4, d(output)/d(h1) = 4 × 3 = 12.
  assertAlmostEquals(bucketAt(profile, 2).meanAbsGradient, 4, 1e-9);
  assertAlmostEquals(bucketAt(profile, 1).meanAbsGradient, 12, 1e-9);
  assertEquals(bucketAt(profile, 1).zeroFraction, 0);
  // The output neuron's gradient is the seed, not a measurement.
  assertEquals(profile.buckets.some((b) => b.depth === 3), false);
});

Deno.test("GradientDepthProbe - a saturated HARD_TANH zeroes and is blamed", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "HARD_TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "h2", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  });

  // 5 is outside (-1, 1), so HARD_TANH.derivative() is exactly 0.
  const saturated = probeGradientDepth(creature, [new Float32Array([5])]);
  const blockedDepth1 = bucketAt(saturated, 1);
  assertEquals(blockedDepth1.zeroFraction, 1);
  assertEquals(blockedDepth1.zeroCauses["zero-derivative"], 1);
  assertEquals(blockedDepth1.zeroDerivativeSquashes["HARD_TANH"], 1);
  // The neuron the gradient still reaches is unaffected.
  assertAlmostEquals(bucketAt(saturated, 2).meanAbsGradient, 1, 1e-9);

  // 0.5 is inside the linear region, so the same neuron now carries gradient.
  const live = probeGradientDepth(creature, [new Float32Array([0.5])]);
  assertEquals(bucketAt(live, 1).zeroFraction, 0);
  assertAlmostEquals(bucketAt(live, 1).meanAbsGradient, 1, 1e-9);
});

Deno.test("GradientDepthProbe - MINIMUM feeds only the winning branch", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "low", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "high", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "pick", squash: "MINIMUM", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "low", weight: 1 },
      { fromUUID: "input-1", toUUID: "high", weight: 1 },
      { fromUUID: "low", toUUID: "pick", weight: 1 },
      { fromUUID: "high", toUUID: "pick", weight: 1 },
      { fromUUID: "pick", toUUID: "output-0", weight: 1 },
    ],
  });

  const profile = probeGradientDepth(creature, [new Float32Array([0.1, 0.9])]);
  const depth1 = bucketAt(profile, 1);

  // Two neurons at depth 1; only the argmin (`low`) keeps its gradient.
  assertEquals(depth1.neurons, 2);
  assertEquals(depth1.observations, 2);
  assertEquals(depth1.zeroObservations, 1);
  assertEquals(depth1.zeroCauses["unselected-min-max"], 1);
  assertAlmostEquals(depth1.maxAbsGradient, 1, 1e-9);
});

Deno.test("GradientDepthProbe - IF gates the untaken branch and the condition", async () => {
  await initWasmForTests();
  const ifCreature: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "cond", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "pos", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "neg", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "gate", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "cond", weight: 1 },
      { fromUUID: "input-1", toUUID: "pos", weight: 1 },
      { fromUUID: "input-2", toUUID: "neg", weight: 1 },
      { fromUUID: "cond", toUUID: "gate", weight: 1, type: "condition" },
      { fromUUID: "pos", toUUID: "gate", weight: 1, type: "positive" },
      { fromUUID: "neg", toUUID: "gate", weight: 1, type: "negative" },
      { fromUUID: "gate", toUUID: "output-0", weight: 1 },
    ],
  };

  const positive = probeGradientDepth(
    Creature.fromJSON(ifCreature),
    [new Float32Array([1, 0.5, 0.5])],
  );
  const positiveDepth1 = bucketAt(positive, 1);
  // `cond` is gated by the threshold, `neg` is the untaken branch.
  assertEquals(positiveDepth1.zeroObservations, 2);
  assertEquals(positiveDepth1.zeroCauses["if-condition"], 1);
  assertEquals(positiveDepth1.zeroCauses["untaken-if-branch"], 1);

  const negative = probeGradientDepth(
    Creature.fromJSON(ifCreature),
    [new Float32Array([-1, 0.5, 0.5])],
  );
  const negativeDepth1 = bucketAt(negative, 1);
  assertEquals(negativeDepth1.zeroObservations, 2);
  assertEquals(negativeDepth1.zeroCauses["if-condition"], 1);
  assertEquals(negativeDepth1.zeroCauses["untaken-if-branch"], 1);
});

Deno.test("GradientDepthProbe - sign flips are counted between consecutive samples", async () => {
  await initWasmForTests();
  // The gate picks the +1 branch or the −1 branch depending on the condition,
  // so the gradient reaching `src` reverses sign whenever the condition does.
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "cond", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "src", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "gate", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "cond", weight: 1 },
      { fromUUID: "input-1", toUUID: "src", weight: 1 },
      { fromUUID: "cond", toUUID: "gate", weight: 1, type: "condition" },
      { fromUUID: "src", toUUID: "gate", weight: 1, type: "positive" },
      { fromUUID: "src", toUUID: "gate", weight: -1, type: "negative" },
      { fromUUID: "gate", toUUID: "output-0", weight: 1 },
    ],
  });

  const alternating = probeGradientDepth(creature, [
    new Float32Array([1, 0.5]),
    new Float32Array([-1, 0.5]),
    new Float32Array([1, 0.5]),
  ]);
  const depth1 = bucketAt(alternating, 1);
  // `src` is compared twice and reverses both times; `cond` is always zero, so
  // it never contributes a comparison.
  assertEquals(depth1.signFlipComparisons, 2);
  assertEquals(depth1.signFlips, 2);
  assertEquals(depth1.signFlipRate, 1);

  const steady = probeGradientDepth(creature, [
    new Float32Array([1, 0.5]),
    new Float32Array([1, 0.25]),
    new Float32Array([1, 0.75]),
  ]);
  assertEquals(bucketAt(steady, 1).signFlipComparisons, 2);
  assertEquals(bucketAt(steady, 1).signFlips, 0);
  assertEquals(bucketAt(steady, 1).signFlipRate, 0);
});

Deno.test("GradientDepthProbe - rejects an empty or mis-shaped sample set", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(linearChain);

  assertThrows(
    () => probeGradientDepth(creature, []),
    RangeError,
    "at least one sample",
  );
  assertThrows(
    () => probeGradientDepth(creature, [new Float32Array([1, 2])]),
    RangeError,
    "does not match creature input",
  );
  assertThrows(
    () =>
      probeGradientDepth(creature, [new Float32Array([1])], {
        quantileSampleLimit: 0,
      }),
    RangeError,
    "positive integer",
  );
});

Deno.test("GradientDepthProbe - quantile truncation is reported, never silent", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(linearChain);
  const samples = [
    new Float32Array([0.1]),
    new Float32Array([0.2]),
    new Float32Array([0.3]),
  ];

  const truncated = probeGradientDepth(creature, samples, {
    quantileSampleLimit: 1,
  });
  assertEquals(bucketAt(truncated, 1).quantilesTruncated, true);
  assertEquals(bucketAt(truncated, 1).observations, 3);

  const complete = probeGradientDepth(creature, samples);
  assertEquals(bucketAt(complete, 1).quantilesTruncated, false);
});

Deno.test("GradientDepthProbe - a MINIMUM runner-up inside the window still carries gradient", async () => {
  await initWasmForTests();
  // The engine leaks `RUNNER_UP_LEAK_FRACTION * proximity` of the error to a
  // loser within 20% of the winner's magnitude (Issue #1874); a probe that
  // ignored that would report a dead route the trainer still feeds.
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "low", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "near", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "pick", squash: "MINIMUM", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "low", weight: 1 },
      { fromUUID: "input-1", toUUID: "near", weight: 1 },
      { fromUUID: "low", toUUID: "pick", weight: 1 },
      { fromUUID: "near", toUUID: "pick", weight: 1 },
      { fromUUID: "pick", toUUID: "output-0", weight: 1 },
    ],
  });

  // Winner 0.1, runner-up 0.11: distance 0.01 against a 0.1 x 0.2 = 0.02
  // window, so proximity is 0.5 and the leak is 0.15 x 0.5 = 0.075.
  const inWindow = probeGradientDepth(creature, [
    new Float32Array([0.1, 0.11]),
  ]);
  const near = bucketAt(inWindow, 1);
  assertEquals(near.zeroObservations, 0);
  assertAlmostEquals(near.maxAbsGradient, 1, 1e-9);
  assertAlmostEquals(near.meanAbsGradient, (1 + 0.075) / 2, 1e-6);

  // Runner-up 0.9 sits far outside the window and is blocked as before.
  const outOfWindow = probeGradientDepth(creature, [
    new Float32Array([0.1, 0.9]),
  ]);
  const far = bucketAt(outOfWindow, 1);
  assertEquals(far.zeroObservations, 1);
  assertEquals(far.zeroCauses["unselected-min-max"], 1);
});

Deno.test("GradientDepthProbe - attribution counts every blocked route, not one winner", async () => {
  await initWasmForTests();
  // `src` feeds two saturated HARD_TANH neurons, so one zero measurement is
  // blamed twice — once per blocked route. A winner-takes-all attribution
  // would report 1 and hide the second route.
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "src", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "a", squash: "HARD_TANH", bias: 0 },
      { type: "hidden", uuid: "b", squash: "HARD_TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "src", weight: 1 },
      { fromUUID: "src", toUUID: "a", weight: 1 },
      { fromUUID: "src", toUUID: "b", weight: 1 },
      { fromUUID: "a", toUUID: "output-0", weight: 1 },
      { fromUUID: "b", toUUID: "output-0", weight: 1 },
    ],
  });

  const profile = probeGradientDepth(creature, [new Float32Array([5])]);
  const depth1 = bucketAt(profile, 1);
  assertEquals(depth1.zeroObservations, 1);
  assertEquals(depth1.zeroCauses["zero-derivative"], 2);
  assertEquals(depth1.zeroDerivativeSquashes["HARD_TANH"], 2);
});

Deno.test("GradientDepthProbe - the serial-chain cut names its range and what it measured", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "b", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "a", weight: 1 },
      { fromUUID: "input-1", toUUID: "a", weight: 1 },
      { fromUUID: "a", toUUID: "b", weight: 1 },
      { fromUUID: "b", toUUID: "output-0", weight: 1 },
    ],
  });

  const profile = probeGradientDepth(creature, [new Float32Array([0.2, 0.3])]);
  const chain = profile.serialChainProfile!;
  assertEquals(chain.startDepth, 1);
  assertEquals(chain.endDepth, 3);
  assertEquals(chain.totalMembers, 3);
  // The depth-3 output carries the seed, so only two members are measured.
  assertEquals(chain.measuredNeurons, 2);
  assertEquals(chain.aggregate.observations, 2);
});

Deno.test("GradientDepthProbe - percentiles are nearest-rank over the measurements", async () => {
  await initWasmForTests();
  // One neuron at depth 1 whose gradient is the output weight; four samples
  // give four identical magnitudes, so every quantile is that value.
  const creature = Creature.fromJSON(linearChain);
  const profile = probeGradientDepth(creature, [
    new Float32Array([0.1]),
    new Float32Array([0.2]),
    new Float32Array([0.3]),
    new Float32Array([0.4]),
  ]);
  const depth1 = bucketAt(profile, 1);
  assertEquals(depth1.observations, 4);
  assertAlmostEquals(depth1.medianAbsGradient, 12, 1e-9);
  assertAlmostEquals(depth1.p95AbsGradient, 12, 1e-9);
  assertAlmostEquals(depth1.maxAbsGradient, 12, 1e-9);
});
