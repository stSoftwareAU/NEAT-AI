/**
 * Offspring pre-selection — the surplus-and-screen stage (Issue #3932).
 *
 * The load-bearing cases are the ones the issue names as failure modes: a
 * ratio of 1 must behave exactly as the build did before, the random survivor
 * fraction must genuinely not be rank-ordered, and a screened-out creature must
 * leave no trace at all — no score, no rank, nothing anything downstream could
 * record.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { PreSelection } from "@neat/PreSelection.ts";
import type { OffspringScreen } from "@neat/OffspringScreen.ts";
import { SurrogateScreen } from "@neat/OffspringScreen.ts";
import {
  DEFAULT_PRE_SELECTION_CONFIG,
  resolvePreSelectionConfig,
} from "@config/PreSelectionConfig.ts";
import { PreSelectionError } from "@errors/PreSelectionError.ts";
import { createSeededRng } from "@utils/RandomNumberGenerator.ts";
import type { Creature } from "@creature";
import { markScoreFidelity } from "@architecture/ScoreFidelity.ts";
import { buildCandidates } from "./_preSelectionFixtures.ts";

/**
 * A screen whose value is the candidate's position in the array it is given —
 * so the ranking under test is exactly known, without a model in the way.
 */
function positionScreen(
  options: { ready?: boolean; write?: boolean } = {},
): OffspringScreen {
  return {
    name: "sampled",
    ready: () => options.ready ?? true,
    screen: (candidates) => {
      const values = candidates.map((_, index) => candidates.length - index);
      if (options.write) {
        candidates.forEach((candidate, index) => {
          candidate.score = values[index];
        });
      }
      return Promise.resolve(values);
    },
  };
}

/** The stage as a caller would configure it: over-generate 3x and screen. */
function activeStage(
  overrides: Parameters<typeof resolvePreSelectionConfig>[0] = {},
  screen: OffspringScreen = positionScreen(),
): PreSelection {
  return new PreSelection(
    resolvePreSelectionConfig({ ratio: 3, screen: "sampled", ...overrides }),
    screen,
  );
}

Deno.test("pre-selection — the default stage is off and changes nothing", async () => {
  const stage = new PreSelection(DEFAULT_PRE_SELECTION_CONFIG);
  assertEquals(stage.active, false);
  assertEquals(stage.offspringTarget(20), 20);
  const candidates = buildCandidates(20);
  const outcome = await stage.select(candidates, 20, 1);
  assertEquals(outcome.survivors.length, 20);
  assertEquals(outcome.discarded.length, 0);
  assertEquals(outcome.survivors, candidates);
  assertEquals(stage.lastGeneration, undefined);
});

Deno.test("pre-selection — ratio 1 is identical to the current build even with a screen present", async () => {
  // A screen object cannot switch the stage on by itself; the ratio does.
  const stage = new PreSelection(
    DEFAULT_PRE_SELECTION_CONFIG,
    positionScreen(),
  );
  assertEquals(stage.active, false);
  assertEquals(stage.offspringTarget(17), 17);
  const candidates = buildCandidates(6);
  const outcome = await stage.select(candidates, 6, 3);
  assertEquals(outcome.survivors, candidates);
  assertEquals(outcome.discarded.length, 0);
  for (const survivor of outcome.survivors) {
    assertEquals(survivor.score, undefined);
    assertEquals(stage.screenRankOf(survivor), null);
  }
});

Deno.test("pre-selection — an active stage asks the breeder for a surplus", () => {
  const stage = activeStage();
  assertEquals(stage.active, true);
  assertEquals(stage.offspringTarget(20), 60);
  assertEquals(stage.offspringTarget(7), 21);
  // A fractional ratio rounds up: a fraction of a creature cannot be bred.
  assertEquals(activeStage({ ratio: 2.5 }).offspringTarget(7), 18);
});

Deno.test("pre-selection — a non-positive budget is never over-generated", () => {
  const stage = activeStage();
  assertEquals(stage.offspringTarget(0), 0);
  assertEquals(stage.offspringTarget(-4), -4);
});

Deno.test("pre-selection — an unready screen breeds no surplus and discards nothing", async () => {
  const stage = activeStage({}, positionScreen({ ready: false }));
  assertEquals(stage.offspringTarget(20), 20);
  const candidates = buildCandidates(20);
  const outcome = await stage.select(candidates, 20, 2);
  assertEquals(outcome.discarded.length, 0);
  assertEquals(outcome.summary.screenReady, false);
  assert(stage.describe(outcome.summary).includes("not ready"));
});

Deno.test("pre-selection — the surplus is cut to the population budget", async () => {
  const stage = activeStage({ randomSurvivorFraction: 0 });
  const candidates = buildCandidates(12);
  const outcome = await stage.select(candidates, 4, 5);
  assertEquals(outcome.survivors.length, 4);
  assertEquals(outcome.discarded.length, 8);
  // The position screen ranks the earliest candidates highest.
  assertEquals(outcome.survivors, candidates.slice(0, 4));
  assertEquals(outcome.summary.offspringGenerated, 12);
  assertEquals(outcome.summary.screenedOut, 8);
  assertEquals(outcome.summary.randomSurvivors, 0);
  assert(outcome.summary.screenMs >= 0);
});

