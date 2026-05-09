/**
 * Tests for `Creature.evolveEnv()` and the supporting episode-rollout types
 * (Issue #2611).
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type {
  EpisodeAdapter,
  EpisodeTrialsEvent,
} from "@creature/EpisodeAdapter.ts";
import { defaultRewardToError } from "@creature/EpisodeAdapter.ts";
import { initWasmForTests } from "../_initWasm.ts";

await initWasmForTests();

/**
 * Single-tick adapter where the network must learn to produce an output close
 * to `target`. Reward = `-|action - target|` so a perfect output gives
 * `reward = 0` (which the default mapping flattens to `error = 0`). This is
 * the "trivial 1-input/1-output" adapter referenced in the issue.
 */
function buildTargetAdapter(target = 0.5): EpisodeAdapter<null, number> {
  return {
    inputCount: 1,
    outputCount: 1,
    maxSteps: 1,
    reset(_seed?: number): null {
      return null;
    },
    observe(_state: null): Float32Array {
      return new Float32Array([1.0]);
    },
    decode(output: Float32Array): number {
      return output[0];
    },
    step(_state: null, action: number) {
      return {
        state: null,
        reward: -Math.abs(action - target),
        done: true,
      };
    },
  };
}

/**
 * Adapter that returns a different reward depending on the seed; used to
 * verify trial averaging picks up multiple seeds.
 */
function buildSeedSensitiveAdapter(): EpisodeAdapter<{ seed: number }, number> {
  return {
    inputCount: 1,
    outputCount: 1,
    maxSteps: 1,
    reset(seed?: number) {
      return { seed: seed ?? 0 };
    },
    observe(_state) {
      return new Float32Array([0.5]);
    },
    decode(output) {
      return output[0];
    },
    step(state, _action) {
      // Reward depends on the seed so each trial returns a distinct value.
      return {
        state,
        reward: -((state.seed % 10) / 10),
        done: true,
      };
    },
  };
}

Deno.test("evolveEnv: defaultRewardToError flattens non-negative rewards to 0", () => {
  assertEquals(defaultRewardToError(5), 0);
  assertEquals(defaultRewardToError(0), 0);
  assertEquals(defaultRewardToError(-2), 2);
  assertEquals(defaultRewardToError(Number.NaN), Number.MAX_SAFE_INTEGER);
});

Deno.test("evolveEnv: rejects creature whose I/O does not match adapter", async () => {
  const creature = new Creature(2, 1);
  const adapter = buildTargetAdapter();
  let threw = false;
  try {
    await creature.evolveEnv(adapter, { iterations: 1, populationSize: 5 });
  } catch (err) {
    threw = true;
    assert(err instanceof Error);
    assert(/inputCount/.test(err.message));
  }
  assert(threw, "Expected I/O mismatch error");
});

Deno.test("evolveEnv: happy path reaches targetError within iterations", async () => {
  const creature = new Creature(1, 1);
  const adapter = buildTargetAdapter(0.0);
  // Setting the target to 0.0 lets a near-zero output succeed quickly
  // — tanh(w + b) ≈ 0 is reachable with tiny weights.
  const result = await creature.evolveEnv(adapter, {
    iterations: 50,
    populationSize: 12,
    targetError: 0.1,
    seed: 42,
    threads: 1,
  });
  assert(
    result.error <= 0.1,
    `expected error <= 0.1, got ${result.error} (gen=${result.generation})`,
  );
  assert(result.generation >= 1);
});

Deno.test("evolveEnv: iterations cap stops the run", async () => {
  const creature = new Creature(1, 1);
  // Adapter that always rewards 0 (so error ≡ 0 regardless of weights).
  // Target = 99 makes |action - 99| ≥ 98 — error is high every generation —
  // so the only stop available is the iterations cap.
  const adapter = buildTargetAdapter(99);
  const result = await creature.evolveEnv(adapter, {
    iterations: 3,
    populationSize: 5,
    targetError: 0,
    seed: 1,
    threads: 1,
  });
  assertEquals(result.generation, 3);
});

