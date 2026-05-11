/**
 * Tests for the class-shaped {@link EpisodeAdapter} contract introduced in
 * Issue #2626.
 *
 * Covers the five scenarios listed in the issue:
 *
 * 1. Happy-path counting adapter (`reset` returns step 0; `step` increments).
 * 2. Default guard values (`maxSteps = 5000`, `wallClockMs = 60_000`).
 * 3. Override guards (subclass returns 100 / 1_000).
 * 4. Contract failure: a subclass that returns `0` from `observationLength`
 *    throws on first use.
 * 5. Action decode: subclass `decodeAction` returning `argmax` is exercised
 *    with a 4-vector and asserts the right action is chosen.
 */

import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import {
  DEFAULT_MAX_STEPS,
  DEFAULT_WALL_CLOCK_MS,
  EpisodeAdapter,
  type StepResult,
} from "@creature/EpisodeAdapter.ts";
import { AdapterContractError } from "@errors/AdapterContractError.ts";

// ---------------------------------------------------------------------------
// 1. Happy path: trivial counting adapter
// ---------------------------------------------------------------------------

interface CountingState {
  step: number;
}

class CountingAdapter extends EpisodeAdapter<CountingState, number> {
  override reset(
    _rngSeed: number,
  ): { observation: Float32Array; state: CountingState } {
    return { observation: new Float32Array([0]), state: { step: 0 } };
  }

  override step(
    state: CountingState,
    _action: number,
  ): StepResult<Float32Array> & { state: CountingState } {
    const next = { step: state.step + 1 };
    return {
      observation: new Float32Array([next.step]),
      reward: 1,
      terminated: false,
      truncated: false,
      info: { tick: next.step },
      state: next,
    };
  }

  override get observationLength(): number {
    return 1;
  }

  override decodeAction(creatureOutput: Float32Array): number {
    return creatureOutput[0];
  }
}

Deno.test("EpisodeAdapter: counting adapter happy path", () => {
  const adapter = new CountingAdapter();
  adapter.assertContract();

  const initial = adapter.reset(42);
  assertEquals(initial.state.step, 0);
  assertEquals(Array.from(initial.observation), [0]);

  const first = adapter.step(initial.state, 0);
  assertEquals(first.state.step, 1);
  assertEquals(Array.from(first.observation), [1]);
  assertEquals(first.reward, 1);
  assertEquals(first.terminated, false);
  assertEquals(first.truncated, false);
  // `info` is opaque to the runner but must round-trip on the StepResult.
  assertEquals(first.info, { tick: 1 });

  const second = adapter.step(first.state, 0);
  assertEquals(second.state.step, 2);
  assertEquals(Array.from(second.observation), [2]);
});

// ---------------------------------------------------------------------------
// 2. Default guards
// ---------------------------------------------------------------------------

class DefaultGuardAdapter extends EpisodeAdapter<null, number> {
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
}

Deno.test("EpisodeAdapter: default guards are 5000 / 60_000", () => {
  const adapter = new DefaultGuardAdapter();
  assertEquals(adapter.maxSteps(), 5000);
  assertEquals(adapter.wallClockMs(), 60_000);
  assertStrictEquals(DEFAULT_MAX_STEPS, 5000);
  assertStrictEquals(DEFAULT_WALL_CLOCK_MS, 60_000);
});

// ---------------------------------------------------------------------------
// 3. Override guards
// ---------------------------------------------------------------------------

class TightGuardAdapter extends DefaultGuardAdapter {
  override maxSteps(): number {
    return 100;
  }
  override wallClockMs(): number {
    return 1_000;
  }
}

Deno.test("EpisodeAdapter: subclass guard overrides are honoured", () => {
  const adapter = new TightGuardAdapter();
  assertEquals(adapter.maxSteps(), 100);
  assertEquals(adapter.wallClockMs(), 1_000);
  // assertContract() must accept the tighter (but still positive) values.
  adapter.assertContract();
});

// ---------------------------------------------------------------------------
// 4. Contract failure: observationLength = 0
// ---------------------------------------------------------------------------

class ZeroObservationAdapter extends DefaultGuardAdapter {
  override get observationLength(): number {
    return 0;
  }
}

Deno.test("EpisodeAdapter: zero observationLength fails on first use", () => {
  const adapter = new ZeroObservationAdapter();
  const err = assertThrows(
    () => adapter.assertContract(),
    AdapterContractError,
  );
  assertEquals(err.reason, "INVALID_OBSERVATION_LENGTH");
});

class NegativeMaxStepsAdapter extends DefaultGuardAdapter {
  override maxSteps(): number {
    return -5;
  }
}

Deno.test("EpisodeAdapter: non-positive maxSteps() fails on first use", () => {
  const adapter = new NegativeMaxStepsAdapter();
  const err = assertThrows(
    () => adapter.assertContract(),
    AdapterContractError,
  );
  assertEquals(err.reason, "INVALID_MAX_STEPS");
});

