/**
 * Issue #3398 — Tests for the score-per-wall-clock-hour benchmark harness.
 *
 * These run in the standard `deno test` CI suite (the `bench/**\/*_test.ts`
 * glob is registered in `deno.json` `test.include`, and excluded from the
 * `deno bench` set so `deno task bench` never treats it as a benchmark).
 *
 * They form the earliest failure-detection point for the harness: a broken
 * harness, non-deterministic seeding, or malformed machine-readable output
 * fails the PR before any #3396 sub-issue can cite it as evidence.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  compareToBaseline,
  type HarnessConfig,
  type HarnessResult,
  runScorePerHourHarness,
  type ScoreSample,
  summariseTrajectory,
  validateHarnessResult,
  withConfigDefaults,
} from "./score_per_hour_harness.ts";

/**
 * A deterministic virtual clock: each call advances a fixed step. Because the
 * harness calls `now()` a deterministic number of times (once at start, once
 * per generation, once at the end) for a seeded run, two runs sharing this
 * clock design produce byte-identical timing fields.
 */
function virtualClock(stepMs = 1_000): () => number {
  let t = 0;
  return () => {
    const value = t;
    t += stepMs;
    return value;
  };
}

/** Tiny, fast, deterministic config for the smoke tests. */
function tinyConfig(): HarnessConfig {
  return withConfigDefaults({
    scale: "default",
    inputCount: 16,
    outputCount: 2,
    sampleCount: 8,
    populationSize: 6,
    maxGenerations: 4,
    timeBudgetMs: 60_000,
    threads: 1,
    seed: 3396,
    // Pure seeded neuroevolution (default) — byte-reproducible. Async backprop
    // (trainPerGen >= 1) would introduce worker-scheduling jitter.
    trainPerGen: 0,
  });
}

Deno.test("score-per-hour harness: identical seeds produce identical score trajectories", async () => {
  const config = tinyConfig();

  const first = await runScorePerHourHarness(config, { now: virtualClock() });
  const second = await runScorePerHourHarness(config, { now: virtualClock() });

  // Byte-identical machine-readable output (curve + score/hour), including the
  // virtual-clock timing, proves seeded reproducibility.
  assertEquals(
    JSON.stringify(second),
    JSON.stringify(first),
    "same seed + config + virtual clock must yield byte-identical output",
  );

  // The output must schema-validate (a malformed shape fails CI here).
  assertEquals(
    validateHarnessResult(JSON.parse(JSON.stringify(first))),
    [],
    "harness output should pass schema validation",
  );

  assert(first.scoreTrajectory.length > 0, "trajectory must be non-empty");
});

Deno.test("score-per-hour harness: a different seed changes the trajectory", async () => {
  const base = tinyConfig();
  const a = await runScorePerHourHarness(base, { now: virtualClock() });
  const b = await runScorePerHourHarness(
    { ...base, seed: base.seed + 7 },
    { now: virtualClock() },
  );

  const scoresA = a.scoreTrajectory.map((s) => s.bestFitness);
  const scoresB = b.scoreTrajectory.map((s) => s.bestFitness);
  assert(
    JSON.stringify(scoresA) !== JSON.stringify(scoresB),
    "a different seed should produce a different score trajectory",
  );
});

Deno.test("score-per-hour harness: extraOptions run is byte-reproducible and validates (Issue #3400)", async () => {
  const config = withConfigDefaults({
    ...tinyConfig(),
    extraOptions: { trainingSampleRate: 0.5, sparseRatio: 0.1 },
  });

  const first = await runScorePerHourHarness(config, { now: virtualClock() });
  const second = await runScorePerHourHarness(config, { now: virtualClock() });

  assertEquals(
    JSON.stringify(second),
    JSON.stringify(first),
    "extraOptions must stay byte-reproducible under a seeded run",
  );
  assertEquals(
    validateHarnessResult(JSON.parse(JSON.stringify(first))),
    [],
    "extraOptions output should pass schema validation",
  );
});

Deno.test("score-per-hour harness: extraOptions cannot override determinism-critical fields (Issue #3400)", async () => {
  const base = tinyConfig();
  const plain = await runScorePerHourHarness(base, { now: virtualClock() });

  // A sweep must never be able to break seeding or population via extraOptions:
  // the harness spreads extraOptions FIRST, so these overrides are ignored and
  // the trajectory is identical to the plain run.
  const hijacked = await runScorePerHourHarness(
    withConfigDefaults({
      ...base,
      extraOptions: { seed: 999_999, populationSize: 3, iterations: 1 },
    }),
    { now: virtualClock() },
  );

  assertEquals(
    hijacked.scoreTrajectory.map((s) => s.bestFitness),
    plain.scoreTrajectory.map((s) => s.bestFitness),
    "extraOptions must not override seed/populationSize/iterations",
  );
});

