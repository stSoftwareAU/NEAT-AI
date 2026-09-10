/**
 * The cheap screens offspring pre-selection ranks a surplus with (Issue #3932).
 *
 * The tests that matter are the refusals: a screen with no evaluator behind
 * it, a screen that cannot rank yet, and a screen whose values cannot order
 * anything must all fail loudly, because the alternative is discarding two
 * thirds of a generation's offspring on a number that means nothing.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  createOffspringScreen,
  MIN_TRAINING_POINTS,
  SampledCorpusScreen,
  SurrogateScreen,
} from "@neat/OffspringScreen.ts";
import { resolvePreSelectionConfig } from "@config/PreSelectionConfig.ts";
import { PreSelectionError } from "@errors/PreSelectionError.ts";
import { buildCandidates } from "./_preSelectionFixtures.ts";

Deno.test("offspring screen — the sampled screen refuses to exist without an evaluator", () => {
  const error = assertThrows(
    () => new SampledCorpusScreen(undefined),
    PreSelectionError,
  );
  assertEquals(error.reason, "NO_SCREEN_EVALUATOR");
});

Deno.test("offspring screen — the sampled screen returns the evaluator's ranking", async () => {
  const candidates = buildCandidates(4);
  const screen = new SampledCorpusScreen((given) => {
    assertEquals(given.length, 4);
    return Promise.resolve([0.1, 0.9, 0.4, 0.2]);
  });
  assertEquals(screen.ready(), true);
  assertEquals(await screen.screen(candidates), [0.1, 0.9, 0.4, 0.2]);
});

Deno.test("offspring screen — a sampled evaluator that returns the wrong count is refused", async () => {
  const screen = new SampledCorpusScreen(() => Promise.resolve([1, 2]));
  const error = await assertRejects(
    () => screen.screen(buildCandidates(3)),
    PreSelectionError,
  );
  assertEquals(error.reason, "INVALID_SCREEN_VALUE");
});

Deno.test("offspring screen — a sampled evaluator that returns a non-finite value is refused", async () => {
  const screen = new SampledCorpusScreen(() => Promise.resolve([1, NaN, 3]));
  const error = await assertRejects(
    () => screen.screen(buildCandidates(3)),
    PreSelectionError,
  );
  assertEquals(error.reason, "INVALID_SCREEN_VALUE");
});

Deno.test("offspring screen — the surrogate is not ready before it has seen scores", () => {
  const screen = new SurrogateScreen(32, 3);
  assertEquals(screen.ready(), false);
  const observed = buildCandidates(MIN_TRAINING_POINTS);
  for (let i = 0; i < observed.length; i++) {
    screen.observe(observed[i], i);
    assertEquals(screen.ready(), i + 1 >= MIN_TRAINING_POINTS);
  }
});

Deno.test("offspring screen — an unready surrogate refuses to rank rather than guessing", async () => {
  const screen = new SurrogateScreen(32, 3);
  const error = await assertRejects(
    () => screen.screen(buildCandidates(2)),
    PreSelectionError,
  );
  assertEquals(error.reason, "INVALID_SCREEN_VALUE");
});

Deno.test("offspring screen — the surrogate predicts a known creature's own score", async () => {
  const screen = new SurrogateScreen(32, 3);
  const known = buildCandidates(5);
  const scores = [1, 4, 9, 16, 25];
  known.forEach((creature, i) => screen.observe(creature, scores[i]));
  const values = await screen.screen(known);
  // Each candidate is an exact structural match for one training point, so
  // the prediction is that point's own score.
  assertEquals(values, scores);
});

Deno.test("offspring screen — the surrogate orders unseen creatures by structural neighbourhood", async () => {
  const screen = new SurrogateScreen(64, 1);
  const population = buildCandidates(9);
  // Score rises with structural size; the model has never seen 2, 4 or 6.
  const training = [0, 1, 3, 5, 7, 8];
  for (const i of training) screen.observe(population[i], i * 10);
  const unseen = [population[2], population[6]];
  const values = await screen.screen(unseen);
  assertEquals(values.length, 2);
  assert(
    values[1] > values[0],
    `the larger unseen creature should be predicted higher, got ${values}`,
  );
});

Deno.test("offspring screen — the surrogate never learns a non-finite score", async () => {
  const screen = new SurrogateScreen(32, 3);
  const known = buildCandidates(4);
  screen.observe(known[0], -Infinity);
  assertEquals(screen.trainingSize, 0);
  known.forEach((creature, i) => screen.observe(creature, i));
  assertEquals(screen.trainingSize, 4);
  const values = await screen.screen(known);
  for (const value of values) assert(Number.isFinite(value));
});

Deno.test("offspring screen — the surrogate does not let one creature crowd its window", () => {
  const screen = new SurrogateScreen(32, 3);
  const [creature] = buildCandidates(1);
  for (let i = 0; i < 10; i++) screen.observe(creature, i);
  assertEquals(screen.trainingSize, 1);
});

Deno.test("offspring screen — the surrogate window is bounded and evicts oldest first", () => {
  const screen = new SurrogateScreen(4, 2);
  const population = buildCandidates(9);
  population.forEach((creature, i) => screen.observe(creature, i));
  assertEquals(screen.trainingSize, 4);
});

Deno.test("offspring screen — an evicted creature can be learnt from again", () => {
  const screen = new SurrogateScreen(3, 2);
  const population = buildCandidates(5);
  population.forEach((creature, i) => screen.observe(creature, i));
  assertEquals(screen.trainingSize, 3);
  // population[0] was evicted, so it is learnable again.
  screen.observe(population[0], 42);
  assertEquals(screen.trainingSize, 3);
});

Deno.test("offspring screen — reset clears everything learnt", () => {
  const screen = new SurrogateScreen(32, 3);
  buildCandidates(4).forEach((creature, i) => screen.observe(creature, i));
  assert(screen.ready());
  screen.reset();
  assertEquals(screen.ready(), false);
  assertEquals(screen.trainingSize, 0);
});

Deno.test("offspring screen — the factory builds what the configuration names", () => {
  assertEquals(
    createOffspringScreen(resolvePreSelectionConfig()),
    undefined,
  );
  const surrogate = createOffspringScreen(
    resolvePreSelectionConfig({ ratio: 3, screen: "surrogate" }),
  );
  assertEquals(surrogate?.name, "surrogate");
  const sampled = createOffspringScreen(
    resolvePreSelectionConfig({ ratio: 3, screen: "sampled" }),
    () => Promise.resolve([]),
  );
  assertEquals(sampled?.name, "sampled");
});

Deno.test("offspring screen — the factory refuses a sampled screen with nothing behind it", () => {
  const error = assertThrows(
    () =>
      createOffspringScreen(
        resolvePreSelectionConfig({ ratio: 3, screen: "sampled" }),
      ),
    PreSelectionError,
  );
  assertEquals(error.reason, "NO_SCREEN_EVALUATOR");
});
