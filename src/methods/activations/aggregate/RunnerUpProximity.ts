/**
 * Issue #1874: the "runner-up proximity" rule shared by the extremum
 * aggregates (MAXIMUM, MINIMUM).
 *
 * A losing connection whose value sits close to the winning connection's
 * magnitude still participates: it is marked `used` during tracing, and it
 * receives a leaked fraction of the gradient during propagation. Both halves
 * MUST agree — if tracing declined to mark a connection that propagation still
 * leaks gradient to, `applyLearnings` would disconnect a connection that is
 * actively learning.
 *
 * Issue #3635: the rule was copy-pasted into four method bodies and the copies
 * drifted on the floor constant (`1e-12` while tracing, `config.plankConstant`
 * while propagating), which reopened exactly that hazard for winners whose
 * magnitude fell between the two. This module is now the single source of
 * truth for the window.
 */

/**
 * Lower bound on the winner's magnitude when sizing the proximity window.
 *
 * Without a floor, a winner of ~0 gives a ~0 window and every runner-up drops
 * out. The value matches the default `BackPropagationConfig.plankConstant`,
 * which is the smallest magnitude propagation treats as meaningful. It is a
 * fixed constant rather than the caller's configured `plankConstant` so that
 * tracing (which has no `BackPropagationConfig`) and propagation can never
 * disagree about the window.
 */
export const RUNNER_UP_PROXIMITY_FLOOR = 0.000_000_1;

/** Window width as a fraction of the winner's (floored) magnitude. */
export const RUNNER_UP_PROXIMITY_WINDOW = 0.2;

/**
 * Proximity of a runner-up to the winner.
 *
 * @param winnerValue The winning connection's value; its magnitude sizes the
 *   window.
 * @param distance How far the runner-up sits from the winner, measured towards
 *   the losing side of the extremum (below the winner for MAXIMUM, above it for
 *   MINIMUM). Callers own the direction, so a negative distance means the
 *   connection is on the winning side and is not a runner-up.
 * @param floor Lower bound on the winner's magnitude; defaults to
 *   {@link RUNNER_UP_PROXIMITY_FLOOR} and should only be overridden by tests.
 * @returns `1` at the winner, decaying linearly to `0` at the window edge, and
 *   `-1` outside the window (including a negative or `NaN` distance). A
 *   non-negative result means the runner-up participates.
 */
export function runnerUpProximity(
  winnerValue: number,
  distance: number,
  floor: number = RUNNER_UP_PROXIMITY_FLOOR,
): number {
  // Negated comparison so a NaN distance is rejected rather than admitted.
  if (!(distance >= 0)) return -1;

  const threshold = Math.max(Math.abs(winnerValue), floor) *
    RUNNER_UP_PROXIMITY_WINDOW;

  if (threshold <= 0) return distance === 0 ? 1 : -1;
  if (distance > threshold) return -1;

  return 1 - distance / threshold;
}
