/**
 * EpisodeAdapter.ts — Reinforcement-learning episode interface for
 * `Creature.evolveEnv()` (Issue #2611).
 *
 * NEAT-AI's existing `evolveDir()` API scores creatures against partitioned
 * dataset files via the worker pool. For RL workloads the simulator owns world
 * state and the next observation depends on the agent's previous action, so a
 * different scorer is needed: each generation runs a full episode rollout per
 * creature (`reset` → `observe` → activate → `decode` → `step`) and reports the
 * cumulative reward as the fitness signal.
 *
 * The adapter is supplied by the caller and is the only RL-specific surface;
 * NEAT population management, mutation, crossover, elitism, and plateau
 * detection are all reused from the dataset path. See
 * `docs/REINFORCEMENT_LEARNING.md` for the streaming-observation contract.
 */

/**
 * One full play-through of a simulator for a single creature (an *episode*).
 *
 * Implementations are pure with respect to their `state` argument — no hidden
 * mutable globals — so that supplying a deterministic seed to `reset()`
 * reproduces the same trajectory bit-for-bit.
 *
 * @typeParam S — Simulator state type. Opaque to NEAT-AI; passed back into
 *   `observe`/`step` unchanged so the adapter can carry whatever data it likes
 *   (a typed array, a class instance, or a tuple).
 * @typeParam A — Action type emitted by `decode()`. Whatever shape the
 *   simulator's `step()` consumes — a number, a vector, an enum, etc.
 */
export interface EpisodeAdapter<S, A> {
  /** Number of input neurons the creature must have. */
  readonly inputCount: number;
  /** Number of output neurons the creature must have. */
  readonly outputCount: number;
  /**
   * Hard cap on the number of ticks per episode. Acts as a safety net for
   * simulators that may never set `done = true`.
   */
  readonly maxSteps: number;

  /**
   * Initialise (or re-initialise) the simulator and return the starting state.
   *
   * @param seed — Optional deterministic seed. When the same `seed` is supplied
   *   twice the adapter MUST produce identical state, observations, and step
   *   transitions, otherwise determinism guarantees in {@link evolveEnv} are
   *   broken.
   */
  reset(seed?: number): S;

  /**
   * Project the simulator state into the network's input vector. Length must
   * equal {@link inputCount}.
   */
  observe(state: S): Float32Array;

  /**
   * Decode the network's output vector into the action consumed by `step()`.
   * Called once per tick after `Creature.activate(observation)`.
   */
  decode(output: Float32Array): A;

  /**
   * Apply `action` to `state` and return the next state, the immediate reward,
   * and whether the episode has terminated. The next observation is computed
   * by passing the returned `state` to `observe()` on the next tick — this is
   * the streaming-observation pattern documented in
   * `docs/REINFORCEMENT_LEARNING.md`.
   */
  step(state: S, action: A): { state: S; reward: number; done: boolean };
}

/**
 * Caller-tunable behaviour for {@link evolveEnv}.
 *
 * Combined with the standard {@link NeatOptions} (population size, target
 * error, timeout, plateau detection, ...), so the same evolutionary stop
 * conditions and lifecycle events used by `evolveDir()` apply here too.
 */
export interface EpisodicOptions {
  /**
   * Number of trials averaged into the creature's fitness score per
   * generation. Default: `1`.
   *
   * When > 1 each trial uses a deterministic per-trial seed derived from
   * {@link EpisodicOptions.seed} so duplicate runs reproduce. The mean reward
   * across trials is mapped to the `error` slot via
   * {@link EpisodicOptions.rewardToError}.
   */
  trialsPerScore?: number;

  /**
   * Magnitude of stochastic perturbation applied to the per-trial seed.
   * Default: `0` (trials use deterministic seeds derived purely from the base
   * seed and trial index).
   *
   * When > 0 the per-trial seed is offset by `trialIndex * initialPerturbation`
   * so adapters that branch on subtle seed differences exercise more of their
   * stochastic surface — useful for noisy simulators where a single trial is
   * not representative.
   */
  initialPerturbation?: number;

  /**
   * Base seed used to derive per-trial seeds. When omitted the global RNG seed
   * (from `NeatOptions.seed`) is used; when neither is set, an unseeded base
   * of `0` is used and trials still vary deterministically by trial index.
   */
  seed?: number;

  /**
   * Map cumulative episode reward to the non-negative `error` slot consumed by
   * the standard NEAT scoring path (`Score.calculate`). Lower error = better
   * fitness, so the default mapping is `error = max(0, -reward)`:
   *
   * - reward ≥ 0 → error = 0 (best), score → 1 - growth penalty.
   * - reward < 0 → error = |reward|, score = 1 - error - growth penalty.
   *
   * Override this when your reward signal needs a different mapping (for
   * example a quadratic shaping or a fixed offset to keep stop-condition
   * thresholds intuitive).
   *
   * The function MUST return a finite, non-negative number, otherwise
   * {@link evolveEnv} fails fast.
   */
  rewardToError?: (cumulativeReward: number) => number;

  /**
   * Optional callback fired once per scored creature per generation with the
   * per-trial reward breakdown so callers can chart variance. Fired
   * synchronously inside the fitness phase; throwing here aborts the
   * generation, so wrap any noisy I/O.
   */
  onEpisodeTrials?: (event: EpisodeTrialsEvent) => void;
}

/**
 * Payload delivered to {@link EpisodicOptions.onEpisodeTrials}.
 */
export interface EpisodeTrialsEvent {
  /** 1-based generation number at which this creature was scored. */
  readonly generation: number;
  /** UUID of the scored creature, when available. */
  readonly creatureUuid?: string;
  /** Cumulative reward returned by each trial (length === trialsPerScore). */
  readonly trialRewards: readonly number[];
  /** Arithmetic mean of `trialRewards`. */
  readonly meanReward: number;
  /**
   * Population-standard-deviation of `trialRewards`; `0` when only a single
   * trial was run.
   */
  readonly stdReward: number;
  /** The non-negative error mapped from `meanReward` via `rewardToError`. */
  readonly error: number;
}

/**
 * Default reward → error mapping used when callers do not override
 * {@link EpisodicOptions.rewardToError}.
 *
 * Returns `Math.max(0, -cumulativeReward)` so that:
 *
 * - Any non-negative cumulative reward maps to `error = 0` (target reached).
 * - Negative cumulative rewards map to their absolute value as the error.
 *
 * This keeps `Score.calculate`'s `error >= 0` invariant satisfied while still
 * giving evolution a smooth gradient on the negative-reward side.
 */
export function defaultRewardToError(cumulativeReward: number): number {
  if (!Number.isFinite(cumulativeReward)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return cumulativeReward >= 0 ? 0 : -cumulativeReward;
}
