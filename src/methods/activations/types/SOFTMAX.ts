import { ActivationError } from "@errors/ActivationError.ts";
import { ActivationRange } from "@propagate/ActivationRange.ts";
import { ErrorHelper } from "@propagate/ErrorHelper.ts";
import { ERROR_EPSILON } from "@methods/activations/AbstractActivationInterface.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";
import type { UnSquashInterface } from "@methods/activations/UnSquashInterface.ts";

/**
 * SOFTMAX activation function (Issue #2793).
 *
 * Mathematical definition (vector form):
 *
 *   softmax(z)_i = exp(z_i) / Σ_j exp(z_j)
 *
 * Softmax is inherently a **vector** operation: each output element depends on
 * all other elements in the same layer through the shared normalising
 * denominator. NEAT-AI's per-neuron activation contract — `squash(x: number)
 * => number` — operates on a single logit at a time, so a literal per-neuron
 * softmax has no meaning.
 *
 * This class provides two coordinated views:
 *
 *  1. **Per-neuron surrogate** — `squash(x)` returns the logistic value
 *     `1 / (1 + exp(-x))`. Mathematically this is `softmax([x, 0])_0`, so the
 *     surrogate is well-defined and bounded in `(0, 1)`. It lets the WASM
 *     forward pass treat a SOFTMAX-tagged output neuron exactly like a
 *     LOGISTIC neuron (`wasmAliasName()` returns "LOGISTIC"), which is what
 *     the existing Rust core supports today.
 *  2. **Vector normalisation** — the standalone {@link softmaxNormalise}
 *     helper normalises a full output vector into a proper probability
 *     simplex. Callers that need true softmax probabilities (e.g. argmax
 *     classifiers, calibrated probability outputs) post-process the forward
 *     pass output through this helper.
 *
 * Why a separate activation rather than aliasing LOGISTIC outright? Two
 * reasons:
 *
 *  - **Signal of intent** — when a creature's output layer carries the name
 *    `SOFTMAX`, the cost / scoring pipeline can recognise it as a multi-class
 *    classifier and apply softmax normalisation + cross-entropy semantics.
 *    A LOGISTIC label gives no such hint.
 *  - **Loss coupling** — `calculateError()` returns the raw cross-entropy
 *    gradient `(target - activation)` without the sigmoid-derivative
 *    scaling that LOGISTIC applies. This matches the canonical
 *    `softmax + cross-entropy` simplification where the gradient w.r.t. the
 *    logit is exactly `activation - target` (sign convention here is
 *    `target - activation`, matching the rest of NEAT-AI's error helpers).
 *
 * `mutationProbability` is intentionally `0`: SOFTMAX is only meaningful on
 * an output layer paired with a multi-class cost (CROSS_ENTROPY).
 * Random mutation should never pick it for a hidden neuron.
 *
 * @see softmaxNormalise — vector-level normalisation helper.
 * @see {@link https://en.wikipedia.org/wiki/Softmax_function}
 */
export class SOFTMAX implements ActivationInterface, UnSquashInterface {
  /**
   * SOFTMAX is selectable on output layers, but never picked at random for
   * hidden neurons — it only makes sense paired with a multi-class cost.
   */
  public mutationProbability = 0;

  public static readonly NAME = "SOFTMAX";

  public readonly range: ActivationRange = new ActivationRange(
    SOFTMAX.NAME,
    0,
    1,
  );

  getName(): string {
    return SOFTMAX.NAME;
  }

  /**
   * Hint to the WASM forward pass: treat SOFTMAX-tagged neurons as LOGISTIC
   * during per-neuron activation. True vector softmax normalisation happens
   * at the caller layer via {@link softmaxNormalise}.
   */
  wasmAliasName(): string {
    return "LOGISTIC";
  }

