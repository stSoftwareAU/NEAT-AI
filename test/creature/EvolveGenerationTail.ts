/**
 * Tests for the shared end-of-generation bookkeeping used by `evolveDir`,
 * `evolveEnv`, and `evolveRL` (Issue #3636).
 *
 * These call the real {@link finishGeneration} with real configs, real
 * accumulators and real creatures, asserting on the observable outcome —
 * adopted champion, emitted events, accumulated totals, stop decision. No
 * timing APIs are relied upon, so they are deterministic under the parallel
 * test runner.
 */

import {
  assert,
  assertEquals,
  AssertionError,
  assertNotStrictEquals,
  assertRejects,
} from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type {
  GenerationPhaseTiming,
  GenerationThroughputMetrics,
  TrainingEvent,
} from "@config/TrainingEvent.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { EvolveResult } from "@neat/NeatEvolution.ts";
import {
  finishGeneration,
  type GenerationTailContext,
  type GenerationTailSource,
} from "@creature/EvolveGenerationTail.ts";
import { createPhaseTimingAccumulator } from "@creature/PhaseTimingTotals.ts";
import { createScorerUtilisationAccumulator } from "@creature/ScorerUtilisationTotals.ts";
import { createScoreTrajectory } from "@creature/ScoreImprovementMilestones.ts";

const PHASE_TIMING: GenerationPhaseTiming = {
  fitnessMs: 10,
  breedingMs: 4,
  resultProcessingMs: 1,
  totalMs: 20,
  mutationMs: 2,
  deduplicationMs: 1,
  speciationMs: 1,
  sortMs: 1,
  writeScoresMs: 1,
};

const THROUGHPUT: GenerationThroughputMetrics = {
  wallClockMs: 20,
  nonFitnessMs: 10,
  generationsPerHour: 180000,
  fastBusyMs: 5,
  fastIdleMs: 15,
  fastQueueMaxDepth: 1,
  fastWaitMs: 0,
  heavyBusyMs: 0,
  heavyIdleMs: 0,
  heavyQueueMaxDepth: 0,
  heavyWaitMs: 0,
  scoredCreatureCount: 4,
  scorerMs: 10,
  creaturesPerSec: 200,
  corruptParentSkips: 0,
};

/** A creature tagged as `evolve()` leaves its fittest. */
function makeFittest(score: number, errorTag: string): Creature {
  const creature = new Creature(2, 1);
  creature.score = score;
  addTag(creature, "error", errorTag);
  return creature;
}

function makeResult(
  fittest: Creature,
  overrides: Partial<EvolveResult> = {},
): EvolveResult {
  return {
    fittest,
    averageScore: -0.5,
    plateau: {
      onPlateau: false,
      generationsOnPlateau: 0,
      improvementRate: null,
      mutationMultiplier: 1,
    },
    phaseTiming: PHASE_TIMING,
    throughput: THROUGHPUT,
    squashHistogram: { LOGISTIC: 3 },
    topologyAverages: { averageNeurons: 4, averageSynapses: 6 },
    ...overrides,
  };
}

function makeSource(
  population: Creature[],
  utilisation: Partial<GenerationTailSource["fitness"]> = {},
): GenerationTailSource {
  return {
    population,
    warmupGenerations: 0,
    currentGeneration: 1,
    fitness: {
      lastBatchScorerInvocations: 1,
      lastCreaturesBatchScored: 3,
      lastCreaturesPerCreatureScored: 2,
      ...utilisation,
    },
  };
}

/** Build a context with fresh accumulators; overrides tune a single field. */
function makeContext(
  result: EvolveResult,
  options: NeatOptions = {},
  overrides: Partial<GenerationTailContext> = {},
): GenerationTailContext {
  const now = Date.now();
  return {
    neat: makeSource([result.fittest]),
    config: createNeatConfig({ iterations: 100, targetError: 0, ...options }),
    result,
    generation: 1,
    start: now,
    iterationStartMS: now,
    endTimeMS: 0,
    interrupted: false,
    bestScore: -Infinity,
    error: Infinity,
    bestCreature: undefined,
    phaseTimingAccumulator: createPhaseTimingAccumulator(),
    scorerUtilisationAccumulator: createScorerUtilisationAccumulator(),
    scoreTrajectory: createScoreTrajectory(),
    ...overrides,
  };
}

