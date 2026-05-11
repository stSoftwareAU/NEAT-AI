/**
 * EpisodeRunner.ts — Library-owned `runEpisode()` wrapper that drives an
 * {@link EpisodeAdapter} end-to-end for a single creature (Issue #2627, part
 * of #2624).
 *
 * The runner is final and library-owned: callers do not reimplement it. It
 * solves the failure modes called out in #2624 (a snake creature pressing
 * left forever, a snake dying after three steps) by enforcing both a
 * wall-clock cap and a max-steps cap. Termination semantics mirror
 * Gym/Gymnasium: `terminated` is a natural episode end (death, goal),
 * `truncated` is a guard firing.
 *
 * The hot loop is intentionally lean — caps and `t0` are captured once, the
 * runner allocates no per-tick objects beyond the {@link StepResult} the
 * adapter itself returns, and `Math.random()` is never consulted (`rngSeed`
 * is the only source of nondeterminism that crosses the seam).
 *
 * Wall-clock cost note: `performance.now()` is invoked once per tick. The
 * call costs roughly tens of nanoseconds, which is negligible next to a
 * single `Creature.activate()` invocation. A coarser modulo gate could be
 * layered on later if profiling ever shows the syscall dominating cost on
 * trivial sims.
 */

import type { Creature } from "@creature";
import type { EpisodeAdapter } from "@creature/EpisodeAdapter.ts";

/**
 * Why a {@link runEpisode} call exited.
 *
 * - `'maxSteps'` — the per-episode step cap fired.
 * - `'wallClock'` — the wall-clock cap fired.
 *
 * Only set when `truncated === true`.
 */
export type TruncationReason = "maxSteps" | "wallClock";

/**
 * Outcome of a single episode rollout.
 *
 * Determinism contract: with the same `rngSeed`, the same creature, and the
 * same adapter, two `runEpisode()` calls MUST produce identical
 * `returnValue`, `steps`, `terminated`, `truncated`, and `truncationReason`.
 * `elapsedMs` is wall-clock and therefore inherently nondeterministic.
 */
export interface EpisodeResult {
  /** Sum of step rewards across the rollout. */
  readonly returnValue: number;
  /** Number of `step()` calls before exit. */
  readonly steps: number;
  /** Adapter signalled a natural episode end (death, goal, terminal state). */
  readonly terminated: boolean;
  /** A guard fired (step cap or wall-clock cap). */
  readonly truncated: boolean;
  /** Which guard fired, when `truncated === true`. */
  readonly truncationReason?: TruncationReason;
  /** Wall-clock duration of the rollout in milliseconds. */
  readonly elapsedMs: number;
  /** Seed that was passed to {@link EpisodeAdapter.reset}. */
  readonly seed: number;
}

/**
 * Drive an {@link EpisodeAdapter} end-to-end for one creature. Returns the
 * scalar return plus rollout metadata.
 *
 * Loop semantics, in order, on each tick:
 *
 * 1. `output = creature.activate(observation, true)` (feedback loop on, per
 *    `docs/REINFORCEMENT_LEARNING.md`).
 * 2. `action = adapter.decodeAction(output, state)`.
 * 3. `result = adapter.step(state, action)`.
 * 4. Accumulate `returnValue += result.reward`; advance `state` and
 *    `observation`.
 * 5. Exit cleanly with `terminated = true` when `result.terminated`.
 * 6. Exit with `truncated = true, truncationReason = 'maxSteps'` when
 *    `steps >= maxSteps`.
 * 7. Exit with `truncated = true, truncationReason = 'wallClock'` when
 *    `(performance.now() - t0) >= wallClockMs`.
 *
 * @param adapter — Adapter wrapping the simulator. {@link EpisodeAdapter.assertContract}
 *   is invoked once before the first tick.
 * @param creature — The genome whose `activate()` produces actions.
 * @param rngSeed — Deterministic seed forwarded to `adapter.reset(rngSeed)`.
 *   The runner itself never reads from `Math.random()`.
 */
export function runEpisode<S, A>(
  adapter: EpisodeAdapter<S, A>,
  creature: Creature,
  rngSeed: number,
): Promise<EpisodeResult> {
  // Validate the adapter contract on first use. Subsequent calls are no-ops
  // (the adapter caches the check internally), so paying once per episode is
  // fine.
  adapter.assertContract(rngSeed);

  // Capture caps once. `maxSteps()` and `wallClockMs()` are virtual calls;
  // the hot loop must not pay for them on every tick.
  const maxSteps = adapter.maxSteps();
  const wallClockMs = adapter.wallClockMs();

  // Capture `t0` once — every later wall-clock check measures against this.
  const t0 = performance.now();

  const initial = adapter.reset(rngSeed);
  let observation: Float32Array = initial.observation;
  let state: S = initial.state;

  let returnValue = 0;
  let steps = 0;
  let terminated = false;
  let truncated = false;
  let truncationReason: TruncationReason | undefined;

  while (true) {
    const output = creature.activate(observation, true);
    const action = adapter.decodeAction(output, state);
    const result = adapter.step(state, action);

    returnValue += result.reward;
    state = result.state;
    observation = result.observation;
    steps++;

    if (result.terminated) {
      terminated = true;
      break;
    }

    if (steps >= maxSteps) {
      truncated = true;
      truncationReason = "maxSteps";
      break;
    }

    if (performance.now() - t0 >= wallClockMs) {
      truncated = true;
      truncationReason = "wallClock";
      break;
    }
  }

  const elapsedMs = performance.now() - t0;

  return Promise.resolve({
    returnValue,
    steps,
    terminated,
    truncated,
    truncationReason,
    elapsedMs,
    seed: rngSeed,
  });
}