class ZeroWallClockAdapter extends DefaultGuardAdapter {
  override wallClockMs(): number {
    return 0;
  }
}

Deno.test("EpisodeAdapter: zero wallClockMs() fails on first use", () => {
  const adapter = new ZeroWallClockAdapter();
  const err = assertThrows(
    () => adapter.assertContract(),
    AdapterContractError,
  );
  assertEquals(err.reason, "INVALID_WALL_CLOCK_MS");
});

class WrongObservationTypeAdapter extends EpisodeAdapter<null, number> {
  override reset(
    _rngSeed: number,
  ): { observation: Float32Array; state: null } {
    // Lie at runtime to exercise the type-check guard.
    return {
      observation: [0, 0] as unknown as Float32Array,
      state: null,
    };
  }

  override step(
    _state: null,
    _action: number,
  ): StepResult<Float32Array> & { state: null } {
    return {
      observation: new Float32Array([0]),
      reward: 0,
      terminated: true,
      truncated: false,
      state: null,
    };
  }

  override get observationLength(): number {
    return 2;
  }

  override decodeAction(creatureOutput: Float32Array): number {
    return creatureOutput[0];
  }
}

Deno.test("EpisodeAdapter: non-Float32Array observation fails contract", () => {
  const adapter = new WrongObservationTypeAdapter();
  const err = assertThrows(
    () => adapter.assertContract(),
    AdapterContractError,
  );
  assertEquals(err.reason, "INVALID_OBSERVATION_TYPE");
});

class WrongObservationSizeAdapter extends EpisodeAdapter<null, number> {
  override reset(
    _rngSeed: number,
  ): { observation: Float32Array; state: null } {
    // Length 2, but observationLength claims 4.
    return { observation: new Float32Array([0, 0]), state: null };
  }
  override step(
    _state: null,
    _action: number,
  ): StepResult<Float32Array> & { state: null } {
    return {
      observation: new Float32Array([0, 0, 0, 0]),
      reward: 0,
      terminated: true,
      truncated: false,
      state: null,
    };
  }
  override get observationLength(): number {
    return 4;
  }
  override decodeAction(creatureOutput: Float32Array): number {
    return creatureOutput[0];
  }
}

Deno.test("EpisodeAdapter: mismatched observation length fails contract", () => {
  const adapter = new WrongObservationSizeAdapter();
  const err = assertThrows(
    () => adapter.assertContract(),
    AdapterContractError,
  );
  assertEquals(err.reason, "INVALID_OBSERVATION_SIZE");
});

// ---------------------------------------------------------------------------
// 5. Action decoding via argmax
// ---------------------------------------------------------------------------

class ArgmaxAdapter extends EpisodeAdapter<null, number> {
  override reset(
    _rngSeed: number,
  ): { observation: Float32Array; state: null } {
    return { observation: new Float32Array([0, 0, 0, 0]), state: null };
  }

  override step(
    _state: null,
    _action: number,
  ): StepResult<Float32Array> & { state: null } {
    return {
      observation: new Float32Array([0, 0, 0, 0]),
      reward: 0,
      terminated: true,
      truncated: false,
      state: null,
    };
  }

  override get observationLength(): number {
    return 4;
  }

  override decodeAction(creatureOutput: Float32Array, _state: null): number {
    let bestIdx = 0;
    let bestVal = creatureOutput[0];
    for (let i = 1; i < creatureOutput.length; i++) {
      if (creatureOutput[i] > bestVal) {
        bestVal = creatureOutput[i];
        bestIdx = i;
      }
    }
    return bestIdx;
  }
}

Deno.test("EpisodeAdapter: argmax decodeAction picks the largest index", () => {
  const adapter = new ArgmaxAdapter();
  adapter.assertContract();

  // Action 2 is the largest.
  const a = adapter.decodeAction(
    new Float32Array([0.1, 0.3, 0.9, 0.2]),
    null,
  );
  assertEquals(a, 2);

  // Tie-breaking favours the first-seen maximum.
  const b = adapter.decodeAction(
    new Float32Array([0.5, 0.5, 0.5, 0.5]),
    null,
  );
  assertEquals(b, 0);

  // Last index wins when it is uniquely largest.
  const c = adapter.decodeAction(
    new Float32Array([-1, -2, -3, 0]),
    null,
  );
  assertEquals(c, 3);
});

// ---------------------------------------------------------------------------
// Idempotency: assertContract is a one-shot guard.
// ---------------------------------------------------------------------------

Deno.test("EpisodeAdapter: assertContract() is idempotent on repeat calls", () => {
  let resetCalls = 0;

  class CountingResetAdapter extends DefaultGuardAdapter {
    override reset(
      _rngSeed: number,
    ): { observation: Float32Array; state: null } {
      resetCalls++;
      return { observation: new Float32Array([0]), state: null };
    }
  }

  const adapter = new CountingResetAdapter();
  adapter.assertContract();
  adapter.assertContract();
  adapter.assertContract();
  assertEquals(resetCalls, 1);
});
