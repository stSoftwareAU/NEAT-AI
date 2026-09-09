/**
 * @module
 *
 * Classifies an activation by whether it **blocks the gradient over a region**
 * of its input space (Issue #3974).
 *
 * #3972 measured the mechanism on `test/data/grq-23-forests-constants.json`:
 * inside a serial chain — a run of consecutive depth levels holding exactly one
 * neuron each — there is no depth-parallel route, so one zero derivative
 * anywhere along the run zeroes the gradient for every member upstream of it,
 * for that sample. The activations sitting in that chain are the ones
 * classified here.
 *
 * The classification is **measured, not listed**, so an activation added to the
 * registry tomorrow is classified by what its own `derivative()` does rather
 * than by whether someone remembered to name it:
 *
 * - A scalar activation is blocking when `derivative(x)` returns **exactly
 *   zero** over more than half of {@link DEAD_SAMPLE_GRID}. `HARD_TANH` is dead
 *   on both tails (0.875 of the grid) and `STEP` everywhere (1.0); `ReLU` is
 *   dead on exactly half and is deliberately **not** blocking — a chain member
 *   sees both signs, and the issue lists `ReLU` among the well-behaved pool.
 * - `IF`, `MINIMUM` and `MAXIMUM` route the gradient to a subset of their
 *   inbound branches rather than scaling every one, so they are blocking by
 *   construction. They expose no scalar `derivative()` at all, which is what
 *   {@link GRADIENT_GATING_SQUASHES} records — and
 *   `test/methods/activations/GradientBlocking.ts` fails if a new selectable
 *   activation ever joins them unclassified.
 *
 * Nothing here changes behaviour on its own: it is the predicate
 * `ModSquash`'s depth-aware bias consults.
 */

import { Activations } from "@methods/activations/Activations.ts";

/**
 * Pre-activation values the dead-derivative fraction is measured over: 160
 * points spanning `[-8, 8]`, offset by half a step so the grid is symmetric
 * about zero and never samples `x = 0` itself. Sampling zero would push the
 * ReLU family from exactly half the grid to just over it, which is the
 * boundary {@link DEAD_FRACTION_THRESHOLD} sits on.
 */
export const DEAD_SAMPLE_GRID: readonly number[] = Array.from(
  { length: 160 },
  (_, i) => -8 + 0.05 + i * 0.1,
);

/**
 * A scalar activation is gradient-blocking when strictly more than this
 * fraction of {@link DEAD_SAMPLE_GRID} has an exactly-zero derivative.
 */
export const DEAD_FRACTION_THRESHOLD = 0.5;

/**
 * The aggregate activations that gate the gradient onto a subset of their
 * inbound branches instead of scaling all of them: `MINIMUM` / `MAXIMUM` pass
 * gradient to the winning synapse (plus the engine's runner-up leak), and `IF`
 * passes it to the taken branch only, never to the condition.
 */
export const GRADIENT_GATING_SQUASHES: ReadonlySet<string> = new Set([
  "IF",
  "MINIMUM",
  "MAXIMUM",
]);

/** Memoised results — the grid is walked once per activation, not per draw. */
const deadFractionCache = new Map<string, number>();
const blockingCache = new Map<string, boolean>();

/**
 * The fraction of {@link DEAD_SAMPLE_GRID} on which `name`'s derivative is
 * exactly zero.
 *
 * @param name - Canonical name or alias of a registered activation.
 * @returns A fraction in `[0, 1]`, or `undefined` when the activation exposes
 *   no scalar `derivative()` (the aggregates, which are classified
 *   structurally).
 * @throws {ActivationError} When `name` is not a registered activation.
 */
export function gradientDeadFraction(name: string): number | undefined {
  const activation = Activations.find(name);
  const canonical = activation.getName();
  const cached = deadFractionCache.get(canonical);
  if (cached !== undefined) return cached;

  const derivative = activation.derivative;
  if (typeof derivative !== "function") return undefined;

  let dead = 0;
  for (const x of DEAD_SAMPLE_GRID) {
    if (derivative.call(activation, x) === 0) dead++;
  }
  const fraction = dead / DEAD_SAMPLE_GRID.length;
  deadFractionCache.set(canonical, fraction);
  return fraction;
}

/**
 * Whether `name` blocks the gradient over a region of its input space, and so
 * kills the gradient for everything upstream of it when it sits inside a
 * serial chain.
 *
 * @param name - Canonical name or alias of a registered activation.
 * @returns `true` for a gating aggregate, or for a scalar activation dead over
 *   more than {@link DEAD_FRACTION_THRESHOLD} of {@link DEAD_SAMPLE_GRID}.
 * @throws {ActivationError} When `name` is not a registered activation.
 */
export function isGradientBlockingSquash(name: string): boolean {
  const canonical = Activations.find(name).getName();
  const cached = blockingCache.get(canonical);
  if (cached !== undefined) return cached;

  const fraction = gradientDeadFraction(canonical);
  const blocking = fraction === undefined
    ? GRADIENT_GATING_SQUASHES.has(canonical)
    : fraction > DEAD_FRACTION_THRESHOLD;
  blockingCache.set(canonical, blocking);
  return blocking;
}
