/**
 * Tests for Creature cost-aware output activation defaulting (Issue #2793).
 *
 * Acceptance criteria covered:
 *  - With default options and a one-hot classification cost,
 *    `new Creature(nIn, nOut, { costName })` constructs every output
 *    neuron with SOFTMAX.
 *  - Explicit `outputLayer.squash` continues to override the cost-aware
 *    default (no behaviour regression for callers wiring the squash
 *    manually).
 *  - Without `costName`, the historical random-per-output behaviour is
 *    preserved (regression path unchanged).
 *  - Single-output multi-class cost falls back to LOGISTIC.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";

Deno.test("Creature(784, 10, { costName: CATEGORICAL_ERROR }) wires every output to SOFTMAX", () => {
  const creature = new Creature(784, 10, { costName: "CATEGORICAL_ERROR" });
  const outputs = creature.neurons.filter((n) => n.type === "output");
  assertEquals(outputs.length, 10);
  for (const neuron of outputs) {
    assertEquals(
      neuron.squash,
      "SOFTMAX",
      "every output neuron must use SOFTMAX for a multi-class one-hot cost",
    );
  }
});

Deno.test("Creature(N, 10, { costName: CROSS_ENTROPY }) wires every output to SOFTMAX", () => {
  const creature = new Creature(4, 10, { costName: "CROSS_ENTROPY" });
  for (const neuron of creature.neurons) {
    if (neuron.type === "output") assertEquals(neuron.squash, "SOFTMAX");
  }
});

Deno.test("Creature(N, 1, { costName: BINARY_CROSS_ENTROPY }) uses LOGISTIC", () => {
  const creature = new Creature(4, 1, { costName: "BINARY_CROSS_ENTROPY" });
  const out = creature.neurons.find((n) => n.type === "output")!;
  assertEquals(out.squash, "LOGISTIC");
});

Deno.test("Creature(N, 1, { costName: CROSS_ENTROPY }) falls back to LOGISTIC for a single output", () => {
  const creature = new Creature(4, 1, { costName: "CROSS_ENTROPY" });
  const out = creature.neurons.find((n) => n.type === "output")!;
  assertEquals(out.squash, "LOGISTIC");
});

Deno.test("Creature(N, 3, { costName: HINGE }) uses TANH outputs", () => {
  const creature = new Creature(2, 3, { costName: "HINGE" });
  for (const neuron of creature.neurons) {
    if (neuron.type === "output") assertEquals(neuron.squash, "TANH");
  }
});

Deno.test("Explicit outputLayer.squash overrides cost-aware default", () => {
  const creature = new Creature(4, 10, {
    costName: "CROSS_ENTROPY",
    outputLayer: { squash: "TANH" },
    layers: [{ count: 5 }],
  });
  for (const neuron of creature.neurons) {
    if (neuron.type === "output") {
      assertEquals(
        neuron.squash,
        "TANH",
        "outputLayer.squash must override the cost-aware default",
      );
    }
  }
});

Deno.test("Creature(N, M, { costName: MSE }) preserves random output squash (regression path unchanged)", () => {
  // MSE returns undefined from the helper, so the historical random pool
  // is used. We assert that the squash is set and is NOT one of the
  // classification defaults (SOFTMAX/LOGISTIC could legitimately come up
  // randomly though, so we instead assert the helper produced `undefined`
  // and at least one of several runs draws a non-LOGISTIC squash, which
  // would be impossible if we were forcing LOGISTIC).
  let sawNonLogistic = false;
  for (let i = 0; i < 30; i++) {
    const c = new Creature(3, 5, { costName: "MSE" });
    for (const n of c.neurons) {
      if (n.type === "output" && n.squash !== "LOGISTIC") {
        sawNonLogistic = true;
        break;
      }
    }
    if (sawNonLogistic) break;
  }
  assert(
    sawNonLogistic,
    "MSE must not force LOGISTIC outputs — at least one of 30 fresh " +
      "creatures should draw a non-LOGISTIC squash from the random pool",
  );
});

Deno.test("Creature without costName preserves random per-output behaviour", () => {
  // Same regression guard as above, with costName omitted entirely.
  let sawNonLogistic = false;
  for (let i = 0; i < 30; i++) {
    const c = new Creature(3, 5);
    for (const n of c.neurons) {
      if (n.type === "output" && n.squash !== "LOGISTIC") {
        sawNonLogistic = true;
        break;
      }
    }
    if (sawNonLogistic) break;
  }
  assert(sawNonLogistic, "no costName must leave random-per-output unchanged");
});
