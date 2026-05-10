/**
 * SeedRewardAdapterFixture.ts — Importable adapter fixture used by the
 * parallel-rollout tests in `evolveRL_parallel_test.ts` (Issue #2612).
 *
 * Mirrors the in-test `SeedRewardAdapter` but exists as a stand-alone
 * module so the worker pool can dynamically import it via its URL — the
 * adapter description carries `{ url, config }` rather than a live
 * adapter instance (instances are not structured-clone-safe).
 *
 * The reward is purely a function of the seed so duplicate runs reproduce
 * and the per-trial breakdown is fully predictable from the seed set.
 */

import {
  EpisodeAdapter,
  type StepResult,
} from "../../../src/creature/EpisodeAdapter.ts";

export interface SeedRewardConfig {
  /**
   * When `true`, every step returns `terminated = false, truncated = false`
   * for the first `truncateAt` ticks then truncates by exhausting the
   * `maxSteps` cap. Used by the mixed-termination test.
   */
  readonly forceTruncate?: boolean;
  /**
   * Used together with `forceTruncate` to keep `maxSteps` small but still
   * positive (the runner asserts `maxSteps > 0`).
   */
  readonly maxStepsOverride?: number;
}

export default class SeedRewardAdapterFixture
  extends EpisodeAdapter<{ seed: number; tick: number }, number> {
  private readonly forceTruncate: boolean;
  private readonly maxStepsValue: number;

  constructor(config: SeedRewardConfig = {}) {
    super();
    this.forceTruncate = config.forceTruncate === true;
    this.maxStepsValue = config.maxStepsOverride ?? 1;
  }

  override reset(
    seed: number,
  ): { observation: Float32Array; state: { seed: number; tick: number } } {
    return {
      observation: new Float32Array([0.5]),
      state: { seed, tick: 0 },
    };
  }

  override step(
    state: { seed: number; tick: number },
    _action: number,
  ): StepResult<Float32Array> & { state: { seed: number; tick: number } } {
    const tick = state.tick + 1;
    const reward = -(((state.seed >>> 0) % 1000) + 1) / 1001;
    if (this.forceTruncate) {
      return {
        observation: new Float32Array([0]),
        reward,
        terminated: false,
        truncated: false,
        state: { seed: state.seed, tick },
      };
    }
    return {
      observation: new Float32Array([0]),
      reward,
      terminated: true,
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

  override maxSteps(): number {
    return this.maxStepsValue;
  }
}
