/**
 * The surrogate screen under the uncertainty guard (Issue #3933).
 *
 * These are the end-to-end cases the issue's acceptance list turns on: an
 * out-of-distribution descriptor yields a **refusal** and that candidate is
 * routed to an exact evaluation; a stated minimum fraction of the exact
 * evaluations goes to the candidates the model is least sure about; and a
 * persistent one-directional bias takes the surrogate path out of the run
 * altogether.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { PreSelection } from "@neat/PreSelection.ts";
import { SurrogateScreen } from "@neat/OffspringScreen.ts";
import { resolvePreSelectionConfig } from "@config/PreSelectionConfig.ts";
import { resolveSurrogateUncertaintyConfig } from "@config/SurrogateUncertaintyConfig.ts";
import { PreSelectionError } from "@errors/PreSelectionError.ts";
import { isPrediction } from "@surrogate/UncertainSurrogate.ts";
import { createSeededRng } from "@utils/RandomNumberGenerator.ts";
import type { Creature } from "@creature";
import { buildCandidates } from "./_preSelectionFixtures.ts";

/** A screen taught `count` structurally ordinary creatures. */
function trainedScreen(count = 12, neighbours = 3): SurrogateScreen {
  const screen = new SurrogateScreen(64, neighbours);
  const trained = buildCandidates(count);
  trained.forEach((creature, index) => {
    screen.observe(creature, 0.3 + index * 0.001);
  });
  return screen;
}

Deno.test("surrogate screen — every prediction carries an uncertainty", () => {
  const screen = trainedScreen();
  const verdicts = screen.verdicts(buildCandidates(4));
  assertEquals(verdicts.length, 4);
  for (const verdict of verdicts) {
    assert(isPrediction(verdict), "a covered candidate should be predicted");
    assert(Number.isFinite(verdict.value));
    assert(verdict.uncertainty >= 0 && Number.isFinite(verdict.uncertainty));
  }
});

Deno.test("surrogate screen — an out-of-distribution creature is refused, not predicted", () => {
  const screen = trainedScreen();
  // Forty hidden neurons against a window of one to twelve: the novel
  // topology a NEAT population produces, and the point the model has no data
  // near.
  const novel = buildCandidates(1, 40);
  const [verdict] = screen.verdicts(novel);
  assertEquals(verdict.kind, "out-of-distribution");
  assert(!isPrediction(verdict));
  if (!isPrediction(verdict)) {
    assert(verdict.reason.length > 0);
    assert(verdict.distance > verdict.limit || verdict.limit === 0);
  }
});

Deno.test("surrogate screen — an unready model is asked for nothing", () => {
  const screen = new SurrogateScreen(64, 3);
  const error = assertThrows(
    () => screen.verdicts(buildCandidates(2)),
    PreSelectionError,
  );
  assertEquals(error.reason, "INVALID_SCREEN_VALUE");
});

Deno.test("surrogate screen — an unusual creature is less certainly predicted", () => {
  const screen = trainedScreen(12);
  // Candidate 1 sits inside the trained window; candidate 11 sits at its
  // edge, which is where a k-NN model has the least support.
  const [inside] = screen.verdicts(buildCandidates(1, 3));
  const [edge] = screen.verdicts(buildCandidates(1, 11));
  assert(isPrediction(inside) && isPrediction(edge));
  assert(
    edge.uncertainty > inside.uncertainty,
    `edge ${edge.uncertainty} should exceed interior ${inside.uncertainty}`,
  );
});

Deno.test("pre-selection — an out-of-distribution candidate earns an exact evaluation", async () => {
  const stage = new PreSelection(
    resolvePreSelectionConfig({
      ratio: 3,
      screen: "surrogate",
      randomSurvivorFraction: 0,
    }),
    trainedScreen(),
  );
  const ordinary = buildCandidates(8) as Creature[];
  const novel = buildCandidates(1, 40) as Creature[];
  const candidates = [...ordinary, ...novel];
  const outcome = await stage.select(candidates, 3, 1, createSeededRng(3933));
  const survivorUuids = outcome.survivors.map((creature) => creature.uuid);
  assert(
    survivorUuids.includes(novel[0].uuid),
    "the candidate the model refused to predict must be measured, not dropped",
  );
  const rank = stage.screenRankOf(novel[0]);
  assertEquals(rank?.reason, "out-of-distribution");
  // A refusal has no number behind it, so none is invented for the trace.
  assertEquals(rank?.value, null);
});

