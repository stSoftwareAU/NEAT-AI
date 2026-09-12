/**
 * The guard the surrogate path must not run without (Issue #3933).
 *
 * The per-run diagnostics are the acceptance criterion here: signed bias, the
 * fraction of exact evaluations spent on uncertainty, and the
 * out-of-distribution rate. A run that cannot report those three cannot tell
 * you whether its surrogate was helping or converging it onto a false optimum.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { SurrogateGuard } from "@surrogate/SurrogateGuard.ts";
import type { SurrogateVerdict } from "@surrogate/UncertainSurrogate.ts";
import { resolveSurrogateUncertaintyConfig } from "@config/SurrogateUncertaintyConfig.ts";
import { SurrogateUncertaintyError } from "@errors/SurrogateUncertaintyError.ts";

/** A prediction verdict. */
function p(value: number, uncertainty: number): SurrogateVerdict {
  return { kind: "prediction", value, uncertainty };
}

/** A refusal verdict. */
function ood(): SurrogateVerdict {
  return {
    kind: "out-of-distribution",
    reason: "nothing archived within reach",
    distance: 9,
    limit: 1,
  };
}

/** Ten candidates, two of which the model refuses to predict. */
function generation(): SurrogateVerdict[] {
  return [
    ood(),
    p(0.50, 0.001),
    p(0.49, 0.001),
    p(0.48, 0.002),
    p(0.10, 0.30),
    p(0.47, 0.001),
    ood(),
    p(0.46, 0.001),
    p(0.09, 0.20),
    p(0.45, 0.001),
  ];
}

Deno.test("surrogate guard — a run reports bias, uncertainty share and OOD rate", () => {
  const guard = new SurrogateGuard(
    resolveSurrogateUncertaintyConfig({ minUncertaintyFraction: 0.25 }),
  );
  for (let gen = 1; gen <= 4; gen++) {
    guard.allocate(generation(), 4, 0.5);
    for (let i = 0; i < 10; i++) guard.observe(0.5 + 1e-3, 0.5);
    guard.closeGeneration(gen);
  }
  const d = guard.runDiagnostics;
  assertEquals(d.generations, 4);
  assertEquals(d.candidates, 40);
  assertEquals(d.outOfDistribution, 8);
  assertAlmostEquals(d.outOfDistributionRate, 0.2, 1e-12);
  assertEquals(d.exactSlots, 16);
  // Two refusals per generation already exceed the 25% floor, so the floor
  // band adds nothing and the fraction is the refusals' own share.
  assertAlmostEquals(d.uncertaintyFraction, 0.5, 1e-12);
  assertAlmostEquals(d.signedBias, 1e-3, 1e-9);
  assertEquals(d.residuals, 40);
  guard.assertUncertaintyAllocation();
});

Deno.test("surrogate guard — the floor is honoured when nothing is out of distribution", () => {
  const guard = new SurrogateGuard(
    resolveSurrogateUncertaintyConfig({ minUncertaintyFraction: 0.5 }),
  );
  const verdicts = [
    p(0.9, 0.0001),
    p(0.8, 0.0001),
    p(0.1, 0.5),
    p(0.1, 0.4),
  ];
  const { slots } = guard.allocate(verdicts, 4, 0.5);
  assertEquals(
    slots.filter((slot) => slot.reason === "uncertainty").length,
    2,
  );
  assertAlmostEquals(guard.runDiagnostics.uncertaintyFraction, 0.5, 1e-12);
  guard.assertUncertaintyAllocation();
});

Deno.test("surrogate guard — a one-directional bias disables the surrogate path", () => {
  const guard = new SurrogateGuard(
    resolveSurrogateUncertaintyConfig({
      driftGenerations: 2,
      driftMinSamples: 4,
    }),
  );
  assertEquals(guard.active, true);
  for (let gen = 1; gen <= 2; gen++) {
    guard.allocate(generation(), 4, 0.5);
    for (let i = 0; i < 8; i++) guard.observe(0.52, 0.5);
    guard.closeGeneration(gen);
  }
  assertEquals(guard.disabled, true);
  assertEquals(guard.active, false);
  assertEquals(guard.runDiagnostics.disabledAtGeneration, 2);
  assert(guard.describeRun().includes("DISABLED"));
});

Deno.test("surrogate guard — off by configuration is never active", () => {
  const guard = new SurrogateGuard(
    resolveSurrogateUncertaintyConfig({ enabled: false }),
  );
  assertEquals(guard.active, false);
  assertEquals(guard.disabled, false);
});

Deno.test("surrogate guard — the run line carries the three numbers", () => {
  const guard = new SurrogateGuard(resolveSurrogateUncertaintyConfig());
  guard.allocate(generation(), 4, 0.5);
  for (let i = 0; i < 10; i++) guard.observe(0.5, 0.5 + 1e-4);
  guard.closeGeneration(1);
  const line = guard.describeRun();
  assert(line.includes("signed bias"), line);
  assert(line.includes("uncertainty allocation"), line);
  assert(line.includes("OOD rate"), line);
  const allocationLine = guard.describeAllocation();
  assert(allocationLine?.includes("out-of-distribution"), allocationLine);
});

Deno.test("surrogate guard — an argmax run is refused by the run-level assertion", () => {
  // A floor of 0 is the degenerate configuration the issue warns about; the
  // guard reports a zero fraction for it and the assertion passes, because
  // nothing was promised. With a floor promised and no exploration slots, the
  // same reading is a breach.
  const argmax = new SurrogateGuard(
    resolveSurrogateUncertaintyConfig({
      minUncertaintyFraction: 0,
      acquisition: "lcb",
      kappa: 0,
    }),
  );
  argmax.allocate([p(0.9, 0.001), p(0.1, 0.9), p(0.8, 0.001)], 2, 0.5);
  assertEquals(argmax.runDiagnostics.uncertaintyFraction, 0);
  argmax.assertUncertaintyAllocation();

  const promised = new SurrogateGuard(
    resolveSurrogateUncertaintyConfig({ minUncertaintyFraction: 0.5 }),
  );
  const error = assertThrows(
    () =>
      // Reaching into the guard is the point: this is the reading a future
      // policy that dropped the exploration band would accumulate.
      promised.assertUncertaintyAllocationFor({
        candidates: 30,
        exactSlots: 10,
        explorationSlots: 0,
      }),
    SurrogateUncertaintyError,
  );
  assertEquals(error.reason, "UNCERTAINTY_FLOOR_BREACHED");
});

Deno.test("surrogate guard — reset clears the run for a fresh one", () => {
  const guard = new SurrogateGuard(resolveSurrogateUncertaintyConfig());
  guard.allocate(generation(), 4, 0.5);
  guard.observe(0.5, 0.4);
  guard.closeGeneration(1);
  guard.reset();
  const d = guard.runDiagnostics;
  assertEquals(d.generations, 0);
  assertEquals(d.exactSlots, 0);
  assertEquals(d.residuals, 0);
  assertEquals(guard.lastGeneration, undefined);
});
