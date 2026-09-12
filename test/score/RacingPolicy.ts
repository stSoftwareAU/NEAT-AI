import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  hoeffdingBound,
  type PartialScore,
  RacingPolicy,
} from "../../src/score/RacingPolicy.ts";
import {
  DEFAULT_RACING_CONFIG,
  type RequiredRacingConfig,
  resolveRacingConfig,
} from "@config/RacingConfig.ts";
import { ConfigurationError } from "@errors/ConfigurationError.ts";

/**
 * Racing decision rule (Issue #3928).
 *
 * The policy consumes the scorer's running partial scores and answers with the
 * creatures that can no longer catch the leader. These tests drive the real
 * rule and assert on the verdicts and the diagnostics it accumulates.
 */

function config(
  overrides?: Partial<RequiredRacingConfig>,
): RequiredRacingConfig {
  return { ...DEFAULT_RACING_CONFIG, enabled: true, ...overrides };
}

function partial(
  index: number,
  key: string,
  partialError: number,
  recordsScored: number,
): PartialScore {
  return { index, key, partialError, recordsScored };
}

Deno.test("RacingPolicy - abandons a hopeless creature once past the floor", () => {
  const policy = new RacingPolicy(config(), { corpusRecords: 1000 });
  const verdict = policy.onChunk([
    partial(0, "leader", 0.10, 400),
    partial(1, "laggard", 0.95, 400),
    partial(2, "runner-up", 0.11, 400),
  ]);
  assertEquals(verdict.verdict, "abort");
  assertEquals(
    verdict.verdict === "abort" ? verdict.creatures : [],
    [1],
    "only the creature outside the bound is abandoned",
  );
  assertEquals(policy.abandoned.length, 1);
  assertEquals(policy.abandoned[0].key, "laggard");
  assertEquals(policy.abandoned[0].corpusFraction, 0.4);
});

Deno.test("RacingPolicy - keeps a creature still inside the confidence bound", () => {
  const policy = new RacingPolicy(config(), { corpusRecords: 1000 });
  // A gap far narrower than the Hoeffding radius at 400 records.
  const verdict = policy.onChunk([
    partial(0, "leader", 0.500, 400),
    partial(1, "close", 0.502, 400),
  ]);
  assertEquals(verdict.verdict, "continue");
  assertEquals(policy.abandoned.length, 0);
});

Deno.test("RacingPolicy - refuses to abandon before the minimum corpus fraction", () => {
  const policy = new RacingPolicy(config({ minCorpusFraction: 0.2 }), {
    corpusRecords: 1000,
  });
  // Hopeless, but only 10% of the corpus has been read — record order is not
  // a random sample, so the bound alone must not be allowed to fire.
  const early = policy.onChunk([
    partial(0, "leader", 0.01, 100),
    partial(1, "laggard", 0.99, 100),
    partial(2, "runner-up", 0.02, 100),
  ]);
  assertEquals(early.verdict, "continue");
  assertEquals(policy.abandoned.length, 0);

  const later = policy.onChunk([
    partial(0, "leader", 0.01, 200),
    partial(1, "laggard", 0.99, 200),
    partial(2, "runner-up", 0.02, 200),
  ]);
  assertEquals(later.verdict, "abort");
  assertEquals(policy.abandoned.length, 1);
});

Deno.test("RacingPolicy - never abandons an exempt (elite) creature", () => {
  const policy = new RacingPolicy(config(), {
    corpusRecords: 1000,
    exemptKeys: ["elite"],
  });
  const verdict = policy.onChunk([
    partial(0, "leader", 0.01, 900),
    partial(1, "elite", 0.99, 900),
    partial(2, "other", 0.99, 900),
  ]);
  assertEquals(verdict.verdict, "abort");
  assertEquals(
    verdict.verdict === "abort" ? verdict.creatures : [],
    [2],
    "the exempt creature keeps racing to a full-corpus score",
  );
  assertEquals(policy.abandonedKeys().has("elite"), false);
});

Deno.test("RacingPolicy - never abandons the leader", () => {
  const policy = new RacingPolicy(config(), { corpusRecords: 100 });
  const verdict = policy.onChunk([
    partial(0, "leader", 0.2, 100),
    partial(1, "second", 0.9, 100),
    partial(2, "third", 0.21, 100),
  ]);
  assertEquals(verdict.verdict, "abort");
  assertEquals(verdict.verdict === "abort" ? verdict.creatures : [], [1]);
  assertEquals(policy.abandonedKeys().has("leader"), false);
});

Deno.test("RacingPolicy - never abandons the last creature standing", () => {
  const policy = new RacingPolicy(config(), { corpusRecords: 100 });
  const verdict = policy.onChunk([partial(3, "sole", 5, 100)]);
  assertEquals(verdict.verdict, "continue");
  assertEquals(policy.abandoned.length, 0);
});

Deno.test("RacingPolicy - abandons nobody when the corpus size is unknown", () => {
  const policy = new RacingPolicy(config());
  assertEquals(policy.corpusRecords, 0);
  const verdict = policy.onChunk([
    partial(0, "leader", 0.01, 5000),
    partial(1, "laggard", 9.99, 5000),
    partial(2, "runner-up", 0.02, 5000),
  ]);
  assertEquals(
    verdict.verdict,
    "continue",
    "without a corpus size the floor cannot be enforced, so nothing is dropped",
  );
});

Deno.test("RacingPolicy - disabled policy always continues", () => {
  const policy = new RacingPolicy(config({ enabled: false }), {
    corpusRecords: 100,
  });
  const verdict = policy.onChunk([
    partial(0, "leader", 0.01, 100),
    partial(1, "laggard", 99, 100),
    partial(2, "runner-up", 0.02, 100),
  ]);
  assertEquals(verdict.verdict, "continue");
  assertEquals(policy.abandoned.length, 0);
});

