/**
 * MixedTerminationAdapterFixture.ts — Importable adapter fixture exercising
 * both `terminated` and `truncated` exits in the same population
 * (Issue #2612, mixed-termination acceptance criterion).
 *
 * Episodes whose seed is even terminate naturally on tick 1; episodes
 * whose seed is odd never terminate and are cut off by the default
 * `maxSteps` truncation guard. This lets a single population mix both
 * exit signals, verifying that the worker pool collects each creature's
 * score immediately and frees its slot regardless of which exit fired.
 */

import {
  EpisodeAdapter,
  type StepResult,
} from "../../../src/creature/EpisodeAdapter.ts";

interface MixedState {
  readonly seed: number;
  tick: number;
}

export default class MixedTerminationAdapterFixture
  extends EpisodeAdapter<MixedState, number> {
  override reset(
    seed: number,
  ): { observation: Float32Array; state: MixedState } {
    return {
      observation: new Float32Array([0.5]),
      state: { seed, tick: 0 },
    };
  }

  override step(
    state: MixedState,
    _action: number,
  ): StepResult<Float32Array> & { state: MixedState } {
    const tick = state.tick + 1;
    const evenSeed = (state.seed & 1) === 0;
    return {
      observation: new Float32Array([0]),
      // Both outcomes give the same reward so the test can assert on the
      // `terminated`/`truncated` signal independently of cumulative reward.
      reward: -0.1,
      terminated: evenSeed,
      truncated: false,
      state: { seed: state.seed, tick },
    };
  }

  override get observationLength(): number {
    return 1;
  }

  override decodeAction(_creatureOutput: Float32Array): number {
    return 0;
  }

  // Tight cap so odd-seed episodes truncate quickly without dragging the
  // test suite. The runner asserts the cap is a positive integer.
  override maxSteps(): number {
    return 4;
  }
}
