/**
 * Issue #3974: `ModSquash`'s depth-aware bias.
 *
 * The operator's squash pool is blind to topology, so a gradient-blocking
 * activation is as likely inside a fan-out-1 serial run — where it zeroes the
 * gradient for every member upstream of it — as anywhere else. These tests
 * assert what the bias *does to the draw*: it down-weights blocking proposals
 * inside a long run, leaves everything else alone, and never removes an
 * activation from the pool.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import type { Creature } from "@creature";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { isGradientBlockingSquash } from "@methods/activations/GradientBlocking.ts";
import type { DeepChainSquashOptions } from "@mutate/DeepChainSquashOptions.ts";
import { resolveDeepChainSquashOptions } from "@mutate/DeepChainSquashOptions.ts";
import { ModActivation } from "@mutate/ModSquash.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../_rngTestLock.ts";
import { chainCreature } from "./_chainCreature.ts";

/**
 * Run `draws` squash mutations against a fresh copy of `build()` each time,
 * under a fixed seed, and return the squash each mutation settled on.
 */
function squashSequence(
  build: () => Creature,
  options: DeepChainSquashOptions | undefined,
  draws: number,
  seed: number,
): string[] {
  setRandomNumberGenerator(createSeededRng(seed));
  const chosen: string[] = [];
  for (let i = 0; i < draws; i++) {
    const creature = build();
    const before = creature.neurons.map((n) => n.squash);
    if (!new ModActivation(creature, undefined, options).mutate()) continue;
    for (let n = 0; n < creature.neurons.length; n++) {
      const squash = creature.neurons[n].squash;
      if (squash !== undefined && squash !== before[n]) chosen.push(squash);
    }
  }
  return chosen;
}

const blockingCount = (squashes: readonly string[]) =>
  squashes.filter((s) => isGradientBlockingSquash(s)).length;

/**
 * The same run, plus the next value the RNG hands out. A bias that consumed a
 * draw it should not have would leave the sequence intact and shift this.
 */
function sequenceAndRngTail(
  build: () => Creature,
  options: DeepChainSquashOptions | undefined,
  draws: number,
  seed: number,
): { chosen: string[]; tail: number } {
  const chosen = squashSequence(build, options, draws, seed);
  return { chosen, tail: getRandomNumberGenerator().random() };
}

Deno.test("DeepChainSquashBias - bias 0 draws exactly what the unbiased operator draws", async () => {
  await withRngTestLock(() => {
    const build = () => chainCreature(6);
    // The golden vector below was produced by the operator as it stood before
    // this issue (`git show HEAD~:src/mutate/ModSquash.ts`) under seed 3974,
    // so a bias of `0` — and an operator given no options at all — has to
    // reproduce it exactly, RNG stream included.
    const golden = [
      "HARD_TANH",
      "Swish",
      "TANH",
      "SOFTSIGN",
      "HARD_TANH",
      "ABSOLUTE",
      "SELU",
      "ArcTan",
      "SOFTSIGN",
      "Swish",
      "HARD_TANH",
      "LogSigmoid",
    ];
    // The RNG tail is the other half of the claim: the pre-#3974 operator left
    // the stream here after those twelve draws, so a bias that consumed a draw
    // it should not have would shift it even with the sequence intact.
    const goldenTail = 0.10698457942174755;

    const unset = sequenceAndRngTail(build, undefined, 12, 3974);
    assertEquals(unset.chosen, golden);
    assertEquals(unset.tail, goldenTail);

    const explicitZero = sequenceAndRngTail(
      build,
      { deepChainSquashBias: 0 },
      12,
      3974,
    );
    assertEquals(explicitZero.chosen, golden);
    assertEquals(explicitZero.tail, goldenTail);
  });
});

Deno.test("DeepChainSquashBias - the bias cuts blocking proposals inside a long run", async () => {
  await withRngTestLock(() => {
    const build = () => chainCreature(6);
    const draws = 400;
    const unbiased = squashSequence(build, undefined, draws, 3974);
    const biased = squashSequence(
      build,
      { deepChainSquashBias: 1 },
      draws,
      3974,
    );

    const before = blockingCount(unbiased);
    const after = blockingCount(biased);
    assert(before > 0, "the unbiased pool should propose blocking squashes");
    assert(
      after < before,
      `expected fewer blocking proposals under the bias, got ${after} of ` +
        `${biased.length} against ${before} of ${unbiased.length}`,
    );
  });
});

Deno.test("DeepChainSquashBias - it biases, it does not ban", async () => {
  await withRngTestLock(() => {
    // A blocking proposal is re-drawn once, so the chance of one landing is
    // its own probability squared — rare, not impossible, which is the whole
    // difference between a bias and a ban.
    const biased = squashSequence(
      () => chainCreature(6),
      { deepChainSquashBias: 1 },
      3000,
      3974,
    );
    assert(
      blockingCount(biased) > 0,
      "a blocking squash must still reach the pool — a ban would shrink the " +
        "search space in a way NEAT cannot recover from",
    );
  });
});

Deno.test("DeepChainSquashBias - a run shorter than deepChainMinLength is untouched", async () => {
  await withRngTestLock(() => {
    // Two hidden neurons plus the output the run feeds: three members, below
    // the default minimum of four.
    const build = () => chainCreature(2);
    assertEquals(
      squashSequence(build, { deepChainSquashBias: 1 }, 60, 17),
      squashSequence(build, undefined, 60, 17),
    );
  });
});

Deno.test("DeepChainSquashBias - deepChainMinLength lowers the bar", async () => {
  await withRngTestLock(() => {
    const build = () => chainCreature(2);
    const unbiased = squashSequence(build, undefined, 400, 17);
    const biased = squashSequence(
      build,
      { deepChainSquashBias: 1, deepChainMinLength: 3 },
      400,
      17,
    );
    assert(
      blockingCount(biased) < blockingCount(unbiased),
      "a minimum of three should bring the three-member run under the bias",
    );
  });
});

Deno.test("DeepChainSquashBias - a neuron outside any run keeps the unbiased draw", async () => {
  await withRngTestLock(() => {
    // Every hidden neuron sits at depth 1 beside five siblings, so no depth
    // level is single-occupancy and there is no run to be inside.
    const build = () => chainCreature(1, { extraWidth: 5 });
    assertEquals(
      squashSequence(build, { deepChainSquashBias: 1 }, 60, 99),
      squashSequence(build, undefined, 60, 99),
    );
  });
});

Deno.test("DeepChainSquashBias - options validate and default to disabled", () => {
  assertEquals(resolveDeepChainSquashOptions(), {
    deepChainSquashBias: 0,
    deepChainMinLength: 4,
  });
  assertEquals(resolveDeepChainSquashOptions({}), {
    deepChainSquashBias: 0,
    deepChainMinLength: 4,
  });
  assertThrows(
    () => resolveDeepChainSquashOptions({ deepChainSquashBias: -0.1 }),
    ConfigurationError,
    "between 0 and 1",
  );
  assertThrows(
    () => resolveDeepChainSquashOptions({ deepChainSquashBias: 1.5 }),
    ConfigurationError,
    "between 0 and 1",
  );
  assertThrows(
    () => resolveDeepChainSquashOptions({ deepChainSquashBias: NaN }),
    ConfigurationError,
    "finite",
  );
  assertThrows(
    () => resolveDeepChainSquashOptions({ deepChainMinLength: 2.5 }),
    ConfigurationError,
    "whole number",
  );
  assertThrows(
    () => resolveDeepChainSquashOptions({ deepChainMinLength: 1 }),
    ConfigurationError,
    "at least 2",
  );
});