Deno.test("finishGeneration adopts an improved champion", async () => {
  const fittest = makeFittest(-0.25, "0.25");
  const ctx = makeContext(makeResult(fittest));

  const outcome = await finishGeneration(ctx);

  assertEquals(outcome.championImproved, true);
  assertEquals(outcome.bestScore, -0.25);
  assertEquals(outcome.error, 0.25);
  assert(outcome.bestCreature !== undefined, "champion clone expected");
  assertNotStrictEquals(
    outcome.bestCreature,
    fittest,
    "champion must be a clone, not the live fittest",
  );
  assertEquals(outcome.bestCreature.score, -0.25);
  assertEquals(ctx.scoreTrajectory.points.length, 1);
  assertEquals(ctx.scoreTrajectory.points[0].generation, 1);
  assertEquals(ctx.scoreTrajectory.points[0].score, -0.25);
  // scoredCount is read after the utilisation accumulator advanced (3 + 2).
  assertEquals(ctx.scoreTrajectory.points[0].scoredCount, 5);
});

Deno.test("finishGeneration keeps the champion when no improvement", async () => {
  // The champion is bred forward as an elite, so the generation's fittest can
  // tie the best score but never fall below it.
  const previous = makeFittest(-0.1, "0.1");
  const fittest = makeFittest(-0.1, "0.1");
  const ctx = makeContext(makeResult(fittest), {}, {
    bestScore: -0.1,
    error: 0.1,
    bestCreature: previous,
  });

  const outcome = await finishGeneration(ctx);

  assertEquals(outcome.championImproved, false);
  assertEquals(outcome.bestScore, -0.1);
  assertEquals(outcome.error, 0.1);
  assertEquals(outcome.bestCreature, previous);
  assertEquals(ctx.scoreTrajectory.points.length, 0);
});

Deno.test("finishGeneration fails loud on a non-finite error tag", async () => {
  // All three loops reject an unbounded error tag rather than adopting a
  // champion whose error cannot be compared against `targetError`.
  await Promise.all(
    ["Infinity", "NaN", "not-a-number"].map((tag) =>
      assertRejects(
        () => finishGeneration(makeContext(makeResult(makeFittest(-1, tag)))),
        AssertionError,
        "Error is not finite",
      )
    ),
  );
});

Deno.test("finishGeneration fails loud on a negative error tag", async () => {
  const ctx = makeContext(makeResult(makeFittest(-1, "-0.5")));

  await assertRejects(
    () => finishGeneration(ctx),
    AssertionError,
    "Error is negative",
  );
});

Deno.test("finishGeneration emits generation_complete", async () => {
  const events: TrainingEvent[] = [];
  const fittest = makeFittest(-0.25, "0.25");
  const result = makeResult(fittest);
  const ctx = makeContext(result, {
    onTrainingEvent: (event: TrainingEvent) => events.push(event),
  });

  await finishGeneration(ctx);

  assertEquals(events.length, 1);
  const event = events[0];
  assert(event.kind === "generation_complete", "expected generation_complete");
  assertEquals(event.generation, 1);
  assertEquals(event.bestFitness, -0.25);
  assertEquals(event.averageFitness, -0.5);
  assertEquals(event.populationSize, 1);
  assertEquals(event.averageNeurons, 4);
  assertEquals(event.averageSynapses, 6);
  assertEquals(event.phaseTiming, PHASE_TIMING);
  assertEquals(event.throughput, THROUGHPUT);
  assertEquals(event.squashHistogram, { LOGISTIC: 3 });
});

Deno.test("finishGeneration emits plateau_detected only on a plateau", async () => {
  const events: TrainingEvent[] = [];
  const onTrainingEvent = (event: TrainingEvent) => events.push(event);

  const calm = makeContext(makeResult(makeFittest(-0.25, "0.25")), {
    onTrainingEvent,
  });
  await finishGeneration(calm);
  assertEquals(events.filter((e) => e.kind === "plateau_detected").length, 0);

  const stuck = makeContext(
    makeResult(makeFittest(-0.25, "0.25"), {
      plateau: {
        onPlateau: true,
        generationsOnPlateau: 7,
        improvementRate: 0,
        mutationMultiplier: 2,
      },
    }),
    { onTrainingEvent },
  );
  await finishGeneration(stuck);

  const plateaus = events.filter((e) => e.kind === "plateau_detected");
  assertEquals(plateaus.length, 1);
  assert(plateaus[0].kind === "plateau_detected");
  assertEquals(plateaus[0].stagnationCount, 7);
  assertEquals(plateaus[0].mutationMultiplier, 2);
});