Deno.test("pre-selection — survivors are handed on best-ranked first", async () => {
  const stage = activeStage({ randomSurvivorFraction: 0 });
  const candidates = buildCandidates(9);
  // Reverse the screen so the best candidate is last in the input array.
  const reversing: OffspringScreen = {
    name: "sampled",
    ready: () => true,
    screen: (given) => Promise.resolve(given.map((_, index) => index)),
  };
  const outcome = await new PreSelection(
    resolvePreSelectionConfig({ ratio: 3, screen: "sampled" }),
    reversing,
  ).select(candidates, 3, 1);
  assertEquals(outcome.survivors.length, 3);
  assertEquals(outcome.survivors[0], candidates[8]);
  assert(stage.describe(outcome.summary).length > 0);
});

Deno.test("pre-selection — the random survivor fraction is not rank-ordered", async () => {
  // The position screen ranks candidate 0 best and candidate 29 worst. With a
  // quarter of the survivors drawn uniformly, creatures from outside the top
  // slots must survive — and must not be the same ones every time.
  const bottomHalfSurvivals = new Map<string, number>();
  let anyBelowCut = 0;
  const trials = 40;
  const draws = await Promise.all(
    Array.from({ length: trials }, (_unused, trial) => {
      const candidates = buildCandidates(30);
      return activeStage({ randomSurvivorFraction: 0.25 })
        .select(candidates, 10, 1, createSeededRng(1000 + trial))
        .then((outcome) => ({ candidates, outcome }));
    }),
  );
  for (const { candidates, outcome } of draws) {
    assertEquals(outcome.survivors.length, 10);
    assertEquals(outcome.summary.randomSurvivors, 3);
    const cut = candidates.slice(10);
    let belowCut = 0;
    for (const survivor of outcome.survivors) {
      if (!cut.includes(survivor)) continue;
      belowCut++;
      const uuid = survivor.uuid ?? "";
      bottomHalfSurvivals.set(uuid, (bottomHalfSurvivals.get(uuid) ?? 0) + 1);
    }
    if (belowCut > 0) anyBelowCut++;
  }
  assert(
    anyBelowCut > trials / 2,
    `screen-rejected candidates should usually survive the uniform draw, ` +
      `saw ${anyBelowCut}/${trials}`,
  );
  assert(
    bottomHalfSurvivals.size > 5,
    `the uniform draw should reach many different candidates, reached ` +
      `${bottomHalfSurvivals.size}`,
  );
});

Deno.test("pre-selection — a random-survivor fraction of 1 keeps nobody by rank", async () => {
  const stage = activeStage({ randomSurvivorFraction: 1 });
  const candidates = buildCandidates(20);
  const outcome = await stage.select(candidates, 5, 1, createSeededRng(7));
  assertEquals(outcome.survivors.length, 5);
  assertEquals(outcome.summary.randomSurvivors, 5);
  for (const survivor of outcome.survivors) {
    assertEquals(stage.screenRankOf(survivor)?.reason, "random");
  }
});

Deno.test("pre-selection — a discarded creature is never scored or ranked", async () => {
  const stage = activeStage({ randomSurvivorFraction: 0 });
  const candidates = buildCandidates(15);
  const outcome = await stage.select(candidates, 5, 4);
  assertEquals(outcome.discarded.length, 10);
  for (const dropped of outcome.discarded) {
    assertEquals(
      dropped.score,
      undefined,
      "a screened-out creature must carry no score",
    );
    assertEquals(
      stage.screenRankOf(dropped),
      null,
      "a screened-out creature must leave no rank behind",
    );
    assert(
      !outcome.survivors.includes(dropped),
      "a screened-out creature must not reach the evaluated set",
    );
  }
});

Deno.test("pre-selection — a screen that writes a score is refused", async () => {
  const stage = activeStage({}, positionScreen({ write: true }));
  const error = await assertRejects(
    () => stage.select(buildCandidates(9), 3, 1),
    PreSelectionError,
  );
  assertEquals(error.reason, "SCREEN_WROTE_SCORE");
});

Deno.test("pre-selection — elites are never screened, and their rank is reported", async () => {
  const stage = activeStage({ randomSurvivorFraction: 0 });
  const candidates = buildCandidates(12);
  const outcome = await stage.select(candidates, 4, 6);
  // An elite that was bred last generation carries the rank it was given.
  const elite = outcome.survivors[0];
  const ranks = stage.recordElites([elite]);
  assertEquals(ranks.length, 1);
  assertEquals(ranks[0].rank, 0);
  assertEquals(ranks[0].of, 12);
  assertEquals(ranks[0].generation, 6);
  assertEquals(stage.eliteScreenRanks.length, 1);
  assert(stage.describeEliteRanks(ranks)?.includes("1/12"));

  // A creature the stage never saw — an elite carried forward, a random
  // immigrant, a fine-tuned clone — has no rank and is not invented one.
  const [outsider] = buildCandidates(1, 40);
  assertEquals(stage.screenRankOf(outsider), null);
  assertEquals(stage.recordElites([outsider]).length, 0);
  assertEquals(stage.describeEliteRanks([]), undefined);
});