  /**
   * Per-neuron surrogate: returns `softmax([x, 0])_0 = 1 / (1 + exp(-x))`.
   * Bounded in `(0, 1)` so range checks elsewhere in the pipeline remain
   * happy.
   */
  squash(x: number): number {
    if (!Number.isFinite(x)) return 0.5;
    const fx = 1 / (1 + Math.exp(-x));
    return this.range.limit(fx, x);
  }

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);
    const safe = Math.min(
      Math.max(activation, Number.EPSILON),
      1 - Number.EPSILON,
    );
    return Math.log(safe / (1 - safe));
  }

  /**
   * Derivative of the per-neuron surrogate (logistic): `y * (1 - y)`.
   * The true softmax Jacobian is matrix-valued; for the SOFTMAX + CE pairing
   * the relevant slope cancels out and `calculateError()` already returns
   * the post-cancellation gradient, so the per-neuron derivative is only
   * used by the legacy diagnostic paths.
   */
  derivative(x: number): number {
    if (!Number.isFinite(x)) {
      throw new ActivationError(
        `Non-finite input to ${this.getName()}.derivative: ${x}`,
        "NON_FINITE_INPUT",
        this.getName(),
        x,
      );
    }
    const y = this.squash(x);
    const d = y * (1 - y);
    return Number.isFinite(d) ? d : 0;
  }

  /**
   * Returns the canonical SOFTMAX + CROSS_ENTROPY gradient w.r.t. the
   * pre-squash logit.
   *
   * For the standard softmax / cross-entropy pairing
   *
   *   dL/dz_i = activation_i - target_i
   *
   * — with no derivative scaling. NEAT-AI's `calculateError` sign convention
   * is `targetActivation - currentActivation`, so the returned value is the
   * negation of the dL/dz form above. This matches IDENTITY.calculateError
   * exactly and, importantly, is the same shape the Rust WASM gradient
   * already applies for output neurons (`expected - activation`). The
   * intentional consequence: a SOFTMAX-tagged output trained against
   * one-hot targets behaves as the cross-entropy gradient, with no
   * vanishing-gradient saturation in the tails.
   */
  calculateError(
    currentActivation: number,
    targetActivation: number,
    _currentValue: number,
  ): number {
    const rawError = targetActivation - currentActivation;
    if (Math.abs(rawError) < ERROR_EPSILON) return 0;
    return ErrorHelper.calculateClampedError(rawError);
  }

  /**
   * Treat the SOFTMAX surrogate as safe across the same logistic band as
   * LOGISTIC. Saturation tails get a gentle fade so the gradient still has
   * a chance to recover.
   */
  safeZoneAdjustment(rawInput: number, error: number): number {
    if (!Number.isFinite(rawInput)) return 0;
    const safeLow = -6;
    const safeHigh = 6;
    const min = -10;
    const max = 10;

    if (rawInput >= safeLow && rawInput <= safeHigh) return 1;
    if (rawInput < safeLow && error > 0) return 0.2;
    if (rawInput > safeHigh && error < 0) return 0.2;
    if (rawInput > safeHigh && rawInput <= max) {
      return 1 - (rawInput - safeHigh) / (max - safeHigh);
    }
    if (rawInput < safeLow && rawInput >= min) {
      return (rawInput - min) / (safeLow - min);
    }
    return 0;
  }
}

/**
 * Normalise a vector of logits into a probability simplex via softmax.
 *
 * Implements the standard numerically stable form:
 *
 *   1. Subtract `max(logits)` from each entry so the largest exponent is 0
 *      (preventing `exp` overflow for large logits).
 *   2. Take `exp` of the shifted logits.
 *   3. Divide by the sum.
 *
 * Returns a new `Float32Array` of the same length as the input. The input
 * array is not mutated.
 *
 * Edge cases:
 *  - Empty input returns a fresh empty array.
 *  - Single-element input returns `[1]` (degenerate one-class distribution).
 *  - Non-finite entries are treated as `-Infinity` (zero probability mass)
 *    so a NaN logit cannot poison the normalisation.
 */
export function softmaxNormalise(logits: Float32Array): Float32Array {
  const n = logits.length;
  const out = new Float32Array(n);
  if (n === 0) return out;
  if (n === 1) {
    out[0] = 1;
    return out;
  }

  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = logits[i];
    if (Number.isFinite(v) && v > max) max = v;
  }
  if (!Number.isFinite(max)) {
    // All inputs non-finite — return a uniform distribution as a graceful
    // fallback rather than producing NaNs.
    const u = 1 / n;
    for (let i = 0; i < n; i++) out[i] = u;
    return out;
  }

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = logits[i];
    const e = Number.isFinite(v) ? Math.exp(v - max) : 0;
    out[i] = e;
    sum += e;
  }
  if (sum === 0) {
    const u = 1 / n;
    for (let i = 0; i < n; i++) out[i] = u;
    return out;
  }
  for (let i = 0; i < n; i++) out[i] /= sum;
  return out;
}