Deno.test("finishGeneration accumulates timings and scorer counts", async () => {
  const ctx = makeContext(makeResult(makeFittest(-0.5, "0.5")));
  await finishGeneration(ctx);

  const second = {
    ...ctx,
    generation: 2,
    bestScore: -0.5,
    error: 0.5,
    result: makeResult(makeFittest(-0.25, "0.25")),
  };
  await finishGeneration(second);

  assertEquals(ctx.phaseTimingAccumulator.generations, 2);
  assertEquals(ctx.phaseTimingAccumulator.fitnessMs, 20);
  assertEquals(ctx.phaseTimingAccumulator.breedingMs, 8);
  assertEquals(ctx.scorerUtilisationAccumulator.generations, 2);
  assertEquals(ctx.scorerUtilisationAccumulator.creaturesBatchScored, 6);
  assertEquals(ctx.scorerUtilisationAccumulator.creaturesPerCreatureScored, 4);
});

Deno.test("finishGeneration times the checkpoint write", async () => {
  const dir = await Deno.makeTempDir({ prefix: "generation-tail-" });
  try {
    const fittest = makeFittest(-0.25, "0.25");
    const ctx = makeContext(makeResult(fittest), {
      creatureStore: dir,
      checkpointEveryGeneration: true,
    });

    const outcome = await finishGeneration(ctx);

    assert(
      outcome.phaseTiming.checkpointWriteMs !== undefined,
      "checkpoint write must be timed onto the generation's phase timing",
    );
    assert(outcome.phaseTiming.checkpointWriteMs >= 0);
    // The population was actually written out.
    const written: string[] = [];
    for await (const entry of Deno.readDir(dir)) written.push(entry.name);
    assertEquals(written, ["1.json"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("finishGeneration leaves phase timing untouched without a store", async () => {
  const ctx = makeContext(makeResult(makeFittest(-0.25, "0.25")), {
    checkpointEveryGeneration: true,
  });

  const outcome = await finishGeneration(ctx);

  assertEquals(outcome.phaseTiming, PHASE_TIMING);
});

Deno.test("finishGeneration completes when the error meets targetError", async () => {
  const ctx = makeContext(makeResult(makeFittest(-0.05, "0.05")), {
    targetError: 0.1,
  });

  const outcome = await finishGeneration(ctx);

  assertEquals(outcome.earlyStop, true);
  assertEquals(outcome.completed, true);
});

Deno.test("finishGeneration completes at the iteration limit", async () => {
  const ctx = makeContext(makeResult(makeFittest(-0.5, "0.5")), {
    iterations: 3,
  }, { generation: 3 });

  const outcome = await finishGeneration(ctx);

  assertEquals(outcome.earlyStop, false);
  assertEquals(outcome.completed, true);
});

Deno.test("finishGeneration completes when interrupted", async () => {
  const ctx = makeContext(makeResult(makeFittest(-0.5, "0.5")), {}, {
    interrupted: true,
  });

  const outcome = await finishGeneration(ctx);

  assertEquals(outcome.timedOut, false);
  assertEquals(outcome.completed, true);
});

Deno.test("finishGeneration reports a timeout past endTimeMS", async () => {
  const ctx = makeContext(makeResult(makeFittest(-0.5, "0.5")), {}, {
    endTimeMS: Date.now() - 60_000,
  });

  const outcome = await finishGeneration(ctx);

  assertEquals(outcome.timedOut, true);
  assertEquals(outcome.completed, true);
});

Deno.test("finishGeneration keeps running mid-run", async () => {
  const ctx = makeContext(makeResult(makeFittest(-0.5, "0.5")), {
    iterations: 10,
    targetError: 0,
  }, { generation: 2 });

  const outcome = await finishGeneration(ctx);

  assertEquals(outcome.completed, false);
});
