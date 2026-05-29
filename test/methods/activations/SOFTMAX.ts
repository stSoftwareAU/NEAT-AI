/**
 * Tests for SOFTMAX activation (Issue #2793).
 *
 * SOFTMAX is the natural pairing for the CROSS_ENTROPY
 * multi-class cost. The per-neuron `squash(x)` is a logistic-shaped
 * surrogate so it is safe to use in the existing per-neuron WASM forward
 * pass (`wasmAliasName()` returns "LOGISTIC"); the project-canonical
 * vector normalisation lives in {@link softmaxNormalise} for callers that
 * need true probability outputs over an output vector.
 *
 * Acceptance criteria covered by this file:
 *  - Softmax is available and selectable.
 *  - Default options keep regression paths untouched (mutationProbability = 0,
 *    so SOFTMAX is never randomly chosen for hidden neurons).
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Activations } from "@methods/activations/Activations.ts";
import { SOFTMAX } from "@methods/activations/types/SOFTMAX.ts";
import { softmaxNormalise } from "@methods/activations/types/SOFTMAX.ts";
import { SQUASH_NAME_TO_TYPE } from "@wasm/SquashType.ts";

Deno.test("SOFTMAX - registered with Activations and findable by name", () => {
  const activation = Activations.find(SOFTMAX.NAME);
  assert(activation instanceof SOFTMAX, "SOFTMAX must be registered");
});

Deno.test("SOFTMAX - never selected by pickRandomSquash (mutationProbability = 0)", () => {
  const sm = new SOFTMAX();
  assertEquals(
    sm.mutationProbability,
    0,
    "SOFTMAX must not be in the weighted random mutation pool — " +
      "it only makes sense on output layers paired with a multi-class cost.",
  );
  for (let i = 0; i < 500; i++) {
    const name = Activations.pickRandomSquash();
    assert(name !== SOFTMAX.NAME, "SOFTMAX must not appear in random pool");
  }
});

Deno.test("SOFTMAX - per-neuron squash is a logistic surrogate in (0,1)", () => {
  const sm = new SOFTMAX();
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * 12 - 6;
    const y = sm.squash(x);
    assert(y > 0 && y < 1, `squash(${x}) = ${y} must be in (0,1)`);
  }
  // sigmoid(0) = 0.5
  assertAlmostEquals(sm.squash(0), 0.5, 1e-6);
});

Deno.test("SOFTMAX - wasmAliasName routes the WASM forward pass to LOGISTIC", () => {
  const sm = new SOFTMAX();
  assertEquals(sm.wasmAliasName?.(), "LOGISTIC");
  // And LOGISTIC has a valid WASM squash type
  assert("LOGISTIC" in SQUASH_NAME_TO_TYPE);
});

Deno.test("SOFTMAX - calculateError uses the cross-entropy-style raw gradient", () => {
  const sm = new SOFTMAX();
  // For softmax + CE: dL/dz = activation - target (we return target - activation,
  // matching the project's `targetActivation - currentActivation` sign convention).
  // No sigmoid-derivative scaling, unlike LOGISTIC.calculateError.
  const target = 1;
  const current = 0.2;
  const got = sm.calculateError(current, target, 0);
  assertAlmostEquals(got, target - current, 1e-9);
});

Deno.test("SOFTMAX - range is (0, 1) for output-probability use", () => {
  const sm = new SOFTMAX();
  assertEquals(sm.range.low, 0);
  assertEquals(sm.range.high, 1);
});

Deno.test("softmaxNormalise - sums to one and is numerically stable", () => {
  const logits = new Float32Array([1, 2, 3, 4, 5]);
  const probs = softmaxNormalise(logits);
  let sum = 0;
  for (const p of probs) {
    assert(p >= 0 && p <= 1, `probability ${p} out of [0,1]`);
    sum += p;
  }
  assertAlmostEquals(sum, 1, 1e-5);
});

Deno.test("softmaxNormalise - tolerates very large logits without overflow", () => {
  // Without max-subtraction trick, exp(1000) overflows to +Inf and the result
  // becomes NaN. The implementation must subtract the max first.
  const logits = new Float32Array([1000, 1001, 999]);
  const probs = softmaxNormalise(logits);
  let sum = 0;
  for (const p of probs) {
    assert(Number.isFinite(p), `softmaxNormalise produced non-finite: ${p}`);
    sum += p;
  }
  assertAlmostEquals(sum, 1, 1e-5);
  // The largest logit dominates the probability mass.
  assert(probs[1] > probs[0] && probs[1] > probs[2]);
});

Deno.test("softmaxNormalise - one-hot logits round-trip to argmax", () => {
  const logits = new Float32Array([0, 0, 10, 0]);
  const probs = softmaxNormalise(logits);
  let maxIdx = 0;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[maxIdx]) maxIdx = i;
  }
  assertEquals(maxIdx, 2);
});
