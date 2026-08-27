/**
 * Unit tests for the whole-run per-backend scorer-utilisation aggregation used
 * by the `evolve*` functions (Issue #3234).
 *
 * The aggregator sums the per-generation batch/worker split captured by
 * `Fitness.calculate()`, so a run in which the eligibility predicate kept the
 * whole population off the batch scorer is visible as a non-zero
 * `creaturesPerCreatureScored` where zero was expected. Issue #3871 removed the
 * batch-fallback tally along with the fallback itself — a failed batch now
 * aborts the generation rather than being re-scored on the other engine.
 */

import { assertEquals } from "@std/assert";
import {
  accumulateScorerUtilisation,
  createScorerUtilisationAccumulator,
  finaliseScorerUtilisationTotals,
  type ScorerUtilisationCounts,
} from "@creature/ScorerUtilisationTotals.ts";

/** Build a ScorerUtilisationCounts with zeroed defaults. */
function counts(
  overrides: Partial<ScorerUtilisationCounts> = {},
): ScorerUtilisationCounts {
  return {
    batchScorerInvocations: 0,
    creaturesBatchScored: 0,
    creaturesPerCreatureScored: 0,
    ...overrides,
  };
}

Deno.test("ScorerUtilisationTotals: empty accumulator finalises to zeros", () => {
  const acc = createScorerUtilisationAccumulator();
  const totals = finaliseScorerUtilisationTotals(acc);
  assertEquals(totals.generations, 0);
  assertEquals(totals.batchScorerInvocations, 0);
  assertEquals(totals.creaturesBatchScored, 0);
  assertEquals(totals.creaturesPerCreatureScored, 0);
});

Deno.test("ScorerUtilisationTotals: all-batch run — invocations match generations", () => {
  const acc = createScorerUtilisationAccumulator();
  const generations = 5;
  for (let g = 0; g < generations; g++) {
    accumulateScorerUtilisation(
      acc,
      counts({ batchScorerInvocations: 1, creaturesBatchScored: 8 }),
    );
  }
  const totals = finaliseScorerUtilisationTotals(acc);
  assertEquals(totals.generations, generations);
  // One scorer process per generation → invocations equal generation count.
  assertEquals(totals.batchScorerInvocations, generations);
  assertEquals(totals.creaturesBatchScored, 8 * generations);
  assertEquals(totals.creaturesPerCreatureScored, 0);
});

Deno.test("ScorerUtilisationTotals: mixed population — recurrent creatures counted per-creature", () => {
  const acc = createScorerUtilisationAccumulator();
  // Each generation batches 6 forwardOnly creatures and worker-scores 4
  // recurrent creatures.
  accumulateScorerUtilisation(
    acc,
    counts({
      batchScorerInvocations: 1,
      creaturesBatchScored: 6,
      creaturesPerCreatureScored: 4,
    }),
  );
  accumulateScorerUtilisation(
    acc,
    counts({
      batchScorerInvocations: 1,
      creaturesBatchScored: 6,
      creaturesPerCreatureScored: 4,
    }),
  );
  const totals = finaliseScorerUtilisationTotals(acc);
  assertEquals(totals.generations, 2);
  assertEquals(totals.batchScorerInvocations, 2);
  assertEquals(totals.creaturesBatchScored, 12);
  assertEquals(totals.creaturesPerCreatureScored, 8);
});

Deno.test("ScorerUtilisationTotals: an ineligible generation counts entirely per-creature", () => {
  const acc = createScorerUtilisationAccumulator();
  // Healthy generation: batch scored everything.
  accumulateScorerUtilisation(
    acc,
    counts({ batchScorerInvocations: 1, creaturesBatchScored: 10 }),
  );
  // A generation the eligibility predicate refused entirely (a custom cost, or
  // configured outputRanges): no scorer process, every creature on the worker
  // path.
  accumulateScorerUtilisation(
    acc,
    counts({
      batchScorerInvocations: 0,
      creaturesBatchScored: 0,
      creaturesPerCreatureScored: 10,
    }),
  );
  const totals = finaliseScorerUtilisationTotals(acc);
  assertEquals(totals.generations, 2);
  assertEquals(totals.batchScorerInvocations, 1);
  assertEquals(totals.creaturesBatchScored, 10);
  assertEquals(totals.creaturesPerCreatureScored, 10);
});
