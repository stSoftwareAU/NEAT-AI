/**
 * Cost → output squash coupling (Issue #2793).
 *
 * The original `new Creature(nIn, nOut)` constructor picks a *random* squash
 * per output neuron and never consults the configured cost function. For
 * classification costs the output activation determines whether the chosen
 * loss can train at all: cross-entropy against a one-hot target needs a
 * bounded `(0, 1)` output, hinge loss needs a bounded `(-1, 1)` margin, and
 * so on. A misaligned random output is a large part of why a fresh
 * `new Creature(784, 10)` trained against CROSS_ENTROPY
 * stalls far below the linear-softmax baseline.
 *
 * This helper centralises the pairing so the constructor (and any other
 * caller that knows the cost in advance) can default the output activation
 * deterministically.
 *
 * Mapping (matches the canonical descriptor table in
 * {@link src/costs/CostDescriptor.ts}):
 *
 * | costName               | outputs | output squash |
 * |------------------------|---------|---------------|
 * | CROSS_ENTROPY          | ≥ 2     | SOFTMAX       |
 * | CROSS_ENTROPY          | 1       | LOGISTIC      |
 * | BINARY_CROSS_ENTROPY   | any ≥ 1 | LOGISTIC      |
 * | HINGE                  | any ≥ 1 | TANH          |
 * | MSE / MAE / MAPE / MSLE| any     | undefined     |
 * | unknown / undefined    | any     | undefined     |
 *
 * Returning `undefined` means "no opinion — leave the existing default in
 * place." That preserves the regression path: `MSE`-trained creatures keep
 * the historical per-output random squash, with no behaviour change.
 *
 * Note: full coupling of the **gradient** to the cost is tracked separately
 * because the gradient lives in the Rust WASM core (`neat-core`). The TS
 * helpers here only handle the **forward-pass activation** half of the
 * pairing, which is sufficient to satisfy the cross-entropy gradient form
 * for SOFTMAX outputs: the WASM core's `(expected − activation)` output
 * delta is already the dL/dz form for softmax + cross-entropy once
 * SOFTMAX-tagged neurons appear in the output layer.
 */

/**
 * Return the canonical output activation name for a given cost / output
 * arity, or `undefined` when the cost has no opinion (regression and
 * custom/unknown costs).
 */
export function pickOutputSquashForCost(
  costName: string | undefined,
  outputCount: number,
): string | undefined {
  if (!costName) return undefined;
  if (!Number.isFinite(outputCount) || outputCount < 1) return undefined;

  switch (costName) {
    case "CROSS_ENTROPY":
      // A genuine multi-class classifier needs ≥ 2 mutually exclusive
      // classes for softmax to mean anything. Degenerate single-output
      // cases collapse to a Bernoulli probability — use LOGISTIC.
      return outputCount >= 2 ? "SOFTMAX" : "LOGISTIC";

    case "BINARY_CROSS_ENTROPY":
      // Independent per-output probability heads — sigmoid is the natural
      // pairing whether one head or many.
      return "LOGISTIC";

    case "HINGE":
      // Margin classifier: bounded bipolar output.
      return "TANH";

    case "MSE":
    case "MAE":
    case "MAPE":
    case "MSLE":
      // Regression — no forced activation; preserve the legacy per-output
      // random squash so this issue does not regress regression behaviour.
      return undefined;

    default:
      return undefined;
  }
}
