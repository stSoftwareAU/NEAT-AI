/**
 * Tests for the library-owned {@link runEpisode} runner introduced in
 * Issue #2627 (part of #2624).
 *
 * Covers the six scenarios listed in the issue:
 *
 * 1. Natural termination — adapter signals `terminated = true` after N steps.
 * 2. Max-steps truncation — adapter never sets `terminated`; runner caps it.
 * 3. Wall-clock truncation — adapter step takes 100 ms with a 500 ms cap;
 *    runner truncates between 5 and 7 steps. Uses a `performance.now()` shim
 *    to keep the unit test fast.
 * 4. Override caps — subclass with `maxSteps() = 10` truncates at 10.
 * 5. Determinism — same seed twice produces identical results.
 * 6. Reward accumulation — five `reward = 1` steps then `terminated = true`
 *    yields `returnValue = 5`.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { EpisodeAdapter, type StepResult } from "@creature/EpisodeAdapter.ts";
import { runEpisode } from "@creature/EpisodeRunner.ts";
import { initWasmForTests } from "../_initWasm.ts";

// ---------------------------------------------------------------------------
// Shared shim: replace `performance.now` with a virtual clock for tests that
// must measure wall-clock behaviour without sleeping for real seconds.
// ---------------------------------------------------------------------------

function withVirtualClock<T>(
  fn: (advance: (ms: number) => void) => T,
): T {
  const original = performance.now.bind(performance);
  let virtualMs = 0;
  performance.now = () => virtualMs;
  try {
    return fn((ms) => {
      virtualMs += ms;
    });
  } finally {
    performance.now = original;
  }
}

// ---------------------------------------------------------------------------
// Helpers — minimal creature with one input, one output. Activation does not
// matter for runner semantics; the runner forwards bytes between adapter and
// creature.
// ---------------------------------------------------------------------------

function makeCreature(inputs = 1, outputs = 1): Creature {
  return new Creature(inputs, outputs, {
    layers: [{ count: 2 }],
  });
}

// ---------------------------------------------------------------------------
// 1. Natural termination after 12 steps
// ---------------------------------------------------------------------------

class FixedLengthAdapter extends EpisodeAdapter<{ step: number }, number> {
  constructor(private readonly endAt: number, private readonly reward = 0) {
    super();
  }

  override reset(
    _rngSeed: number,
  ): { observation: Float32Array; state: { step: number } } {
    return { observation: new Float32Array([0]), state: { step: 0 } };
  }

  override step(
    state: { step: number },
    _action: number,
  ): StepResult<Float32Array> & { state: { step: number } } {
    const next = { step: state.step + 1 };
    return {
      observation: new Float32Array([next.step]),
      reward: this.reward,
      terminated: next.step >= this.endAt,
      truncated: false,
      state: next,
    };
  }

  override get observationLength(): number {
    return 1;
  }

  override decodeAction(_creatureOutput: Float32Array): number {
    return 0;
  }
}

Deno.test("runEpisode: natural termination after 12 steps", async () => {
  await initWasmForTests();
  const adapter = new FixedLengthAdapter(12);
  const creature = makeCreature();

  const result = await runEpisode(adapter, creature, 7);

  assertEquals(result.terminated, true);
  assertEquals(result.truncated, false);
  assertEquals(result.steps, 12);
  assertEquals(result.truncationReason, undefined);
  assertEquals(result.seed, 7);
  assert(result.elapsedMs >= 0);
});

// ---------------------------------------------------------------------------
// 2. Max-steps truncation with default guard (5000)
// ---------------------------------------------------------------------------

class NeverEndingAdapter extends EpisodeAdapter<null, number> {
  override reset(
    _rngSeed: number,
  ): { observation: Float32Array; state: null } {
    return { observation: new Float32Array([0]), state: null };
  }

  override step(
    _state: null,
    _action: number,
  ): StepResult<Float32Array> & { state: null } {
    return {
      observation: new Float32Array([0]),
      reward: 0,
      terminated: false,
      truncated: false,
      state: null,
    };
  }

  override get observationLength(): number {
    return 1;
  }

  override decodeAction(_creatureOutput: Float32Array): number {
    return 0;
  }
}

Deno.test("runEpisode: default maxSteps guard truncates at 5000", async () => {
  await initWasmForTests();
  const adapter = new NeverEndingAdapter();
  const creature = makeCreature();

  const result = await runEpisode(adapter, creature, 0);

  assertEquals(result.terminated, false);
  assertEquals(result.truncated, true);
  assertEquals(result.truncationReason, "maxSteps");
  assertEquals(result.steps, 5000);
});

// ---------------------------------------------------------------------------
// 3. Wall-clock truncation — uses the virtual-clock shim so the test does
//    not actually sleep for half a second.
// ---------------------------------------------------------------------------

class SlowAdapter extends EpisodeAdapter<null, number> {
  // Advances the shared virtual clock 100 ms per step.
  constructor(private readonly advance: (ms: number) => void) {
    super();
  }

  override reset(
    _rngSeed: number,
  ): { observation: Float32Array; state: null } {
    return { observation: new Float32Array([0]), state: null };
  }

  override step(
    _state: null,
    _action: number,
  ): StepResult<Float32Array> & { state: null } {
    this.advance(100);
    return {
      observation: new Float32Array([0]),
      reward: 0,
      terminated: false,
      truncated: false,
      state: null,
    };
  }

  override get observationLength(): number {
    return 1;
  }

  override decodeAction(_creatureOutput: Float32Array): number {
    return 0;
  }

  override wallClockMs(): number {
    return 500;
  }

  override maxSteps(): number {
    // Lift the steps cap so the wall-clock guard is the binding one.
    return 10_000;
  }
}

Deno.test("runEpisode: wall-clock truncation fires near the cap", async () => {
  await initWasmForTests();
  const creature = makeCreature();

  const result = await withVirtualClock((advance) => {
    const adapter = new SlowAdapter(advance);
    return runEpisode(adapter, creature, 0);
  });

  assertEquals(result.truncated, true);
  assertEquals(result.truncationReason, "wallClock");
  assertEquals(result.terminated, false);
  // Each step advances the virtual clock 100 ms; the 500 ms cap should fire
  // somewhere between steps 5 and 7 inclusive.
  assert(
    result.steps >= 5 && result.steps <= 7,
    `expected 5–7 steps, got ${result.steps}`,
  );
});

// ---------------------------------------------------------------------------
// 4. Override caps — subclass returning maxSteps() = 10
// ---------------------------------------------------------------------------

class TightStepsAdapter extends NeverEndingAdapter {
  override maxSteps(): number {
    return 10;
  }
}

Deno.test("runEpisode: subclass maxSteps override is honoured", async () => {
  await initWasmForTests();
  const adapter = new TightStepsAdapter();
  const creature = makeCreature();

  const result = await runEpisode(adapter, creature, 0);

  assertEquals(result.truncated, true);
  assertEquals(result.truncationReason, "maxSteps");
  assertEquals(result.steps, 10);
});

// ---------------------------------------------------------------------------
// 5. Determinism — same seed twice produces identical results
// ---------------------------------------------------------------------------

interface SeededState {
  step: number;
  rng: number;
}

/**
 * Adapter whose step transitions are seeded by `rngSeed` so two runs with the
 * same seed produce identical reward streams. Uses a tiny LCG seeded by the
 * passed-in seed; no `Math.random()` calls.
 */