Deno.test("pre-selection — a survivor screened without a UUID is still ranked", async () => {
  // Issue #4008: a real bred offspring reaches the screen with no UUID —
  // mutation invalidated it and fitness only recomputes it after screening —
  // so a rank keyed on the UUID is never recorded in a production run.
  const stage = activeStage({ randomSurvivorFraction: 0 });
  const candidates = buildCandidates(12);
  for (const candidate of candidates) delete candidate.uuid;
  const outcome = await stage.select(candidates, 4, 6);

  const elite = outcome.survivors[0];
  assertEquals(elite.uuid, undefined, "the fixture must stay UUID-less");
  const rank = stage.screenRankOf(elite);
  assert(rank !== null, "a survivor with no UUID must still carry its rank");
  assertEquals(rank.rank, 0);
  assertEquals(rank.of, 12);
  assertEquals(rank.generation, 6);

  // The once-per-creature dedup cannot lean on a UUID either.
  assertEquals(stage.recordElites([elite]).length, 1);
  assertEquals(stage.recordElites([elite]).length, 1);
  assertEquals(stage.eliteScreenRanks.length, 1);

  // A discarded creature still leaves nothing behind.
  assertEquals(stage.screenRankOf(outcome.discarded[0]), null);
});

Deno.test("pre-selection — an elite is counted once, however long it survives", async () => {
  const stage = activeStage({ randomSurvivorFraction: 0 });
  const outcome = await stage.select(buildCandidates(9), 3, 1);
  const elite = outcome.survivors[0];

  // The same creature is the elite in two consecutive generations. Counting it
  // twice would weight the distribution towards elitism, not the screen.
  assertEquals(stage.recordElites([elite]).length, 1);
  assertEquals(stage.recordElites([elite]).length, 1);
  assertEquals(stage.eliteScreenRanks.length, 1);
});

Deno.test("pre-selection — observe refuses to learn from an approximate score", () => {
  const surrogate = new SurrogateScreen(32, 3);
  const stage = new PreSelection(
    resolvePreSelectionConfig({ ratio: 2, screen: "surrogate" }),
    surrogate,
  );
  const population = buildCandidates(4) as Creature[];
  population.forEach((creature, index) => creature.score = index);
  // Issue #3931: a cheap score and an exact score are different measurements,
  // and a model fitted to a mixture of the two is fitted to neither.
  markScoreFidelity(population[1], 0.05);
  markScoreFidelity(population[2], 0.5);
  stage.observe(population);
  assertEquals(surrogate.trainingSize, 2);
});

Deno.test("pre-selection — ranks survive one generation and are then forgotten", async () => {
  const stage = activeStage({ randomSurvivorFraction: 0 });
  const first = buildCandidates(9);
  const firstOutcome = await stage.select(first, 3, 1);
  const kept = firstOutcome.survivors[0];
  assert(stage.screenRankOf(kept) !== null);

  await stage.select(buildCandidates(9, 20), 3, 2);
  assert(
    stage.screenRankOf(kept) !== null,
    "the previous generation's ranks are what this generation's elites need",
  );
  await stage.select(buildCandidates(9, 40), 3, 3);
  assertEquals(
    stage.screenRankOf(kept),
    null,
    "older ranks are dropped so a long run stays bounded",
  );
});

Deno.test("pre-selection — observe feeds only finite exact scores to the screen", () => {
  const surrogate = new SurrogateScreen(32, 3);
  const stage = new PreSelection(
    resolvePreSelectionConfig({ ratio: 2, screen: "surrogate" }),
    surrogate,
  );
  const population = buildCandidates(5) as Creature[];
  population[0].score = 1;
  population[1].score = -Infinity;
  population[2].score = 3;
  population[3].score = undefined;
  population[4].score = 5;
  stage.observe(population);
  assertEquals(surrogate.trainingSize, 3);
  assertEquals(stage.screen, surrogate);
  assert(surrogate.ready());
});

Deno.test("pre-selection — reset clears the ranks and the elite trace", async () => {
  const stage = activeStage({ randomSurvivorFraction: 0 });
  const candidates = buildCandidates(9);
  const outcome = await stage.select(candidates, 3, 1);
  stage.recordElites([outcome.survivors[0]]);
  assertEquals(stage.eliteScreenRanks.length, 1);
  stage.reset();
  assertEquals(stage.eliteScreenRanks.length, 0);
  assertEquals(stage.lastGeneration, undefined);
  assertEquals(stage.screenRankOf(outcome.survivors[0]), null);
});
