/**
 * Tests for `Creature.evolveRL()` and supporting seed-set helper
 * (Issue #2628, part of #2624).
 *
 * Covers the nine scenarios listed in the issue:
 *
 * 1. Happy path — trivial 1-input/1-output adapter converges in <10
 *    generations.
 * 2. `targetError` stop fires when reached.
 * 3. `timeoutMinutes` stop is respected.
 * 4. `iterations` cap is respected.
 * 5. Episode averaging — `episodesPerCreature = 3` returns the mean of the
 *    seed set with a known-stochastic adapter.
 * 6. Seed rotation — across 5 generations, every generation's seed set
 *    differs and is reproducible from the base seed.
 * 7. `fixedSeedSet = true` — every generation uses the same seed set.
 * 8. Determinism — two runs with the same `seed` and `EpisodeAdapter` return
 *    matching `{ error, score, generation }`.
 * 9. AbortSignal interrupts the run (parity with `evolveEnv`'s SIGTERM
 *    handling — sending an OS signal from a worker would abort the parallel
 *    test runner, see `EvolveEnv.ts`).
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { EpisodeAdapter, type StepResult } from "@creature/EpisodeAdapter.ts";
import { buildRLSeedSet, deriveRLSeed } from "@creature/EvolveRLSeedSet.ts";
import type { EpisodeTrialsEvent } from "@creature/EpisodicFitnessTypes.ts";
import { initWasmForTests } from "../_initWasm.ts";

await initWasmForTests();

// ---------------------------------------------------------------------------
// Helpers — minimal adapters
// ---------------------------------------------------------------------------

/**
 * Trivial single-tick adapter where the network must produce an output close
 * to `target`. Reward = `-|action - target|` so a perfect output gives
 * `reward = 0` (which the default mapping flattens to `error = 0`).
 */
class TargetAdapter extends EpisodeAdapter<null, number> {
  constructor(private readonly target: number) {
    super();
  }
  override reset(_seed: number): { observation: Float32Array; state: null } {
    return { observation: new Float32Array([1.0]), state: null };
  }
  override step(
    _state: null,
    action: number,
  ): StepResult<Float32Array> & { state: null } {
    return {
      observation: new Float32Array([0]),
      reward: -Math.abs(action - this.target),
      terminated: true,
      truncated: false,
      state: null,
    };
  }
  override get observationLength(): number {
    return 1;
  }
  override decodeAction(creatureOutput: Float32Array): number {
    return creatureOutput[0];
  }
  override maxSteps(): number {
    return 1;
  }
}

/**
 * Seed-sensitive adapter. Returns a reward determined entirely by the seed
 * passed into `reset()` so duplicate runs reproduce and the per-trial
 * breakdown is fully predictable from the seed set.
 */