class SeededAdapter extends EpisodeAdapter<SeededState, number> {
  override reset(
    rngSeed: number,
  ): { observation: Float32Array; state: SeededState } {
    return {
      observation: new Float32Array([rngSeed % 1]),
      state: { step: 0, rng: rngSeed | 0 },
    };
  }

  override step(
    state: SeededState,
    _action: number,
  ): StepResult<Float32Array> & { state: SeededState } {
    // Park-Miller LCG
    const nextRng = (state.rng * 16807) % 2147483647;
    const next: SeededState = { step: state.step + 1, rng: nextRng };
    return {
      observation: new Float32Array([nextRng / 2147483647]),
      reward: nextRng / 2147483647,
      terminated: next.step >= 20,
      truncated: false,
      state: next,
    };
  }

  override get observationLength(): number {
    return 1;
  }

  override decodeAction(_creatureOutput: Float32Array): number {
    return 0;
  }
}

Deno.test("runEpisode: same seed produces identical results", async () => {
  await initWasmForTests();
  const creature = makeCreature();

  const a = await runEpisode(new SeededAdapter(), creature, 12345);
  const b = await runEpisode(new SeededAdapter(), creature, 12345);

  assertEquals(a.returnValue, b.returnValue);
  assertEquals(a.steps, b.steps);
  assertEquals(a.terminated, b.terminated);
  assertEquals(a.truncated, b.truncated);
  assertEquals(a.truncationReason, b.truncationReason);
  assertEquals(a.seed, 12345);
});

// ---------------------------------------------------------------------------
// 6. Reward accumulation — five reward=1 steps then terminated
// ---------------------------------------------------------------------------

class FiveRewardsAdapter extends EpisodeAdapter<{ step: number }, number> {
  override reset(
    _rngSeed: number,
  ): { observation: Float32Array; state: { step: number } } {
    return { observation: new Float32Array([0]), state: { step: 0 } };
  }

  override step(
    state: { step: number },
    _action: number,
  ): StepResult<Float32Array> & { state: { step: number } } {
    const next = { step: state.step + 1 };
    return {
      observation: new Float32Array([next.step]),
      reward: 1,
      terminated: next.step >= 5,
      truncated: false,
      state: next,
    };
  }

  override get observationLength(): number {
    return 1;
  }

  override decodeAction(_creatureOutput: Float32Array): number {
    return 0;
  }
}

Deno.test("runEpisode: accumulates scalar rewards across the rollout", async () => {
  await initWasmForTests();
  const adapter = new FiveRewardsAdapter();
  const creature = makeCreature();

  const result = await runEpisode(adapter, creature, 0);

  assertEquals(result.steps, 5);
  assertEquals(result.terminated, true);
  assertEquals(result.truncated, false);
  assertEquals(result.returnValue, 5);
});
