/**
 * The acquisition rule, not an argmax (Issue #3933).
 *
 * Two load-bearing behaviours: a candidate the model **refused** to predict is
 * evaluated exactly whatever its neighbours look like, and a stated minimum
 * fraction of the slots goes to the candidates the model is least sure about
 * even when it predicts them to be poor. The second is the one an implementer
 * under time pressure drops, and it is the reason this issue exists.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  allocateExactEvaluations,
  type AllocationDiagnostics,
  assertUncertaintyFloor,
} from "@surrogate/ExactEvaluationAllocator.ts";
import type { SurrogateVerdict } from "@surrogate/UncertainSurrogate.ts";
import {
  DEFAULT_SURROGATE_UNCERTAINTY_CONFIG,
  type RequiredSurrogateUncertaintyConfig,
  resolveSurrogateUncertaintyConfig,
} from "@config/SurrogateUncertaintyConfig.ts";
import { SurrogateUncertaintyError } from "@errors/SurrogateUncertaintyError.ts";

/** A prediction verdict. */
function p(value: number, uncertainty: number): SurrogateVerdict {
  return { kind: "prediction", value, uncertainty };
}

/** A refusal verdict. */
function ood(distance = 4): SurrogateVerdict {
  return {
    kind: "out-of-distribution",
    reason: "nothing archived within reach",
    distance,
    limit: 1,
  };
}

/** The guard configuration, with overrides. */
function config(
  overrides: Parameters<typeof resolveSurrogateUncertaintyConfig>[0] = {},
): RequiredSurrogateUncertaintyConfig {
  return resolveSurrogateUncertaintyConfig(overrides);
}

Deno.test("allocation — the refusals are evaluated first", () => {
  const verdicts = [
    p(0.9, 0.001),
    ood(),
    p(0.8, 0.001),
    ood(),
    p(0.7, 0.001),
  ];
  const { slots, diagnostics } = allocateExactEvaluations(
    verdicts,
    3,
    0.5,
    config({ minUncertaintyFraction: 0 }),
  );
  assertEquals(slots.length, 3);
  assertEquals(slots[0].reason, "out-of-distribution");
  assertEquals(slots[1].reason, "out-of-distribution");
  assertEquals(slots.slice(0, 2).map((slot) => slot.index), [1, 3]);
  assertEquals(diagnostics.outOfDistribution, 2);
  assertEquals(diagnostics.outOfDistributionRate, 2 / 5);
  // A refusal has no acquisition value; reporting 0 would read as "worthless".
  assertEquals(slots[0].acquisition, null);
});

Deno.test("allocation — the floor spends on uncertainty the model calls mediocre", () => {
  // Every uncertain candidate is predicted *below* every confident one, so an
  // argmax would never touch them.
  const verdicts = [
    p(0.90, 0.0001),
    p(0.89, 0.0001),
    p(0.88, 0.0001),
    p(0.87, 0.0001),
    p(0.10, 0.5),
    p(0.09, 0.4),
  ];
  const { slots, diagnostics } = allocateExactEvaluations(
    verdicts,
    4,
    0.5,
    config({ minUncertaintyFraction: 0.5, acquisition: "lcb", kappa: 0 }),
  );
  const uncertaintySlots = slots.filter((slot) =>
    slot.reason === "uncertainty"
  );
  assertEquals(uncertaintySlots.length, 2);
  assertEquals(uncertaintySlots.map((slot) => slot.index), [4, 5]);
  assertEquals(diagnostics.uncertaintyFraction, 0.5);
  // With kappa 0 the remaining slots are the pure argmax, which is exactly
  // what the floor is protecting the model from being fed only.
  assertEquals(
    slots.filter((slot) => slot.reason === "acquisition").map((s) => s.index),
    [0, 1],
  );
});

Deno.test("allocation — a zero floor degenerates to the argmax the issue warns about", () => {
  const verdicts = [
    p(0.90, 0.0001),
    p(0.10, 0.9),
    p(0.89, 0.0001),
  ];
  const { slots, diagnostics } = allocateExactEvaluations(
    verdicts,
    2,
    0.5,
    config({ minUncertaintyFraction: 0, acquisition: "lcb", kappa: 0 }),
  );
  assertEquals(slots.map((slot) => slot.reason), [
    "acquisition",
    "acquisition",
  ]);
  assertEquals(slots.map((slot) => slot.index), [0, 2]);
  assertEquals(diagnostics.uncertaintyFraction, 0);
});