Deno.test("RacingPolicy - a non-finite running error is abandoned past the floor", () => {
  const policy = new RacingPolicy(config(), { corpusRecords: 100 });
  const verdict = policy.onChunk([
    partial(0, "leader", 0.5, 100),
    partial(1, "broken", Infinity, 100),
    partial(2, "runner-up", 0.51, 100),
  ]);
  assertEquals(verdict.verdict, "abort");
  assertEquals(verdict.verdict === "abort" ? verdict.creatures : [], [1]);
});

Deno.test("RacingPolicy - a wider bound abandons fewer creatures", () => {
  const gap = [
    partial(0, "leader", 0.30, 500),
    partial(1, "behind", 0.45, 500),
    partial(2, "runner-up", 0.31, 500),
  ];
  const tight = new RacingPolicy(config({ errorRange: 0.1 }), {
    corpusRecords: 1000,
  });
  const loose = new RacingPolicy(config({ errorRange: 10 }), {
    corpusRecords: 1000,
  });
  assertEquals(tight.onChunk(gap).verdict, "abort");
  assertEquals(
    loose.onChunk(gap).verdict,
    "continue",
    "a wider assumed cost range must be more conservative, not less",
  );
});

Deno.test("RacingPolicy - summarise reports abandonment fraction and work saved", () => {
  const policy = new RacingPolicy(config(), { corpusRecords: 1000 });
  policy.onChunk([
    partial(0, "leader", 0.01, 500),
    partial(1, "a", 0.99, 500),
    partial(2, "b", 0.99, 500),
    partial(3, "c", 0.02, 500),
  ]);
  const summary = policy.summarise(4);
  assertEquals(summary.abandoned, 2);
  assertEquals(summary.raced, 4);
  assertEquals(summary.meanAbandonFraction, 0.5);
  // Two creatures skipped 500 of 1000 records each, out of 4×1000 records.
  assertEquals(summary.recordsSavedFraction, 1000 / 4000);
});

Deno.test("RacingPolicy - summarise is all zeros when nothing was abandoned", () => {
  const policy = new RacingPolicy(config(), { corpusRecords: 1000 });
  policy.onChunk([
    partial(0, "leader", 0.10, 500),
    partial(1, "close", 0.101, 500),
  ]);
  const summary = policy.summarise(2);
  assertEquals(summary.abandoned, 0);
  assertEquals(summary.meanAbandonFraction, 0);
  assertEquals(summary.recordsSavedFraction, 0);
});

Deno.test("RacingPolicy - hoeffding bound narrows as records accumulate", () => {
  const few = hoeffdingBound(1, 100, 0.01);
  const many = hoeffdingBound(1, 10_000, 0.01);
  assert(few > many, "more evidence must give a tighter bound");
  assertEquals(hoeffdingBound(1, 0, 0.01), Infinity);
  // Quadrupling the sample count halves the radius, and the radius scales
  // linearly with the assumed cost range — the two properties every consumer
  // of the bound relies on, whichever way the expression is written.
  assertAlmostEquals(hoeffdingBound(1, 400, 0.01), few / 2, 1e-12);
  assertAlmostEquals(hoeffdingBound(3, 100, 0.01), few * 3, 1e-12);
  // A tighter confidence must widen, never narrow, the bound.
  assert(hoeffdingBound(1, 100, 0.001) > few);
});

Deno.test("RacingConfig - defaults are off and conservative", () => {
  const resolved = resolveRacingConfig();
  assertEquals(resolved.enabled, false);
  assertEquals(resolved.minCorpusFraction, 0.2);
  assertEquals(resolved.confidence, 0.01);
  assertEquals(resolved.errorRange, 1);
});

Deno.test("RacingConfig - rejects out-of-range knobs rather than clamping", () => {
  assertThrows(
    () => resolveRacingConfig({ minCorpusFraction: 0 }),
    ConfigurationError,
    "minCorpusFraction",
  );
  assertThrows(
    () => resolveRacingConfig({ minCorpusFraction: 1.5 }),
    ConfigurationError,
  );
  assertThrows(
    () => resolveRacingConfig({ confidence: 0 }),
    ConfigurationError,
  );
  assertThrows(
    () => resolveRacingConfig({ confidence: 1 }),
    ConfigurationError,
  );
  assertThrows(
    () => resolveRacingConfig({ errorRange: 0 }),
    ConfigurationError,
  );
});

Deno.test("RacingPolicy - always leaves enough survivors for the elite slots", () => {
  const partials = [
    partial(0, "leader", 0.01, 900),
    partial(1, "second", 0.90, 900),
    partial(2, "third", 0.91, 900),
    partial(3, "fourth", 0.92, 900),
  ];
  // Elitism 3 means three creatures must finish with an exact score, so only
  // the single worst candidate may be abandoned even though three are hopeless.
  const strict = new RacingPolicy(config(), {
    corpusRecords: 1000,
    minSurvivors: 3,
  });
  const verdict = strict.onChunk(partials);
  assertEquals(verdict.verdict, "abort");
  assertEquals(
    verdict.verdict === "abort" ? verdict.creatures : [],
    [3],
    "the worst candidate goes first when the survivor floor bites",
  );

  // With the default floor of two, three of the four may go.
  const relaxed = new RacingPolicy(config(), { corpusRecords: 1000 });
  const relaxedVerdict = relaxed.onChunk(partials);
  assertEquals(
    relaxedVerdict.verdict === "abort" ? relaxedVerdict.creatures : [],
    [2, 3],
  );
});
