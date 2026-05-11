/**
 * CpuBoundAdapterFixture.ts — CPU-bound importable adapter used by the
 * `bench/evolveRLParallel.bench.ts` benchmark (Issue #2612 acceptance
 * criterion: ≥1.5× speedup on 4 threads with a CPU-bound adapter).
 *
 * Each `step()` burns a fixed number of JS cycles in a tight loop so the
 * rollout's wall-clock is dominated by CPU work, making real worker
 * parallelism visibly faster than single-threaded execution.
 */

import {
  EpisodeAdapter,
  type StepResult,
} from "../../../src/creature/EpisodeAdapter.ts";

export interface CpuBoundConfig {
  /** Number of busy-loop iterations per step. */
  readonly busyIterations?: number;
  /** Number of steps per episode before terminating. */
  readonly stepsPerEpisode?: number;
}

interface CpuBoundState {
  readonly seed: number;
  tick: number;
  /** Accumulator updated by the busy loop so V8 cannot optimise it away. */
  acc: number;
}

export default class CpuBoundAdapterFixture
  extends EpisodeAdapter<CpuBoundState, number> {
  private readonly busyIterations: number;
  private readonly stepsPerEpisode: number;

  constructor(config: CpuBoundConfig = {}) {
    super();
    this.busyIterations = config.busyIterations ?? 100_000;
    this.stepsPerEpisode = config.stepsPerEpisode ?? 50;
  }

  override reset(
    seed: number,
  ): { observation: Float32Array; state: CpuBoundState } {
    return {
      observation: new Float32Array([0.5]),
      state: { seed, tick: 0, acc: 0 },
    };
  }

  override step(
    state: CpuBoundState,
    _action: number,
  ): StepResult<Float32Array> & { state: CpuBoundState } {
    // Busy-loop the configured number of iterations so the step is
    // CPU-bound. Touching `acc` keeps the loop from being elided.
    let acc = state.acc;
    for (let i = 0; i < this.busyIterations; i++) {
      acc = (acc + Math.sin(i + state.seed) * 0.001) | 0;
    }
    const tick = state.tick + 1;
    const terminated = tick >= this.stepsPerEpisode;
    return {
      observation: new Float32Array([0]),
      reward: -0.01,
      terminated,
      truncated: false,
      state: { seed: state.seed, tick, acc },
    };
  }

  override get observationLength(): number {
    return 1;
  }

  override decodeAction(_creatureOutput: Float32Array): number {
    return 0;
  }
}
