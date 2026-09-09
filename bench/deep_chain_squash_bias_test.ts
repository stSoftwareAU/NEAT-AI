/**
 * Unit tests for the Issue #3974 matched-baseline harness.
 *
 * The harness's own summarising is what the committed evidence is read from,
 * so it is tested like any other code: real inputs, asserted outputs.
 */
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import type { GradientDepthProfile } from "@propagate/GradientDepthProbe.ts";
import type { GradientDepthBucket } from "@propagate/GradientDepthBuckets.ts";
import {
  assertValidSquashBiasConfig,
  histogramEntropyBits,
  measureRoleVisibility,
  poolZeroGradient,
  renderRoleVisibility,
  SQUASH_BIAS_DEFAULTS,
  withSquashBiasDefaults,
} from "./deep_chain_squash_bias.ts";

function bucket(
  depth: number,
  observations: number,
  zeroObservations: number,
): GradientDepthBucket {
  return {
    depth,
    neurons: 1,
    observations,
    zeroObservations,
    zeroFraction: observations === 0 ? 0 : zeroObservations / observations,
    meanAbsGradient: 0,
    medianAbsGradient: 0,
    p95AbsGradient: 0,
    maxAbsGradient: 0,
    signFlipComparisons: 0,
    signFlips: 0,
    signFlipRate: 0,
    zeroCauses: {
      "zero-derivative": 0,
      "unselected-min-max": 0,
      "untaken-if-branch": 0,
      "if-condition": 0,
      "zero-weight": 0,
      "downstream-zero": 0,
      cancellation: 0,
      unreached: 0,
    },
    zeroDerivativeSquashes: {},
    quantilesTruncated: false,
  };
}

Deno.test("squash-bias harness - entropy falls as the mix collapses", () => {
  assertEquals(histogramEntropyBits({}), 0);
  assertEquals(histogramEntropyBits({ TANH: 10 }), 0);
  assertAlmostEquals(histogramEntropyBits({ TANH: 5, ReLU: 5 }), 1, 1e-9);
  assert(
    histogramEntropyBits({ TANH: 9, ReLU: 1 }) <
      histogramEntropyBits({ TANH: 5, ReLU: 5 }),
    "a lopsided mix carries less entropy than an even one",
  );
});

Deno.test("squash-bias harness - pooling honours the depth filter", () => {
  const profile = {
    samples: 2,
    maxDepth: 3,
    buckets: [bucket(1, 10, 5), bucket(2, 10, 1), bucket(3, 10, 10)],
  } as GradientDepthProfile;

  const shallow = poolZeroGradient(profile, (d) => d <= 2);
  assertEquals(shallow.observations, 20);
  assertEquals(shallow.zeroObservations, 6);
  assertAlmostEquals(shallow.zeroFraction, 0.3, 1e-9);

  const none = poolZeroGradient(profile, () => false);
  assertEquals(none.observations, 0);
  assertEquals(none.zeroFraction, 0, "an empty pool reports 0, not NaN");
});

Deno.test("squash-bias harness - the config refuses a meaningless comparison", () => {
  assertEquals(withSquashBiasDefaults({}), SQUASH_BIAS_DEFAULTS);
  assertThrows(
    () => assertValidSquashBiasConfig({ ...SQUASH_BIAS_DEFAULTS, bias: 0 }),
    RangeError,
    "bias",
  );
  assertThrows(
    () =>
      assertValidSquashBiasConfig({ ...SQUASH_BIAS_DEFAULTS, minLength: 1 }),
    RangeError,
    "minLength",
  );
  assertThrows(
    () =>
      assertValidSquashBiasConfig({ ...SQUASH_BIAS_DEFAULTS, mutations: 0 }),
    RangeError,
    "mutations",
  );
});

Deno.test("squash-bias harness - role visibility counts the run against its roles", () => {
  // input-0 → a → b → c → d → output, with a second input at `a`: a five-deep
  // run whose members share their roles with the two wide neurons beside it.
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "b", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "c", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "a", weight: 1 },
      { fromUUID: "input-1", toUUID: "a", weight: 1 },
      { fromUUID: "a", toUUID: "b", weight: 1 },
      { fromUUID: "b", toUUID: "c", weight: 1 },
      { fromUUID: "c", toUUID: "output-0", weight: 1 },
    ],
  });

  const rows = measureRoleVisibility(creature);
  assert(rows.length > 0, "the run touches at least one role");
  const total = rows.reduce((sum, row) => sum + row.runMembers, 0);
  assertEquals(total, 4, "every member of the four-member run is counted");
  for (const row of rows) {
    assert(
      row.neurons >= row.runMembers,
      "a role cannot hold fewer neurons than it holds run members",
    );
  }

  const rendered = renderRoleVisibility("fixture", rows);
  assert(rendered.includes("| Role |"), "renders a table");
  assert(
    !/\|\s*mid\|/.test(rendered),
    "the pipe inside a role key is escaped so the table survives",
  );
});
