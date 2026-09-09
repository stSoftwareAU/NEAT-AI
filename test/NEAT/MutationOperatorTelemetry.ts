/**
 * Tests for MutationOperatorTelemetry — per-operator mutation outcome
 * telemetry (Issue #3971).
 *
 * The aggregate `MCMCDiagnostics` counters cannot say which operator was
 * rejected; these tests pin the per-operator breakdown, the separation of
 * `noChange` from `rejected`, the score-delta distribution, and the exclusion
 * of offspring that never reached evaluation.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { DEFAULT_MCMC_CONFIG } from "@config/MCMCConfig.ts";
import { MCMCDiagnostics } from "@neat/MCMCDiagnostics.ts";
import { MULTI_OPERATOR_ATTRIBUTION_NOTE } from "@neat/MutationOperatorReport.ts";
import {
  MutationOperatorTelemetry,
  summariseScoreDeltas,
} from "@neat/MutationOperatorTelemetry.ts";

function makeCreature(score?: number): Creature {
  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  if (score !== undefined) creature.score = score;
  return creature;
}

// ── Proposed / noChange ──────────────────────────────────────────────

Deno.test("MutationOperatorTelemetry: noChange is counted separately from rejected", () => {
  const telemetry = new MutationOperatorTelemetry();
  const creature = makeCreature(1);

  // Three proposals: two produced nothing, one landed and was then evaluated
  // and dropped from the population.
  telemetry.recordProposed("ADD_NODE");
  telemetry.recordNoChange("ADD_NODE");
  telemetry.recordProposed("ADD_NODE");
  telemetry.recordNoChange("ADD_NODE");
  telemetry.recordProposed("ADD_NODE");
  telemetry.recordApplied(creature, "ADD_NODE", { baselineScore: 1 });
  creature.score = 0.5;
  telemetry.recordEvaluated(creature, 12);

  const report = telemetry.finaliseGeneration([]);
  const addNode = report.operators["ADD_NODE"];

  assertEquals(addNode.proposed, 3);
  assertEquals(addNode.noChange, 2);
  assertEquals(addNode.applied, 1);
  // The two no-change proposals cost nothing and must not inflate rejections.
  assertEquals(addNode.rejected, 1);
  assertEquals(addNode.evaluated, 1);
});

Deno.test("MutationOperatorTelemetry: an unknown operator has no counters until proposed", () => {
  const telemetry = new MutationOperatorTelemetry();
  const report = telemetry.getGenerationReport();
  assertEquals(Object.keys(report.operators).length, 0);
});

// ── Selection outcome ────────────────────────────────────────────────

Deno.test("MutationOperatorTelemetry: a surviving offspring is accepted for its operator", () => {
  const telemetry = new MutationOperatorTelemetry();
  const creature = makeCreature(2);

  telemetry.recordProposed("ADD_CONN");
  telemetry.recordApplied(creature, "ADD_CONN", { baselineScore: 2 });
  creature.score = 2.5;
  telemetry.recordEvaluated(creature, 40);

  const report = telemetry.finaliseGeneration([creature]);
  const addConn = report.operators["ADD_CONN"];

  assertEquals(addConn.evaluated, 1);
  assertEquals(addConn.accepted, 1);
  assertEquals(addConn.rejected, 0);
  assertEquals(addConn.evaluationMs, 40);
  assertEquals(addConn.soleAttributed, 1);
  assertEquals(addConn.coAttributed, 0);
  assertEquals(report.attribution.resolvedOffspring, 1);
  assertEquals(report.attribution.multiOperatorOffspring, 0);
  assertEquals(report.attribution.evaluationMs, 40);
});

Deno.test("MutationOperatorTelemetry: resolved offspring are not re-counted next generation", () => {
  const telemetry = new MutationOperatorTelemetry();
  const creature = makeCreature(2);

  telemetry.recordProposed("MOD_WEIGHT");
  telemetry.recordApplied(creature, "MOD_WEIGHT", { baselineScore: 2 });
  creature.score = 3;
  telemetry.recordEvaluated(creature, 5);

  assertEquals(
    telemetry.finaliseGeneration([creature]).operators["MOD_WEIGHT"].evaluated,
    1,
  );
  const second = telemetry.finaliseGeneration([creature]);
  assertEquals(Object.keys(second.operators).length, 0);
  assertEquals(second.attribution.resolvedOffspring, 0);
});

// ── Multi-operator attribution ───────────────────────────────────────

Deno.test("MutationOperatorTelemetry: an offspring is attributed to every operator applied", () => {
  const telemetry = new MutationOperatorTelemetry();
  const creature = makeCreature(1);

  telemetry.recordProposed("ADD_NODE");
  telemetry.recordApplied(creature, "ADD_NODE", { baselineScore: 1 });
  telemetry.recordProposed("MOD_BIAS");
  telemetry.recordApplied(creature, "MOD_BIAS", { baselineScore: 1 });
  creature.score = 1.25;
  telemetry.recordEvaluated(creature, 100);

  const report = telemetry.finaliseGeneration([creature]);

  for (const name of ["ADD_NODE", "MOD_BIAS"]) {
    const summary = report.operators[name];
    assertEquals(summary.evaluated, 1, `${name} evaluated`);
    assertEquals(summary.accepted, 1, `${name} accepted`);
    assertEquals(summary.coAttributed, 1, `${name} co-attributed`);
    assertEquals(summary.soleAttributed, 0, `${name} sole`);
    // The whole evaluation is charged to each operator; the report says so.
    assertEquals(summary.evaluationMs, 100, `${name} evaluationMs`);
  }
  assertEquals(report.attribution.multiOperatorOffspring, 1);
  // Counted once per offspring, so the ambiguity is measurable.
  assertEquals(report.attribution.evaluationMs, 100);
  assertEquals(report.attribution.note, MULTI_OPERATOR_ATTRIBUTION_NOTE);
});

// ── Score delta distribution ─────────────────────────────────────────

Deno.test("MutationOperatorTelemetry: score delta distribution reports min, median and max", () => {
  const telemetry = new MutationOperatorTelemetry();
  const deltas = [0.5, -0.25, 4, 0.1, 0.2];

  const creatures = deltas.map((delta) => {
    const creature = makeCreature(1);
    telemetry.recordProposed("ADD_NODE");
    telemetry.recordApplied(creature, "ADD_NODE", { baselineScore: 1 });
    creature.score = 1 + delta;
    telemetry.recordEvaluated(creature, 1);
    return creature;
  });
  const report = telemetry.finaliseGeneration(creatures);
  const distribution = report.operators["ADD_NODE"].scoreDelta;

  assert(distribution, "distribution recorded");
  assertEquals(distribution.count, 5);
  assertAlmostEquals(distribution.min, -0.25, 1e-9);
  assertAlmostEquals(distribution.median, 0.2, 1e-9);
  assertAlmostEquals(distribution.max, 4, 1e-9);
});

Deno.test("MutationOperatorTelemetry: the delta survives a rejected offspring being cleared", () => {
  const telemetry = new MutationOperatorTelemetry();
  const creature = makeCreature(1);

  telemetry.recordProposed("ADD_NODE");
  telemetry.recordApplied(creature, "ADD_NODE", { baselineScore: 1 });
  creature.score = 0.75;
  telemetry.recordEvaluated(creature, 3);
  // A creature dropped from the population is disposed before the generation
  // ends, and `clearState()` deletes its score.
  creature.clearState();

  const summary = telemetry.finaliseGeneration([]).operators["ADD_NODE"];
  assertEquals(summary.rejected, 1);
  assert(summary.scoreDelta, "the evaluated score was captured at evaluation");
  assertAlmostEquals(summary.scoreDelta.median, -0.25, 1e-9);
  assertEquals(summary.deltaUnavailable, 0);
});

Deno.test("MutationOperatorTelemetry: an offspring with no baseline reports no delta", () => {
  const telemetry = new MutationOperatorTelemetry();
  const creature = makeCreature(); // freshly bred — no score, no parent lookup

  telemetry.recordProposed("ADD_NODE");
  telemetry.recordApplied(creature, "ADD_NODE");
  creature.score = 7;
  telemetry.recordEvaluated(creature, 1);

  const summary =
    telemetry.finaliseGeneration([creature]).operators["ADD_NODE"];
  assertEquals(summary.scoreDelta, undefined);
  assertEquals(summary.deltaUnavailable, 1);
});

Deno.test("MutationOperatorTelemetry: parent baselines supply the delta for bred offspring", () => {
  const telemetry = new MutationOperatorTelemetry();
  const creature = makeCreature();
  const baselines = new WeakMap<Creature, number>();
  baselines.set(creature, 10);
  telemetry.setParentBaselines(baselines);

  telemetry.recordProposed("ADD_NODE");
  telemetry.recordApplied(creature, "ADD_NODE");
  creature.score = 11.5;
  telemetry.recordEvaluated(creature, 1);

  const summary =
    telemetry.finaliseGeneration([creature]).operators["ADD_NODE"];
  assert(summary.scoreDelta, "distribution recorded");
  assertAlmostEquals(summary.scoreDelta.median, 1.5, 1e-9);
  assertEquals(summary.deltaUnavailable, 0);
});

Deno.test("MutationOperatorTelemetry: the score tag is used when the score field is absent", () => {
  const telemetry = new MutationOperatorTelemetry();
  const creature = makeCreature();
  addTag(creature, "score", "3.5");

  telemetry.recordProposed("MOD_WEIGHT");
  telemetry.recordApplied(creature, "MOD_WEIGHT");
  creature.score = 4;
  telemetry.recordEvaluated(creature, 1);

  const summary =
    telemetry.finaliseGeneration([creature]).operators["MOD_WEIGHT"];
  assert(summary.scoreDelta, "distribution recorded");
  assertAlmostEquals(summary.scoreDelta.median, 0.5, 1e-9);
});

Deno.test("summariseScoreDeltas: median of an even sample averages the middle pair", () => {
  const distribution = summariseScoreDeltas([1, 2, 3, 4]);
  assert(distribution);
  assertEquals(distribution.count, 4);
  assertAlmostEquals(distribution.median, 2.5, 1e-9);
  assertEquals(distribution.min, 1);
  assertEquals(distribution.max, 4);
});

Deno.test("summariseScoreDeltas: an empty sample has no distribution", () => {
  assertEquals(summariseScoreDeltas([]), undefined);
});

// ── Depth bucket ─────────────────────────────────────────────────────

Deno.test("MutationOperatorTelemetry: applied mutations are bucketed by depth", () => {
  const telemetry = new MutationOperatorTelemetry();
  const first = makeCreature(1);
  const second = makeCreature(1);

  telemetry.recordProposed("ADD_NODE");
  telemetry.recordApplied(first, "ADD_NODE", {
    depthBucket: "input-adjacent",
    baselineScore: 1,
  });
  telemetry.recordProposed("ADD_NODE");
  telemetry.recordApplied(second, "ADD_NODE", {
    depthBucket: "output-adjacent",
    baselineScore: 1,
  });

  const buckets =
    telemetry.getGenerationReport().operators["ADD_NODE"].depthBuckets;
  assertEquals(buckets["input-adjacent"], 1);
  assertEquals(buckets["output-adjacent"], 1);
  assertEquals(buckets["mid"], 0);
  assertEquals(buckets["unknown"], 0);
});

Deno.test("MutationOperatorTelemetry: an operator with no site is bucketed unknown", () => {
  const telemetry = new MutationOperatorTelemetry();
  const creature = makeCreature(1);
  telemetry.recordProposed("MOD_WEIGHT");
  telemetry.recordApplied(creature, "MOD_WEIGHT");

  const buckets =
    telemetry.getGenerationReport().operators["MOD_WEIGHT"].depthBuckets;
  assertEquals(buckets["unknown"], 1);
});

// ── Reverted and discarded offspring ─────────────────────────────────

Deno.test("MutationOperatorTelemetry: a reverted mutation is not evaluated or rejected by selection", () => {
  const telemetry = new MutationOperatorTelemetry();
  const creature = makeCreature(1);

  telemetry.recordProposed("ADD_NODE");
  telemetry.recordApplied(creature, "ADD_NODE", { baselineScore: 1 });
  telemetry.recordReverted(creature);
  assertEquals(telemetry.hasPending(creature), false);

  const summary =
    telemetry.finaliseGeneration([creature]).operators["ADD_NODE"];
  assertEquals(summary.reverted, 1);
  assertEquals(summary.evaluated, 0);
  assertEquals(summary.accepted, 0);
  assertEquals(summary.rejected, 0);
  assertEquals(summary.evaluationMs, 0);
});

Deno.test("MutationOperatorTelemetry: an offspring that never reached fitness is excluded from evaluated and wallClock", () => {
  const telemetry = new MutationOperatorTelemetry();
  const replaced = makeCreature(1);

  telemetry.recordProposed("ADD_NODE");
  telemetry.recordApplied(replaced, "ADD_NODE", { baselineScore: 1 });
  // The de-duplicator swapped this creature out — it never reached
  // Fitness.calculate(), so recordEvaluated is never called for it.

  const first = telemetry.finaliseGeneration([]);
  assertEquals(first.operators["ADD_NODE"].applied, 1);
  assertEquals(first.operators["ADD_NODE"].evaluated, 0);
  assertEquals(first.attribution.discardedOffspring, 0, "still pending");

  const second = telemetry.finaliseGeneration([]);
  assertEquals(second.attribution.discardedOffspring, 1);
  assertEquals(second.attribution.evaluationMs, 0);
  // Never evaluated, so no operator gained an evaluation or any wall-clock.
  assertEquals(second.operators["ADD_NODE"], undefined);
  assertEquals(telemetry.hasPending(replaced), false);
});

Deno.test("MutationOperatorTelemetry: recordEvaluated for an untracked creature is a no-op", () => {
  const telemetry = new MutationOperatorTelemetry();
  const stranger = makeCreature(1);
  telemetry.recordEvaluated(stranger, 99);

  const report = telemetry.finaliseGeneration([stranger]);
  assertEquals(report.attribution.resolvedOffspring, 0);
  assertEquals(report.attribution.evaluationMs, 0);
});

// ── MCMC reconciliation ──────────────────────────────────────────────

Deno.test("MutationOperatorTelemetry: aggregate M-H totals reconcile with MCMCDiagnostics", () => {
  const telemetry = new MutationOperatorTelemetry();
  const diagnostics = new MCMCDiagnostics({
    ...DEFAULT_MCMC_CONFIG,
    enabled: true,
  });

  const decisions = [true, false, false, true, false];
  const creatures: Creature[] = [];
  for (const accepted of decisions) {
    const creature = makeCreature(1);
    creatures.push(creature);
    telemetry.recordProposed("MOD_WEIGHT");
    telemetry.recordApplied(creature, "MOD_WEIGHT", { baselineScore: 1 });
    telemetry.recordProposed("MOD_BIAS");
    telemetry.recordApplied(creature, "MOD_BIAS", { baselineScore: 1 });

    diagnostics.recordDecision(accepted);
    telemetry.recordMcmcDecision(creature, accepted);
    if (!accepted) telemetry.recordReverted(creature);
  }

  const aggregate = diagnostics.getGenerationStats();
  const report = telemetry.finaliseGeneration(creatures);

  assertEquals(report.mcmc.proposed, aggregate.proposedCount);
  assertEquals(report.mcmc.accepted, aggregate.acceptedCount);
  assertEquals(report.mcmc.rejected, aggregate.rejectedCount);

  // Per-operator M-H counts credit every operator in the rejected batch, so
  // they sum to a multiple of the aggregate — never a smaller number.
  const perOperatorRejected = report.operators["MOD_WEIGHT"].mcmcRejected +
    report.operators["MOD_BIAS"].mcmcRejected;
  assertEquals(perOperatorRejected, aggregate.rejectedCount * 2);
  assertEquals(report.operators["MOD_WEIGHT"].reverted, 3);
});

// ── Reset ────────────────────────────────────────────────────────────

Deno.test("MutationOperatorTelemetry: reset clears counters and pending attributions", () => {
  const telemetry = new MutationOperatorTelemetry();
  const creature = makeCreature(1);
  telemetry.recordProposed("ADD_NODE");
  telemetry.recordApplied(creature, "ADD_NODE", { baselineScore: 1 });

  telemetry.reset();

  assertEquals(telemetry.hasPending(creature), false);
  const report = telemetry.getGenerationReport();
  assertEquals(Object.keys(report.operators).length, 0);
  assertEquals(report.mcmc.proposed, 0);
});
