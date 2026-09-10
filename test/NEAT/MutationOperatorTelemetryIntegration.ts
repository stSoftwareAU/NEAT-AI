/**
 * Integration tests for per-operator mutation telemetry (Issue #3971).
 *
 * These drive the real `Mutator`, `DeDuplicator` and evolution loop rather
 * than the tracker in isolation, so the wiring — proposals, no-change vs
 * rejection, depth buckets, the MCMC reconciliation, and the exclusion of
 * de-duplicated offspring — is exercised end to end.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DeDuplicator } from "@architecture/DeDuplicator.ts";
import { Breed } from "@breed/Breed.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { TrainingEvent } from "@config/TrainingEvent.ts";
import { Genus } from "@neat/Genus.ts";
import { MCMCDiagnostics } from "@neat/MCMCDiagnostics.ts";
import { Mutation } from "@neat/Mutation.ts";
import { MutationOperatorTelemetry } from "@neat/MutationOperatorTelemetry.ts";
import { Mutator } from "@neat/Mutator.ts";
import { Neat } from "@neat/Neat.ts";

function totalDepthBuckets(
  buckets: Readonly<Record<string, number>>,
): number {
  return Object.values(buckets).reduce((sum, count) => sum + count, 0);
}

// ── Mutator hooks ────────────────────────────────────────────────────

Deno.test("MutationOperatorTelemetry: the Mutator records a proposal and a depth bucket for ADD_NODE", () => {
  const telemetry = new MutationOperatorTelemetry();
  const config = createNeatConfig({ populationSize: 10 });
  const mutator = new Mutator(
    config,
    undefined,
    undefined,
    undefined,
    telemetry,
  );

  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  CreatureUtil.makeUUID(creature);

  const changed = mutator.mutateCreature(creature, Mutation.ADD_NODE);
  assert(changed, "ADD_NODE changed the creature");

  const summary = telemetry.getGenerationReport().operators["ADD_NODE"];
  assertEquals(summary.proposed, 1);
  assertEquals(summary.applied, 1);
  assertEquals(summary.noChange, 0);
  assertEquals(totalDepthBuckets(summary.depthBuckets), 1);
  // A structural mutation names its site, so it must not fall into `unknown`.
  assertEquals(summary.depthBuckets["unknown"], 0);
});

Deno.test("MutationOperatorTelemetry: a weight mutation is bucketed unknown, not layer-walked", () => {
  const telemetry = new MutationOperatorTelemetry();
  const config = createNeatConfig({ populationSize: 10 });
  const mutator = new Mutator(
    config,
    undefined,
    undefined,
    undefined,
    telemetry,
  );

  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  CreatureUtil.makeUUID(creature);
  mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);

  const summary = telemetry.getGenerationReport().operators["MOD_WEIGHT"];
  assertEquals(summary.proposed, 1);
  assertEquals(
    summary.depthBuckets["unknown"],
    summary.applied,
    "weight mutations are not layer-walked on the hot path",
  );
});

Deno.test("MutationOperatorTelemetry: an operator that cannot change anything counts as noChange", () => {
  const telemetry = new MutationOperatorTelemetry();
  const config = createNeatConfig({ populationSize: 10 });
  const mutator = new Mutator(
    config,
    undefined,
    undefined,
    undefined,
    telemetry,
  );

  // No hidden neurons, so SUB_NODE has nothing to remove and returns false.
  const creature = new Creature(2, 1);
  CreatureUtil.makeUUID(creature);

  const changed = mutator.mutateCreature(creature, Mutation.SUB_NODE);
  assertEquals(changed, false);

  const summary = telemetry.getGenerationReport().operators["SUB_NODE"];
  assertEquals(summary.proposed, 1);
  assertEquals(summary.noChange, 1);
  assertEquals(summary.applied, 0);
  // A no-change costs nothing and must never be booked as a rejection.
  assertEquals(summary.rejected, 0);
  assertEquals(summary.reverted, 0);
});

// ── MCMC reconciliation through the real Mutator ─────────────────────

Deno.test("MutationOperatorTelemetry: per-generation M-H totals reconcile with MCMCDiagnostics", () => {
  const telemetry = new MutationOperatorTelemetry();
  const config = createNeatConfig({
    populationSize: 20,
    mutationRate: 1,
    mutationAmount: 1,
    // Weight/bias only: topology mutations bypass the M-H gate entirely.
    mutation: [Mutation.MOD_WEIGHT, Mutation.MOD_BIAS],
    mcmc: { enabled: true, initialTemperature: 0.5 },
  });
  const diagnostics = new MCMCDiagnostics(config.mcmc);
  const mutator = new Mutator(config, 0.5, diagnostics, undefined, telemetry);

  const population: Creature[] = [];
  for (let i = 0; i < 20; i++) {
    const creature = new Creature(3, 2, { layers: [{ count: 3 }] });
    creature.score = -0.1 * (i + 1);
    CreatureUtil.makeUUID(creature);
    population.push(creature);
  }

  mutator.mutate(population);

  const aggregate = diagnostics.getGenerationStats();
  const report = telemetry.finaliseGeneration(population);

  assert(aggregate.proposedCount > 0, "M-H decisions were taken");
  assertEquals(report.mcmc.proposed, aggregate.proposedCount);
  assertEquals(report.mcmc.accepted, aggregate.acceptedCount);
  assertEquals(report.mcmc.rejected, aggregate.rejectedCount);

  // Every rejected batch is also a revert, so the two views agree.
  let reverted = 0;
  let perOperatorRejections = 0;
  for (const summary of Object.values(report.operators)) {
    reverted += summary.reverted;
    perOperatorRejections += summary.mcmcRejected;
  }
  assertEquals(reverted, aggregate.rejectedCount);
  assertEquals(perOperatorRejections, aggregate.rejectedCount);
});

// ── De-duplication ───────────────────────────────────────────────────

Deno.test("MutationOperatorTelemetry: de-duplicated offspring are excluded from evaluated and wallClock", async () => {
  const telemetry = new MutationOperatorTelemetry();
  const neat = new Neat(1, 1, {}, []);
  const mutator = new Mutator(
    neat.config,
    undefined,
    undefined,
    undefined,
    telemetry,
  );

  // A population of identical creatures forces the de-duplicator down its
  // replacement path, which mutates clones that are then thrown away.
  const template = new Creature(2, 1, { layers: [{ count: 2 }] })
    .exportJSON();
  const population: Creature[] = [];
  for (let i = 0; i < neat.config.populationSize * 2; i++) {
    population.push(Creature.fromJSON(template));
  }

  const genus = new Genus();
  const deDuplicator = new DeDuplicator(
    new Breed(genus, neat.config),
    mutator,
  );
  await deDuplicator.perform(population);

  // Nothing ever reached Fitness.calculate(), so no operator may claim an
  // evaluation or a millisecond of evaluation wall-clock.
  const first = telemetry.finaliseGeneration(population);
  let applied = 0;
  for (const [name, summary] of Object.entries(first.operators)) {
    applied += summary.applied;
    assertEquals(summary.evaluated, 0, `${name} evaluated`);
    assertEquals(summary.evaluationMs, 0, `${name} evaluationMs`);
  }
  assert(applied > 0, `the replacement path mutated clones (${applied})`);
  assertEquals(first.attribution.evaluationMs, 0);

  // Once the slack expires the abandoned offspring are reported as discarded
  // rather than quietly vanishing.
  const second = telemetry.finaliseGeneration(population);
  assertEquals(second.attribution.resolvedOffspring, 0);
  assertEquals(second.attribution.evaluationMs, 0);
  assert(
    second.attribution.discardedOffspring > 0,
    "offspring that never reached fitness are reported as discarded",
  );
});

// ── End to end through evolve() ──────────────────────────────────────

Deno.test("MutationOperatorTelemetry: evolution emits a per-operator report on generation_complete", async () => {
  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const reports: NonNullable<
    Extract<TrainingEvent, { kind: "generation_complete" }>["mutationOperators"]
  >[] = [];

  const creature = new Creature(2, 1);
  await creature.evolveDataSet(trainingSet, {
    populationSize: 20,
    elitism: 2,
    mutationRate: 1,
    iterations: 4,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete" && event.mutationOperators) {
        reports.push(event.mutationOperators);
      }
    },
  });

  assert(reports.length > 0, "a report was emitted every generation");

  let totalProposed = 0;
  let totalEvaluated = 0;
  for (const report of reports) {
    assert(report.attribution.note.length > 0, "ambiguity note present");
    for (const summary of Object.values(report.operators)) {
      totalProposed += summary.proposed;
      totalEvaluated += summary.evaluated;
      // Counters must stay internally consistent: nothing is applied that was
      // not proposed, and nothing is evaluated that was reverted.
      assert(
        summary.applied + summary.noChange <= summary.proposed,
        "applied + noChange never exceeds proposed",
      );
      assertEquals(
        summary.accepted + summary.rejected,
        summary.evaluated,
        "every evaluated offspring is either accepted or rejected",
      );
    }
  }

  assert(totalProposed > 0, `mutations were proposed (${totalProposed})`);
  assert(
    totalEvaluated > 0,
    `mutated offspring reached evaluation (${totalEvaluated})`,
  );
});