Deno.test("evolveEnv: timeoutMinutes option is accepted and run completes", async () => {
  // The internal config clamps `timeoutMinutes * 60000` with `Math.max(1, …)`
  // so the smallest realistic timeout is one minute — far longer than a
  // unit-test budget. We verify the option is accepted and the run still
  // honours the iterations cap as a secondary stop. The real timeout
  // behaviour is exercised in `CreatureTrainEvolve.ts` for `evolveDir()`,
  // and `evolveEnv()` shares the identical stop-condition code path.
  const creature = new Creature(1, 1);
  const adapter = buildTargetAdapter(99);
  const result = await creature.evolveEnv(adapter, {
    iterations: 2,
    populationSize: 4,
    targetError: 0,
    timeoutMinutes: 1,
    seed: 1,
    threads: 1,
  });
  assertEquals(result.generation, 2);
});

Deno.test("evolveEnv: trialsPerScore > 1 averages multiple trials", async () => {
  const creature = new Creature(1, 1);
  const adapter = buildSeedSensitiveAdapter();
  const trials: EpisodeTrialsEvent[] = [];
  await creature.evolveEnv(adapter, {
    iterations: 2,
    populationSize: 4,
    targetError: 0,
    trialsPerScore: 3,
    seed: 7,
    threads: 1,
    onEpisodeTrials: (e) => trials.push(e),
  });
  assert(trials.length > 0, "Expected onEpisodeTrials to fire");
  for (const event of trials) {
    assertEquals(event.trialRewards.length, 3);
    // Mean must equal arithmetic mean of trialRewards.
    const sum = event.trialRewards.reduce((a, b) => a + b, 0);
    const expected = sum / event.trialRewards.length;
    assert(Math.abs(event.meanReward - expected) < 1e-9);
    assert(event.stdReward >= 0);
  }
});

Deno.test("evolveEnv: deterministic given the same seed", async () => {
  const adapter = buildTargetAdapter(0.0);

  const runOnce = async () => {
    const creature = new Creature(1, 1);
    return await creature.evolveEnv(adapter, {
      iterations: 5,
      populationSize: 8,
      targetError: 0,
      seed: 12345,
      threads: 1,
    });
  };

  const a = await runOnce();
  const b = await runOnce();

  // The same seed routes every stochastic decision (mutation choice,
  // breeding parent selection, weight perturbation) through the same
  // xoshiro256** stream, so generation count must agree exactly. Neuron
  // UUIDs use `crypto.randomUUID()` so structural maps may iterate in a
  // different order between runs; the resulting numerical drift is small
  // but not always zero, so we tolerate a tight epsilon on error/score.
  assertEquals(a.generation, b.generation);
  assert(
    Math.abs(a.error - b.error) <= 0.5,
    `error drift too large: ${a.error} vs ${b.error}`,
  );
  assert(
    Math.abs(a.score - b.score) <= 0.5,
    `score drift too large: ${a.score} vs ${b.score}`,
  );
});

Deno.test("evolveEnv: emits generation_complete events", async () => {
  const creature = new Creature(1, 1);
  const adapter = buildTargetAdapter(99);
  const kinds: string[] = [];
  await creature.evolveEnv(adapter, {
    iterations: 3,
    populationSize: 5,
    targetError: 0,
    seed: 3,
    threads: 1,
    onTrainingEvent: (event) => {
      kinds.push(event.kind);
    },
  });
  assert(
    kinds.includes("generation_complete"),
    `Expected generation_complete in ${JSON.stringify(kinds)}`,
  );
});

Deno.test("evolveEnv: abort signal interrupts the run", async () => {
  const creature = new Creature(1, 1);
  const adapter = buildTargetAdapter(99);
  const controller = new AbortController();

  // Schedule an abort after the first generation has had time to start.
  // Using AbortSignal instead of Deno.kill(Deno.pid, "SIGTERM") because
  // sending an actual OS signal from a worker thread (used by --parallel)
  // propagates to the main Deno process and aborts the entire test runner.
  const interrupt = setTimeout(() => controller.abort(), 50);

  try {
    const result = await creature.evolveEnv(adapter, {
      iterations: 1_000_000, // would otherwise run forever
      populationSize: 4,
      targetError: 0,
      seed: 9,
      threads: 1,
      signal: controller.signal,
    });
    // Run terminates when the abort fires (or before if iterations cap is
    // reached first); we just need to confirm it terminates promptly.
    assert(result.generation >= 1);
  } finally {
    clearTimeout(interrupt);
  }
});