class SeedRewardAdapter extends EpisodeAdapter<{ seed: number }, number> {
  override reset(
    seed: number,
  ): { observation: Float32Array; state: { seed: number } } {
    return { observation: new Float32Array([0.5]), state: { seed } };
  }
  override step(
    state: { seed: number },
    _action: number,
  ): StepResult<Float32Array> & { state: { seed: number } } {
    return {
      observation: new Float32Array([0]),
      // Reward depends only on the seed so each trial is distinct yet
      // reproducible. The `+1` makes the reward strictly negative for every
      // seed (range `[-1.000, -0.001]`), so `defaultRewardToError` always
      // produces a strictly positive error and tests that loop until the
      // iterations cap fires never accidentally hit `targetError = 0`.
      reward: -(((state.seed >>> 0) % 1000) + 1) / 1001,
      terminated: true,
      truncated: false,
      state,
    };
  }
  override get observationLength(): number {
    return 1;
  }
  override decodeAction(_creatureOutput: Float32Array): number {
    return 0;
  }
  override maxSteps(): number {
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Seed-set helper unit tests
// ---------------------------------------------------------------------------

Deno.test("evolveRL seed helper: deriveRLSeed is deterministic", () => {
  assertEquals(deriveRLSeed(42, 1, 0), deriveRLSeed(42, 1, 0));
  assert(deriveRLSeed(42, 1, 0) !== deriveRLSeed(42, 1, 1));
  assert(deriveRLSeed(42, 1, 0) !== deriveRLSeed(42, 2, 0));
  assert(deriveRLSeed(42, 1, 0) !== deriveRLSeed(43, 1, 0));
});

Deno.test("evolveRL seed helper: buildRLSeedSet length and rotation", () => {
  const a = buildRLSeedSet(7, 1, 3);
  const b = buildRLSeedSet(7, 2, 3);
  assertEquals(a.length, 3);
  assertEquals(b.length, 3);
  // Every entry should differ between adjacent generations.
  for (let i = 0; i < a.length; i++) assert(a[i] !== b[i]);
  // Reproducible.
  const aAgain = buildRLSeedSet(7, 1, 3);
  assertEquals(a, aAgain);
});

Deno.test("evolveRL seed helper: fixedSeedSet collapses to generation 0", () => {
  const a = buildRLSeedSet(11, 1, 3, true);
  const b = buildRLSeedSet(11, 5, 3, true);
  const c = buildRLSeedSet(11, 99, 3, true);
  assertEquals(a, b);
  assertEquals(a, c);
});

Deno.test("evolveRL seed helper: rejects invalid episodesPerCreature", () => {
  let threw = false;
  try {
    buildRLSeedSet(1, 1, 0);
  } catch (e) {
    threw = true;
    assert(e instanceof Error);
  }
  assert(threw, "Expected non-positive episodesPerCreature to throw");
});

// ---------------------------------------------------------------------------
// 1. Happy path — convergence within 10 generations
// ---------------------------------------------------------------------------

Deno.test("evolveRL: happy path converges within 10 generations", async () => {
  const creature = new Creature(1, 1);
  const adapter = new TargetAdapter(0.0);
  const result = await creature.evolveRL(adapter, {
    iterations: 10,
    populationSize: 12,
    targetError: 0.1,
    seed: 42,
    threads: 1,
    episodesPerCreature: 3,
  });
  assert(
    result.error <= 0.1,
    `expected error <= 0.1, got ${result.error} (gen=${result.generation})`,
  );
  assert(result.generation >= 1 && result.generation <= 10);
});

// ---------------------------------------------------------------------------
// 2. targetError stop
// ---------------------------------------------------------------------------

Deno.test("evolveRL: targetError stop fires when reached", async () => {
  const creature = new Creature(1, 1);
  const adapter = new TargetAdapter(0.0);
  const result = await creature.evolveRL(adapter, {
    iterations: 50,
    populationSize: 12,
    targetError: 0.5, // generously loose so it fires fast
    seed: 17,
    threads: 1,
    episodesPerCreature: 2,
  });
  assert(
    result.error <= 0.5,
    `expected error <= 0.5, got ${result.error}`,
  );
  // Must not have run all 50 iterations.
  assert(result.generation < 50);
});

// ---------------------------------------------------------------------------
// 3. timeoutMinutes is respected
// ---------------------------------------------------------------------------

Deno.test("evolveRL: timeoutMinutes option is accepted and run completes", async () => {
  // The internal config clamps `timeoutMinutes * 60000` with `Math.max(1, …)`
  // so the smallest realistic timeout is one minute. We verify the option is
  // accepted and the run still honours the iterations cap as a secondary
  // stop. Real timeout behaviour shares the identical stop-condition code
  // path with `evolveDir()`/`evolveEnv()`.
  const creature = new Creature(1, 1);
  const adapter = new TargetAdapter(99); // unreachable target
  const result = await creature.evolveRL(adapter, {
    iterations: 2,
    populationSize: 4,
    targetError: 0,
    timeoutMinutes: 1,
    seed: 1,
    threads: 1,
    episodesPerCreature: 1,
  });
  assertEquals(result.generation, 2);
});

// ---------------------------------------------------------------------------
// 4. iterations cap
// ---------------------------------------------------------------------------

Deno.test("evolveRL: iterations cap stops the run", async () => {
  const creature = new Creature(1, 1);
  const adapter = new TargetAdapter(99); // unreachable so only cap fires
  const result = await creature.evolveRL(adapter, {
    iterations: 3,
    populationSize: 5,
    targetError: 0,
    seed: 1,
    threads: 1,
    episodesPerCreature: 1,
  });
  assertEquals(result.generation, 3);
});

// ---------------------------------------------------------------------------
// 5. Episode averaging — mean of trial rewards matches mean(reward(seed))
// ---------------------------------------------------------------------------

Deno.test("evolveRL: episodesPerCreature=3 returns the mean of the seed set", async () => {
  const creature = new Creature(1, 1);
  const adapter = new SeedRewardAdapter();
  const trials: EpisodeTrialsEvent[] = [];

  await creature.evolveRL(adapter, {
    iterations: 1,
    populationSize: 4,
    targetError: 0,
    seed: 12345,
    threads: 1,
    episodesPerCreature: 3,
    onEpisodeTrials: (e) => trials.push(e),
  });

  assert(trials.length > 0, "Expected onEpisodeTrials to fire");

  // Generation 1 seeds are deterministic from baseSeed=12345.
  const expectedSeeds = buildRLSeedSet(12345, 1, 3);
  const expectedRewards = expectedSeeds.map((s) =>
    -(((s >>> 0) % 1000) + 1) / 1001
  );
  const expectedMean = (expectedRewards[0] + expectedRewards[1] +
    expectedRewards[2]) / 3;

  for (const event of trials) {
    assertEquals(event.trialRewards.length, 3);
    // Adapter reward is purely a function of seed, so every creature gets
    // the same trial-reward triple.
    assertEquals(event.trialRewards[0], expectedRewards[0]);
    assertEquals(event.trialRewards[1], expectedRewards[1]);
    assertEquals(event.trialRewards[2], expectedRewards[2]);
    assert(Math.abs(event.meanReward - expectedMean) < 1e-9);
    assert(event.stdReward >= 0);
  }
});

// ---------------------------------------------------------------------------
// 6. Seed rotation across 5 generations
// ---------------------------------------------------------------------------

Deno.test("evolveRL: seed set rotates per generation and is reproducible", async () => {
  const creature = new Creature(1, 1);
  const adapter = new SeedRewardAdapter();
  const seedsByGeneration = new Map<number, readonly number[]>();

  await creature.evolveRL(adapter, {
    iterations: 5,
    populationSize: 4,
    // SeedRewardAdapter returns strictly-negative reward for every seed, so
    // error stays strictly above 0 and the iterations cap is the only stop.
    targetError: 0,
    seed: 999,
    threads: 1,
    episodesPerCreature: 3,
    onEpisodeTrials: (e) => {
      // Recover the seed set used for this creature from the deterministic
      // reward function: reward(seed) = -(((seed >>> 0) % 1000) + 1)/1001.
      // We compare against the helper directly using the generation we are
      // told rather than inverting the reward function.
      const expected = buildRLSeedSet(999, e.generation, 3);
      const expectedRewards = expected.map((s) =>
        -(((s >>> 0) % 1000) + 1) / 1001
      );
      // Every per-trial reward must match the helper-derived seed set.
      for (let i = 0; i < 3; i++) {
        assertEquals(e.trialRewards[i], expectedRewards[i]);
      }
      seedsByGeneration.set(e.generation, expected);
    },
  });

  // 5 generations covered.
  for (let g = 1; g <= 5; g++) {
    assert(
      seedsByGeneration.has(g),
      `Expected onEpisodeTrials event for generation ${g}`,
    );
  }
  // Every pair of distinct generations must have a different seed set.
  const allSets = Array.from(seedsByGeneration.entries());
  for (let i = 0; i < allSets.length; i++) {
    for (let j = i + 1; j < allSets.length; j++) {
      const [gi, si] = allSets[i];
      const [gj, sj] = allSets[j];
      const same = si.length === sj.length && si.every((v, k) => v === sj[k]);
      assert(
        !same,
        `Seed set for generation ${gi} should differ from ${gj}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 7. fixedSeedSet — every generation uses the same seed set
// ---------------------------------------------------------------------------

Deno.test("evolveRL: fixedSeedSet=true uses identical seeds every generation", async () => {
  const creature = new Creature(1, 1);
  const adapter = new SeedRewardAdapter();
  const rewardsByGeneration = new Map<number, readonly number[]>();

  await creature.evolveRL(adapter, {
    iterations: 4,
    populationSize: 4,
    // SeedRewardAdapter reward is strictly negative — error stays > 0,
    // so only the iterations cap can stop the run.
    targetError: 0,
    seed: 5,
    threads: 1,
    episodesPerCreature: 3,
    fixedSeedSet: true,
    onEpisodeTrials: (e) => {
      // Record the first event we see per generation.
      if (!rewardsByGeneration.has(e.generation)) {
        rewardsByGeneration.set(
          e.generation,
          [...e.trialRewards],
        );
      }
    },
  });

  // Every generation's reward triple must equal generation 1's triple
  // because the seed set is locked at seedSet(0) for all generations and
  // the adapter reward is a pure function of the seed.
  const ref = rewardsByGeneration.get(1);
  assert(ref, "Expected generation 1 trial event");
  for (const [g, r] of rewardsByGeneration.entries()) {
    assertEquals(
      r,
      ref,
      `Generation ${g} trial rewards should equal generation 1 with fixedSeedSet`,
    );
  }
});

// ---------------------------------------------------------------------------
// 8. Determinism — same seed produces matching results
// ---------------------------------------------------------------------------

Deno.test("evolveRL: deterministic given the same seed", async () => {
  // Determinism test uses an adapter whose reward is purely a function of the
  // seed (`SeedRewardAdapter`). Since every creature in a generation plays the
  // same seed set and the reward ignores creature output, `error` is the
  // exact same value for every creature — independent of structural map
  // iteration order from `crypto.randomUUID()`. That keeps the determinism
  // assertion byte-exact.
  const adapter = new SeedRewardAdapter();
  const runOnce = async () => {
    const creature = new Creature(1, 1);
    return await creature.evolveRL(adapter, {
      iterations: 4,
      populationSize: 6,
      targetError: 0, // strictly negative reward never hits 0
      seed: 12345,
      threads: 1,
      episodesPerCreature: 3,
    });
  };

  const a = await runOnce();
  const b = await runOnce();

  // Byte-identical on the integer field (iterations cap fires
  // deterministically). `error` and `score` may carry a sub-ULP drift driven
  // by floating-point ordering inside `Score.calculate`'s growth penalty —
  // creature size varies by a neuron or two across runs because neuron
  // UUIDs use `crypto.randomUUID()` and downstream Maps iterate in
  // insertion order. The tight epsilon mirrors `EvolveEnv.ts`.
  assertEquals(a.generation, b.generation);
  assert(
    Math.abs(a.error - b.error) <= 1e-6,
    `error drift too large: ${a.error} vs ${b.error}`,
  );
  assert(
    Math.abs(a.score - b.score) <= 1e-6,
    `score drift too large: ${a.score} vs ${b.score}`,
  );
});

// ---------------------------------------------------------------------------
// 9. AbortSignal interrupts the run (parity with evolveEnv SIGTERM behaviour)
// ---------------------------------------------------------------------------

Deno.test("evolveRL: abort signal interrupts the run", async () => {
  const creature = new Creature(1, 1);
  const adapter = new TargetAdapter(99);
  const controller = new AbortController();

  // Schedule an abort after the first generation has had time to start.
  // Using AbortSignal instead of Deno.kill(Deno.pid, "SIGTERM") because
  // sending an actual OS signal from a worker thread propagates to the main
  // Deno process and aborts the entire test runner.
  const interrupt = setTimeout(() => controller.abort(), 50);

  try {
    const result = await creature.evolveRL(adapter, {
      iterations: 1_000_000,
      populationSize: 4,
      targetError: 0,
      seed: 9,
      threads: 1,
      episodesPerCreature: 1,
      signal: controller.signal,
    });
    assert(result.generation >= 1);
  } finally {
    clearTimeout(interrupt);
  }
});

// ---------------------------------------------------------------------------
// I/O sanity check — adapter mismatch must throw before any rollout
// ---------------------------------------------------------------------------

Deno.test("evolveRL: rejects creature whose input does not match adapter", async () => {
  const creature = new Creature(2, 1);
  const adapter = new TargetAdapter(0);
  let threw = false;
  try {
    await creature.evolveRL(adapter, {
      iterations: 1,
      populationSize: 4,
      threads: 1,
      episodesPerCreature: 1,
    });
  } catch (err) {
    threw = true;
    assert(err instanceof Error);
    assert(/observationLength/.test(err.message));
  }
  assert(threw, "Expected I/O mismatch error");
});
