/**
 * Tests for the parallel episode-rollout pool used by `Creature.evolveRL()`
 * (Issue #2612).
 *
 * Direct-execution mode (`direct: true` on the worker pool) keeps the suite
 * fast by reusing the in-process {@link MockEpisodeWorker} so we exercise
 * the same processor / handler / pool plumbing as a real `Worker`, without
 * paying for module download/spin-up time. The acceptance-criterion
 * speedup test lives in `bench/evolveRLParallel.bench.ts`.
 *
 * Coverage:
 *
 * 1. Pool init — adapter URL is loaded and adapter constructed once per worker.
 * 2. `runEpisodes` returns the per-trial outcome vector with terminated/truncated.
 * 3. Mixed termination — even-seed episodes `terminated`, odd-seed `truncated`,
 *    no deadlock, scores collected immediately.
 * 4. Determinism — `evolveRL` results match across `threads = 1` and
 *    `threads = 2` for the same seed.
 * 5. Per-creature averaging — `episodesPerCreature = 3` returns mean of seeds.
 * 6. Seed rotation — second generation seeds differ from the first.
 * 7. Worker-init-failure fallback — bad adapter URL raises clearly.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { EpisodeWorkerPool } from "@creature/EpisodeWorkerPool.ts";
import { buildRLSeedSet } from "@creature/EvolveRLSeedSet.ts";
import type { EpisodeTrialsEvent } from "@creature/EpisodicFitnessTypes.ts";
import { initWasmForTests } from "../_initWasm.ts";

await initWasmForTests();

const SEED_REWARD_FIXTURE_URL = new URL(
  "./fixtures/SeedRewardAdapterFixture.ts",
  import.meta.url,
).href;

const MIXED_TERMINATION_FIXTURE_URL = new URL(
  "./fixtures/MixedTerminationAdapterFixture.ts",
  import.meta.url,
).href;

// ---------------------------------------------------------------------------
// 1. Pool init — adapter URL is loaded successfully
// ---------------------------------------------------------------------------

Deno.test("EpisodeWorkerPool: initialises from adapter URL", async () => {
  const pool = await EpisodeWorkerPool.create({
    adapter: { url: SEED_REWARD_FIXTURE_URL },
    threads: 2,
    direct: true,
  });
  try {
    assertEquals(pool.size, 2);
  } finally {
    pool.terminate();
  }
});

// ---------------------------------------------------------------------------
// 2. runEpisodes returns the per-trial outcome vector
// ---------------------------------------------------------------------------

Deno.test("EpisodeWorkerPool: runEpisodes returns per-trial outcomes", async () => {
  const pool = await EpisodeWorkerPool.create({
    adapter: { url: SEED_REWARD_FIXTURE_URL },
    threads: 2,
    direct: true,
  });
  try {
    const creature = new Creature(1, 1);
    const seedSet = buildRLSeedSet(7, 1, 3);
    const outcomes = await pool.runEpisodes(creature, seedSet);
    assertEquals(outcomes.length, 3);
    for (let i = 0; i < 3; i++) {
      assertEquals(outcomes[i].seed, seedSet[i]);
      assert(outcomes[i].terminated);
      assert(!outcomes[i].truncated);
      const expected = -(((seedSet[i] >>> 0) % 1000) + 1) / 1001;
      assertEquals(outcomes[i].reward, expected);
    }
  } finally {
    pool.terminate();
  }
});

// ---------------------------------------------------------------------------
// 3. Mixed termination — even seeds terminated, odd seeds truncated
// ---------------------------------------------------------------------------

Deno.test("EpisodeWorkerPool: mixed terminated + truncated signals collected", async () => {
  const pool = await EpisodeWorkerPool.create({
    adapter: { url: MIXED_TERMINATION_FIXTURE_URL },
    threads: 2,
    direct: true,
  });
  try {
    // Hand-pick seeds with mixed parity so we get one of each.
    const seedSet = [2, 3, 4, 5];
    const creature = new Creature(1, 1);
    const outcomes = await pool.runEpisodes(creature, seedSet);
    assertEquals(outcomes.length, 4);
    // Even seeds terminate at tick 1; odd seeds run to maxSteps = 4.
    assert(outcomes[0].terminated && !outcomes[0].truncated);
    assert(!outcomes[1].terminated && outcomes[1].truncated);
    assert(outcomes[2].terminated && !outcomes[2].truncated);
    assert(!outcomes[3].terminated && outcomes[3].truncated);
    // Even-seed episodes step exactly once; odd-seed episodes step maxSteps times.
    assertEquals(outcomes[0].steps, 1);
    assertEquals(outcomes[1].steps, 4);
    assertEquals(outcomes[2].steps, 1);
    assertEquals(outcomes[3].steps, 4);
  } finally {
    pool.terminate();
  }
});

// ---------------------------------------------------------------------------
// 4. Determinism across thread counts
// ---------------------------------------------------------------------------

Deno.test("evolveRL: deterministic across threads = 1 and threads = 2", async () => {
  // Use a fresh creature per run so structural state is identical at start.
  const runWithThreads = async (threads: number) => {
    const creature = new Creature(1, 1);
    const adapter = (await import(SEED_REWARD_FIXTURE_URL)).default;
    const adapterInstance = new adapter();
    return await creature.evolveRL(adapterInstance, {
      iterations: 3,
      populationSize: 4,
      targetError: 0,
      seed: 12345,
      threads,
      episodesPerCreature: 3,
      // Pool is constructed when threads > 1 + adapterDescription is set.
      adapterDescription: { url: SEED_REWARD_FIXTURE_URL, direct: true },
      // Force direct execution to keep the test fast and avoid module
      // download in CI.
      // (The pool itself respects this via EpisodeWorkerPool.create.)
    });
  };

  const a = await runWithThreads(1);
  const b = await runWithThreads(2);

  assertEquals(a.generation, b.generation);
  // Tight epsilon — same seed set, same reward function, same scoring.
  assert(
    Math.abs(a.error - b.error) <= 1e-6,
    `error drift across thread counts: ${a.error} vs ${b.error}`,
  );
  assert(
    Math.abs(a.score - b.score) <= 1e-6,
    `score drift across thread counts: ${a.score} vs ${b.score}`,
  );
});

// ---------------------------------------------------------------------------
// 5. Per-creature averaging
// ---------------------------------------------------------------------------

Deno.test("evolveRL parallel: episodesPerCreature=3 returns the mean of the seed set", async () => {
  const adapter = (await import(SEED_REWARD_FIXTURE_URL)).default;
  const adapterInstance = new adapter();
  const creature = new Creature(1, 1);
  const trials: EpisodeTrialsEvent[] = [];
  // Re-initialise WASM after the previous test's MemoryMonitor critical
  // response cleared the compilation cache.
  await initWasmForTests();
  await creature.evolveRL(adapterInstance, {
    iterations: 1,
    populationSize: 4,
    targetError: 0,
    seed: 12345,
    threads: 2,
    episodesPerCreature: 3,
    adapterDescription: { url: SEED_REWARD_FIXTURE_URL, direct: true },
    onEpisodeTrials: (e) => trials.push(e),
  });

  assert(trials.length > 0, "Expected onEpisodeTrials to fire");
  const expectedSeeds = buildRLSeedSet(12345, 1, 3);
  const expectedRewards = expectedSeeds.map((s) =>
    -(((s >>> 0) % 1000) + 1) / 1001
  );
  const expectedMean =
    (expectedRewards[0] + expectedRewards[1] + expectedRewards[2]) / 3;
  for (const event of trials) {
    assertEquals(event.trialRewards.length, 3);
    assertEquals(event.trialRewards[0], expectedRewards[0]);
    assertEquals(event.trialRewards[1], expectedRewards[1]);
    assertEquals(event.trialRewards[2], expectedRewards[2]);
    assert(Math.abs(event.meanReward - expectedMean) < 1e-9);
  }
});

// ---------------------------------------------------------------------------
// 6. Seed rotation under parallel execution
// ---------------------------------------------------------------------------

Deno.test("evolveRL parallel: seed set rotates per generation", async () => {
  const adapter = (await import(SEED_REWARD_FIXTURE_URL)).default;
  const adapterInstance = new adapter();
  const creature = new Creature(1, 1);
  const trialsByGeneration = new Map<number, readonly number[]>();
  await creature.evolveRL(adapterInstance, {
    iterations: 3,
    populationSize: 3,
    targetError: 0,
    seed: 999,
    threads: 2,
    episodesPerCreature: 3,
    adapterDescription: { url: SEED_REWARD_FIXTURE_URL, direct: true },
    onEpisodeTrials: (e) => {
      if (!trialsByGeneration.has(e.generation)) {
        trialsByGeneration.set(e.generation, [...e.trialRewards]);
      }
    },
  });
  for (let g = 1; g <= 3; g++) {
    assert(trialsByGeneration.has(g), `Expected event for generation ${g}`);
  }
  const all = Array.from(trialsByGeneration.entries());
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [gi, ri] = all[i];
      const [gj, rj] = all[j];
      const same = ri.length === rj.length && ri.every((v, k) => v === rj[k]);
      assert(
        !same,
        `Reward triple for generation ${gi} should differ from ${gj}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 7. Throughput payload still emitted on generation_complete with a pool
// ---------------------------------------------------------------------------

Deno.test("evolveRL parallel: emits generation_complete throughput", async () => {
  const adapter = (await import(SEED_REWARD_FIXTURE_URL)).default;
  const adapterInstance = new adapter();
  const creature = new Creature(1, 1);
  let sawThroughput = false;
  let generations = 0;
  await creature.evolveRL(adapterInstance, {
    iterations: 2,
    populationSize: 4,
    targetError: 0,
    seed: 42,
    threads: 2,
    episodesPerCreature: 2,
    adapterDescription: { url: SEED_REWARD_FIXTURE_URL, direct: true },
    onTrainingEvent: (event) => {
      if (event.kind === "generation_complete") {
        generations++;
        if (event.throughput !== undefined) {
          sawThroughput = true;
        }
      }
    },
  });
  assert(generations >= 1, "Expected at least one generation_complete event");
  assert(sawThroughput, "Expected throughput payload on generation_complete");
});

// ---------------------------------------------------------------------------
// 8. Worker-init-failure surfaces clearly
// ---------------------------------------------------------------------------

Deno.test("EpisodeWorkerPool: bad adapter URL surfaces an init error", async () => {
  let threw = false;
  try {
    await EpisodeWorkerPool.create({
      adapter: { url: "file:///definitely/not/a/real/module.ts" },
      threads: 1,
      direct: true,
    });
  } catch (err) {
    threw = true;
    assert(err instanceof Error);
  }
  assert(threw, "Expected pool creation to throw on missing adapter module");
});