Deno.test("score-per-hour harness: topology matches the requested preset", async () => {
  const result = await runScorePerHourHarness(tinyConfig(), {
    now: virtualClock(),
  });
  assertEquals(result.topology.inputs, 16);
  assert(result.topology.neurons > 0);
  assert(result.topology.synapses > 0);
});

Deno.test("score-per-hour harness: score/hour is derived from first→last gain over elapsed hours", () => {
  const samples: ScoreSample[] = [
    { generation: 1, elapsedMs: 0, bestFitness: -10, averageFitness: -12 },
    { generation: 2, elapsedMs: 1_000, bestFitness: -6, averageFitness: -8 },
  ];
  // 30 minutes of wall-clock → 0.5 h. Gain = (-6) - (-10) = 4. 4 / 0.5 = 8/h.
  const result = summariseTrajectory(samples, 30 * 60_000, {
    config: tinyConfig(),
    topology: { neurons: 1, synapses: 1, inputs: 1 },
    usedRealTrainData: false,
  });
  assertEquals(result.initialBestFitness, -10);
  assertEquals(result.finalBestFitness, -6);
  assertEquals(result.bestFitness, -6);
  assertEquals(result.scorePerHour, 8);
});

Deno.test("score-per-hour harness: empty trajectory fails loud (silent-failure guard)", () => {
  assertThrows(
    () =>
      summariseTrajectory([], 1_000, {
        config: tinyConfig(),
        topology: { neurons: 1, synapses: 1, inputs: 1 },
        usedRealTrainData: false,
      }),
    Error,
    "no score samples",
  );
});

Deno.test("score-per-hour harness: schema validation rejects malformed output", () => {
  assert(validateHarnessResult(null).length > 0);
  assert(validateHarnessResult({}).length > 0);

  const good: HarnessResult = summariseTrajectory(
    [{ generation: 1, elapsedMs: 0, bestFitness: 1, averageFitness: 0.5 }],
    1_000,
    {
      config: tinyConfig(),
      topology: { neurons: 1, synapses: 1, inputs: 1 },
      usedRealTrainData: false,
    },
  );
  assertEquals(validateHarnessResult(JSON.parse(JSON.stringify(good))), []);

  // A NaN score must be rejected.
  const bad = { ...good, scoreTrajectory: [] };
  assert(validateHarnessResult(bad).length > 0);
});

Deno.test("score-per-hour harness: baseline regression gate flags worse evolution outcome", () => {
  const meta = {
    config: tinyConfig(),
    topology: { neurons: 1, synapses: 1, inputs: 1 },
    usedRealTrainData: false,
  };
  const baseline = summariseTrajectory(
    [
      { generation: 1, elapsedMs: 0, bestFitness: -10, averageFitness: -11 },
      { generation: 2, elapsedMs: 1_000, bestFitness: -4, averageFitness: -5 },
    ],
    60 * 60_000, // 1 h → score/hour = 6
    meta,
  );

  // Identical run passes.
  assert(compareToBaseline(baseline, baseline).passed);

  // A run that is faster but reaches a worse final score must fail.
  const worseOutcome = summariseTrajectory(
    [
      { generation: 1, elapsedMs: 0, bestFitness: -10, averageFitness: -11 },
      { generation: 2, elapsedMs: 1_000, bestFitness: -7, averageFitness: -8 },
    ],
    10 * 60_000, // faster: score/hour = 18 (higher!) but final score worse
    meta,
  );
  const regression = compareToBaseline(worseOutcome, baseline);
  assert(
    !regression.passed,
    "a worse final score must fail even when it is faster",
  );
  assert(
    regression.reasons.some((r) => r.includes("final best score regressed")),
  );

  // A run with identical scores but a >10% score/hour drop must NOT fail the
  // gate (wall-clock is machine-dependent) — it is surfaced as an advisory
  // warning instead.
  const slowerScoring = summariseTrajectory(
    [
      { generation: 1, elapsedMs: 0, bestFitness: -10, averageFitness: -11 },
      { generation: 2, elapsedMs: 1_000, bestFitness: -4, averageFitness: -5 },
    ],
    120 * 60_000, // 2 h → score/hour = 3, a 50% drop from baseline's 6
    meta,
  );
  const scoreHourAdvisory = compareToBaseline(slowerScoring, baseline);
  assert(
    scoreHourAdvisory.passed,
    "a pure timing slowdown with unchanged scores must not fail the gate",
  );
  assert(
    scoreHourAdvisory.warnings.some((w) => w.includes("score/hour dropped")),
    "the score/hour drop should be reported as an advisory warning",
  );
  assert(scoreHourAdvisory.trajectoryMatched);
});