Deno.test("allocation — expected improvement outranks a confident incumbent-beater", () => {
  const verdicts = [p(0.41, 0.0001), p(0.35, 0.2)];
  const { slots } = allocateExactEvaluations(
    verdicts,
    1,
    0.4,
    config({ minUncertaintyFraction: 0, acquisition: "ei" }),
  );
  assertEquals(slots[0].index, 1);
  assert((slots[0].acquisition ?? 0) > 0);
});

Deno.test("allocation — fewer candidates than slots allocates what exists", () => {
  const { slots, diagnostics } = allocateExactEvaluations(
    [p(0.5, 0.1), ood()],
    10,
    0.4,
    config(),
  );
  assertEquals(slots.length, 2);
  assertEquals(diagnostics.candidates, 2);
  assertEquals(diagnostics.slots, 10);
});

Deno.test("allocation — no slots allocates nothing rather than failing", () => {
  const { slots, diagnostics } = allocateExactEvaluations(
    [p(0.5, 0.1)],
    0,
    0.4,
    config(),
  );
  assertEquals(slots.length, 0);
  assertEquals(diagnostics.uncertaintyFraction, 0);
});

Deno.test("allocation — a nonsense slot count fails loud", () => {
  for (const slots of [-1, 1.5, Number.NaN]) {
    const error = assertThrows(
      () => allocateExactEvaluations([p(0.5, 0.1)], slots, 0.4, config()),
      SurrogateUncertaintyError,
    );
    assertEquals(error.reason, "INVALID_ALLOCATION_REQUEST");
  }
});

Deno.test("allocation — expected improvement refuses a run with no incumbent", () => {
  const error = assertThrows(
    () =>
      allocateExactEvaluations(
        [p(0.5, 0.1)],
        1,
        -Infinity,
        config({
          acquisition: "ei",
        }),
      ),
    SurrogateUncertaintyError,
  );
  assertEquals(error.reason, "INVALID_ALLOCATION_REQUEST");
});

Deno.test("allocation — the allocations this allocator produces honour the floor", () => {
  const verdicts = Array.from(
    { length: 30 },
    (_, i) => i % 7 === 0 ? ood() : p(0.5 - i * 0.01, 0.001 + i * 0.002),
  );
  const { diagnostics } = allocateExactEvaluations(
    verdicts,
    10,
    0.6,
    DEFAULT_SURROGATE_UNCERTAINTY_CONFIG,
  );
  assert(
    diagnostics.uncertaintyFraction >=
      DEFAULT_SURROGATE_UNCERTAINTY_CONFIG.minUncertaintyFraction,
  );
  assertUncertaintyFloor(diagnostics);
});

Deno.test("uncertainty floor — an argmax-shaped allocation is refused", () => {
  // What a policy that dropped the exploration band would report: every slot
  // spent by rank, none on uncertainty.
  const argmax: AllocationDiagnostics = {
    rule: "ei",
    candidates: 30,
    slots: 10,
    outOfDistribution: 4,
    outOfDistributionRate: 4 / 30,
    outOfDistributionSlots: 0,
    uncertaintySlots: 0,
    acquisitionSlots: 10,
    uncertaintyFraction: 0,
    floor: 0.2,
  };
  const error = assertThrows(
    () => assertUncertaintyFloor(argmax),
    SurrogateUncertaintyError,
  );
  assertEquals(error.reason, "UNCERTAINTY_FLOOR_BREACHED");
  assert(error.message.includes("argmax"));
});

Deno.test("uncertainty floor — a generation with nothing left to explore is not a breach", () => {
  const starved: AllocationDiagnostics = {
    rule: "ei",
    candidates: 1,
    slots: 10,
    outOfDistribution: 0,
    outOfDistributionRate: 0,
    outOfDistributionSlots: 0,
    uncertaintySlots: 1,
    acquisitionSlots: 0,
    uncertaintyFraction: 0.1,
    floor: 0.2,
  };
  assertUncertaintyFloor(starved);
});
