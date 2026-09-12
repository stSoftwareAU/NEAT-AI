/**
 * The guarded/unguarded arms of the A/B harness (Issue #3933).
 *
 * The harness is how the issue's "≥100 generations judged on final exact
 * score" criterion is answered, so what it reports is tested rather than
 * trusted: a guarded arm really does carry the guard, really does spend part
 * of its exact evaluations on uncertainty, and an unguarded arm really does
 * run without one.
 *
 * The arms here are deliberately tiny — the long-horizon comparison lives in
 * `scripts/surrogate_uncertainty_ab.ts`, which refuses a horizon shorter than
 * 100 generations. This suite checks the plumbing, not the verdict.
 */

import { assert, assertEquals } from "@std/assert";
import {
  type ABArm,
  type ABSettings,
  buildCorpus,
  DEFAULT_AB_SETTINGS,
  runArm,
} from "../../scripts/lib/preSelectionAB.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

/** A run small enough for a unit test and large enough to screen something. */
const SMALL: ABSettings = {
  ...DEFAULT_AB_SETTINGS,
  corpusRecords: 120,
  populationSize: 10,
  generations: 5,
  elitism: 2,
};

/** The guarded arm: the surrogate screen with the Issue #3933 guard on. */
const GUARDED: ABArm = {
  arm: "guarded",
  ratio: 3,
  screen: "surrogate",
  randomSurvivorFraction: 0.25,
  uncertainty: { enabled: true, minUncertaintyFraction: 0.25 },
};

/** The unguarded arm: the Issue #3932 predicted-rank argmax. */
const UNGUARDED: ABArm = {
  arm: "unguarded",
  ratio: 3,
  screen: "surrogate",
  randomSurvivorFraction: 0.25,
  uncertainty: { enabled: false },
};

Deno.test("surrogate A/B — the guarded arm reports its three diagnostics", async () => {
  await withRngTestLock(async () => {
    const result = await runArm(GUARDED, SMALL, buildCorpus(SMALL));
    const diagnostics = result.surrogate;
    assert(diagnostics !== undefined, "a guarded arm must report its guard");
    assert(diagnostics.generations > 0);
    assert(diagnostics.exactSlots > 0);
    assert(
      diagnostics.uncertaintyFraction >= 0.25,
      `the configured floor must be honoured, got ` +
        `${diagnostics.uncertaintyFraction}`,
    );
    assert(diagnostics.outOfDistributionRate >= 0);
    assert(Number.isFinite(diagnostics.signedBias));
  });
});

Deno.test("surrogate A/B — the unguarded arm runs without a guard at all", async () => {
  await withRngTestLock(async () => {
    const result = await runArm(UNGUARDED, SMALL, buildCorpus(SMALL));
    assertEquals(result.surrogate, undefined);
    assert(Number.isFinite(result.finalScore));
  });
});

Deno.test("surrogate A/B — the guard accounts for every slot it allocated", async () => {
  await withRngTestLock(async () => {
    const result = await runArm(GUARDED, SMALL, buildCorpus(SMALL));
    const d = result.surrogate;
    assert(d !== undefined);
    assert(
      d.explorationSlots <= d.exactSlots,
      "exploration cannot exceed the slots there were",
    );
    assert(
      d.exactSlots <= d.candidates,
      "the guard cannot allocate more evaluations than candidates it saw",
    );
    assert(d.outOfDistribution <= d.candidates);
    assertEquals(
      d.uncertaintyFraction,
      d.explorationSlots / d.exactSlots,
      "the reported fraction must be the one the slots add up to",
    );
  });
});
