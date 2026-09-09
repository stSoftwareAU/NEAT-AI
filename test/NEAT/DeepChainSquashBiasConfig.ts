/**
 * Issue #3974: the depth-aware squash bias reaches `ModSquash` through the run
 * config, and its default of `0` leaves the operator drawing from the
 * historical pool.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import type { Creature } from "@creature";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { isGradientBlockingSquash } from "@methods/activations/GradientBlocking.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../_rngTestLock.ts";
import { chainCreature } from "../mutate/_chainCreature.ts";

/**
 * Squash-mutate a fresh six-member run `draws` times through the `Mutator`,
 * and count how many of the squashes it settled on block the gradient.
 */
function blockingProposals(
  overrides: Record<string, unknown>,
  draws: number,
  seed: number,
): { blocking: number; total: number } {
  const config = createNeatConfig({
    populationSize: 10,
    mutation: Mutation.ALL,
    // Issue #2457's tracker is left at its default; it has no samples in this
    // probe, so every draw falls through to the uniform pool.
    ...overrides,
  });
  const mutator = new Mutator(config);

  setRandomNumberGenerator(createSeededRng(seed));
  let blocking = 0;
  let total = 0;
  for (let i = 0; i < draws; i++) {
    const creature: Creature = chainCreature(6);
    const before = creature.neurons.map((n) => n.squash);
    if (!mutator.mutateCreature(creature, Mutation.MOD_SQUASH)) continue;
    for (let n = 0; n < creature.neurons.length; n++) {
      const squash = creature.neurons[n].squash;
      if (squash === undefined || squash === before[n]) continue;
      total++;
      if (isGradientBlockingSquash(squash)) blocking++;
    }
  }
  return { blocking, total };
}

Deno.test("deepChainSquashBias - the config defaults leave the bias off", () => {
  const config = createNeatConfig({ populationSize: 10 });
  assertEquals(config.deepChainSquashBias, 0);
  assertEquals(config.deepChainMinLength, 4);
});

Deno.test("deepChainSquashBias - out-of-range values fail loud", () => {
  assertThrows(
    () => createNeatConfig({ populationSize: 10, deepChainSquashBias: 1.5 }),
    ConfigurationError,
  );
  assertThrows(
    () => createNeatConfig({ populationSize: 10, deepChainMinLength: 1 }),
    ConfigurationError,
  );
  assertThrows(
    () => createNeatConfig({ populationSize: 10, deepChainMinLength: 2.5 }),
    ConfigurationError,
  );
});

Deno.test("deepChainSquashBias - the config knob changes what ModSquash proposes", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      const off = blockingProposals({}, 300, 3974);
      const on = blockingProposals({ deepChainSquashBias: 1 }, 300, 3974);
      assert(off.blocking > 0, "the unbiased pool proposes blocking squashes");
      assert(
        on.blocking < off.blocking,
        `the bias should reach the operator: ${on.blocking} of ${on.total} ` +
          `against ${off.blocking} of ${off.total}`,
      );
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});
