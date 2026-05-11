/**
 * Issue #2630 — Verify the reinforcement-learning surface is re-exported from
 * the public entry point (`mod.ts`).
 *
 * The five symbols below are the contract NEAT-AI-Examples and any other
 * downstream consumer relies on. Importing them from the package root must
 * succeed (compile + runtime), otherwise consumers are forced back into
 * `src/...` paths that break across release boundaries.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  Creature,
  DEFAULT_MAX_STEPS,
  DEFAULT_WALL_CLOCK_MS,
  EpisodeAdapter,
  type EpisodeResult,
  type EvolveRLMilestone,
  type EvolveRLOptions,
  type StepResult,
} from "../mod.ts";

Deno.test("mod.ts re-exports EpisodeAdapter as a constructable abstract class", () => {
  // The base class is abstract; subclassing must work.
  class Trivial extends EpisodeAdapter<number, number> {
    observationLength = 1;
    reset() {
      return { observation: new Float32Array([0]), state: 0 };
    }
    step(state: number) {
      return {
        observation: new Float32Array([0]),
        state,
        reward: 0,
        terminated: true,
        truncated: false,
      };
    }
    decodeAction() {
      return 0;
    }
  }
  const adapter: EpisodeAdapter<number, number> = new Trivial();
  assertEquals(adapter.observationLength, 1);
  assertEquals(adapter.maxSteps(), DEFAULT_MAX_STEPS);
  assertEquals(adapter.wallClockMs(), DEFAULT_WALL_CLOCK_MS);
});

Deno.test("mod.ts re-exports StepResult, EpisodeResult, EvolveRLOptions, EvolveRLMilestone types", () => {
  // Compile-time only: assigning literals to the imported types must
  // type-check. The runtime assertion below pins the values so the test does
  // real work (rather than being a "how" test that inspects source text).
  const step: StepResult<Float32Array> = {
    observation: new Float32Array([1, 2]),
    reward: 0.5,
    terminated: false,
    truncated: false,
  };
  const ep: EpisodeResult = {
    returnValue: 1.5,
    steps: 10,
    terminated: true,
    truncated: false,
    elapsedMs: 12,
    seed: 7,
  };
  const opts: EvolveRLOptions = {
    iterations: 1,
    episodesPerCreature: 2,
    statistics: false,
  };
  const milestone: EvolveRLMilestone = {
    generation: 5,
    bestScore: 1.0,
    bestNeurons: 4,
    bestSynapses: 6,
    meanEpisodeSteps: 17.5,
    generationWallClockMs: 42,
  };
  assertEquals(step.reward, 0.5);
  assertEquals(ep.returnValue, 1.5);
  assertEquals(opts.episodesPerCreature, 2);
  assertEquals(milestone.bestScore, 1.0);
});

Deno.test("Creature exposes evolveRL accepting the re-exported EpisodeAdapter", () => {
  const c = new Creature(1, 1);
  // The method exists at the public entry point; we do not invoke it (the
  // full run is exercised by `test/creature/evolveRL_test.ts`).
  assertExists(c.evolveRL);
  assertEquals(typeof c.evolveRL, "function");
});