Deno.test("pre-selection — the generation reports its guard diagnostics", async () => {
  const stage = new PreSelection(
    resolvePreSelectionConfig({
      ratio: 4,
      screen: "surrogate",
      randomSurvivorFraction: 0,
      uncertainty: { minUncertaintyFraction: 0.25 },
    }),
    trainedScreen(),
  );
  const outcome = await stage.select(
    buildCandidates(16) as Creature[],
    4,
    1,
    createSeededRng(3933),
  );
  const surrogate = outcome.summary.surrogate;
  assert(surrogate !== undefined, "the guard must report what it spent");
  assertEquals(surrogate.rule, "ei");
  assertEquals(surrogate.slots, 4);
  assert(surrogate.uncertaintyFraction >= 0.25);
  assert(surrogate.outOfDistributionRate >= 0);
  const line = stage.describeAllocation();
  assert(line?.includes("uncertainty allocation"), line);
  const runLine = stage.describeSurrogateRun();
  assert(runLine?.includes("OOD rate"), runLine);
  stage.surrogateGuard?.assertUncertaintyAllocation();
});

Deno.test("pre-selection — the uncertainty floor keeps spending on doubt", async () => {
  const stage = new PreSelection(
    resolvePreSelectionConfig({
      ratio: 4,
      screen: "surrogate",
      randomSurvivorFraction: 0,
      uncertainty: { minUncertaintyFraction: 0.5 },
    }),
    trainedScreen(),
  );
  const outcome = await stage.select(
    buildCandidates(16) as Creature[],
    4,
    1,
    createSeededRng(3933),
  );
  const reasons = outcome.survivors.map((creature) =>
    stage.screenRankOf(creature)?.reason
  );
  const explored =
    reasons.filter((reason) =>
      reason === "uncertainty" || reason === "out-of-distribution"
    ).length;
  assert(
    explored >= 2,
    `half of four slots must be exploration, got ${explored}: ${reasons}`,
  );
});

Deno.test("pre-selection — the guard off restores the Issue #3932 argmax", async () => {
  const stage = new PreSelection(
    resolvePreSelectionConfig({
      ratio: 3,
      screen: "surrogate",
      randomSurvivorFraction: 0,
      uncertainty: { enabled: false },
    }),
    trainedScreen(),
  );
  const outcome = await stage.select(
    [...buildCandidates(8), ...buildCandidates(1, 40)] as Creature[],
    3,
    1,
    createSeededRng(3933),
  );
  assertEquals(outcome.summary.surrogate, undefined);
  assertEquals(stage.surrogateGuard, undefined);
  for (const creature of outcome.survivors) {
    assertEquals(stage.screenRankOf(creature)?.reason, "rank");
  }
});

Deno.test("pre-selection — a one-directional bias disables the surrogate path", async () => {
  const stage = new PreSelection(
    resolvePreSelectionConfig({
      ratio: 3,
      screen: "surrogate",
      randomSurvivorFraction: 0,
      uncertainty: { driftGenerations: 2, driftMinSamples: 2 },
    }),
    trainedScreen(),
  );
  assertEquals(stage.active, true);
  for (let generation = 1; generation <= 4; generation++) {
    const candidates = buildCandidates(9, generation) as Creature[];
    // Generations are sequential by definition: each screens what the one
    // before it left behind.
    // deno-lint-ignore no-await-in-loop
    const outcome = await stage.select(
      candidates,
      3,
      generation,
      createSeededRng(3933 + generation),
    );
    // Every survivor comes back *worse* than the model predicted, by the same
    // sign every time — the false-optimum signature.
    for (const creature of outcome.survivors) {
      creature.score = 0.2;
    }
    stage.observe(outcome.survivors, generation);
    if (stage.surrogateGuard?.disabled === true) break;
  }
  assertEquals(stage.surrogateGuard?.disabled, true);
  // Disabled means *not consulted*: the stage stops over-generating, so every
  // creature goes to a true evaluation.
  assertEquals(stage.active, false);
  const passthrough = await stage.select(
    buildCandidates(9, 9) as Creature[],
    3,
    9,
    createSeededRng(1),
  );
  assertEquals(passthrough.survivors.length, 9);
  assertEquals(passthrough.discarded.length, 0);
  const line = stage.describeDrift();
  assert(line?.includes("DISABLED"), line);
});

Deno.test("pre-selection — symmetric error leaves the surrogate path alone", async () => {
  const stage = new PreSelection(
    resolvePreSelectionConfig({
      ratio: 3,
      screen: "surrogate",
      randomSurvivorFraction: 0,
      uncertainty: resolveSurrogateUncertaintyConfig({
        driftGenerations: 2,
        driftMinSamples: 2,
      }),
    }),
    trainedScreen(),
  );
  for (let generation = 1; generation <= 6; generation++) {
    // deno-lint-ignore no-await-in-loop
    const outcome = await stage.select(
      buildCandidates(9, generation) as Creature[],
      3,
      generation,
      createSeededRng(3933 + generation),
    );
    outcome.survivors.forEach((creature, index) => {
      // Exact scores that straddle the window the model was taught, by far
      // more than the model's own spread: the residuals alternate sign, which
      // is ordinary noise rather than a trend.
      creature.score = 0.305 + (index % 2 === 0 ? 0.1 : -0.1);
    });
    stage.observe(outcome.survivors, generation);
  }
  assertEquals(stage.surrogateGuard?.disabled, false);
  assertEquals(stage.active, true);
});
