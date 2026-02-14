/**
 * Unit tests for activation function squash/unSquash roundtrip correctness.
 *
 * For each activation that implements both squash and unSquash, verify:
 *   unSquash(squash(x)) ≈ x  (within numerical tolerance)
 *
 * Some activations are not invertible (e.g. STEP, BIPOLAR) or lose sign
 * information (ABSOLUTE, SQUARE, GAUSSIAN). These are tested with
 * appropriate constraints.
 *
 * @module
 */

import { assertAlmostEquals } from "@std/assert";
import { Activations } from "../../../src/methods/activations/Activations.ts";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";
import type { UnSquashInterface } from "../../../src/methods/activations/UnSquashInterface.ts";
import { hasUnSquash } from "../../../src/methods/activations/TypeGuards.ts";

/**
 * Activations with straightforward invertibility where
 * unSquash(squash(x)) ≈ x for a wide range of inputs.
 */
const INVERTIBLE_ACTIVATIONS: {
  name: string;
  inputs: number[];
  tolerance: number;
}[] = [
  {
    name: "ArcTan",
    inputs: [-3, -1, -0.5, 0, 0.5, 1, 3],
    tolerance: 1e-6,
  },
  {
    name: "BENT_IDENTITY",
    inputs: [-5, -1, 0, 1, 5],
    tolerance: 1e-6,
  },
  {
    name: "COMPLEMENT",
    inputs: [-5, -1, 0, 1, 5],
    tolerance: 1e-10,
  },
  {
    name: "ELU",
    inputs: [-2, -0.5, 0.5, 1, 5],
    tolerance: 1e-6,
  },
  {
    name: "Exponential",
    inputs: [-5, -1, 0, 1, 5, 10],
    tolerance: 1e-6,
  },
  {
    name: "HARD_TANH",
    inputs: [-0.9, -0.5, 0, 0.5, 0.9],
    tolerance: 1e-10,
  },
  {
    name: "IDENTITY",
    inputs: [-100, -1, 0, 1, 100],
    tolerance: 1e-10,
  },
  {
    name: "ISRU",
    inputs: [-2, -0.5, 0, 0.5, 2],
    tolerance: 1e-6,
  },
  {
    name: "LeakyReLU",
    inputs: [-5, -1, 0, 0.5, 1, 5],
    tolerance: 1e-6,
  },
  {
    name: "LOGISTIC",
    inputs: [-5, -1, 0, 1, 5],
    tolerance: 1e-6,
  },
  {
    name: "LogSigmoid",
    inputs: [-5, -1, 0, 1, 5],
    tolerance: 1e-5,
  },
  {
    name: "Mish",
    inputs: [-2, -0.5, 0, 0.5, 2],
    tolerance: 1e-5,
  },
  {
    name: "ReLU",
    inputs: [0.1, 1, 5, 10],
    tolerance: 1e-10,
  },
  {
    name: "ReLU6",
    inputs: [0.5, 1, 3, 5.5],
    tolerance: 1e-10,
  },
  {
    name: "SELU",
    inputs: [-2, -0.5, 0.5, 1, 5],
    tolerance: 1e-5,
  },
  {
    name: "Softplus",
    inputs: [-5, -1, 0, 1, 5],
    tolerance: 1e-5,
  },
  {
    name: "SOFTSIGN",
    inputs: [-5, -1, 0, 1, 5],
    tolerance: 1e-5,
  },
  {
    name: "StdInverse",
    inputs: [-5, -1, 0, 1, 5],
    tolerance: 1e-5,
  },
  {
    name: "Swish",
    inputs: [-2, -0.5, 0.5, 1, 3],
    tolerance: 1e-5,
  },
  {
    name: "TANH",
    inputs: [-3, -1, -0.5, 0, 0.5, 1, 3],
    tolerance: 1e-5,
  },
  {
    name: "BIPOLAR_SIGMOID",
    inputs: [-3, -1, 0, 1, 3],
    tolerance: 1e-5,
  },
  {
    name: "GELU",
    inputs: [-1, -0.5, 0, 0.5, 1, 3],
    tolerance: 1e-4,
  },
];

for (const { name, inputs, tolerance } of INVERTIBLE_ACTIVATIONS) {
  Deno.test(`${name}: squash/unSquash roundtrip`, () => {
    const activation = Activations.find(name);
    if (!hasUnSquash(activation)) return;

    const squashFn = activation as unknown as ActivationInterface;

    for (const x of inputs) {
      const squashed = squashFn.squash(x);
      const roundTripped = (activation as unknown as UnSquashInterface)
        .unSquash(squashed, x);
      assertAlmostEquals(
        roundTripped,
        x,
        tolerance,
        `${name}: unSquash(squash(${x})) = ${roundTripped}, expected ≈ ${x}`,
      );
    }
  });
}

// --- Periodic functions: SINE and Cosine ---
// These have many-to-one mappings, so roundtrip uses hint

Deno.test("SINE: squash/unSquash roundtrip with hint", () => {
  const activation = Activations.find("SINE") as unknown as
    & ActivationInterface
    & UnSquashInterface;

  const inputs = [-3, -1, 0, 0.5, 1, 2];
  for (const x of inputs) {
    const squashed = activation.squash(x);
    const roundTripped = activation.unSquash(squashed, x);
    assertAlmostEquals(
      roundTripped,
      x,
      1e-6,
      `SINE: unSquash(squash(${x}), ${x}) = ${roundTripped}, expected ≈ ${x}`,
    );
  }
});

Deno.test("Cosine: squash/unSquash roundtrip with hint", () => {
  const activation = Activations.find("Cosine") as unknown as
    & ActivationInterface
    & UnSquashInterface;

  const inputs = [-2, -1, 0, 0.5, 1, 2];
  for (const x of inputs) {
    const squashed = activation.squash(x);
    const roundTripped = activation.unSquash(squashed, x);
    assertAlmostEquals(
      roundTripped,
      x,
      1e-6,
      `Cosine: unSquash(squash(${x}), ${x}) = ${roundTripped}, expected ≈ ${x}`,
    );
  }
});

Deno.test("TAN: squash/unSquash roundtrip within period", () => {
  const activation = Activations.find("TAN") as unknown as
    & ActivationInterface
    & UnSquashInterface;

  // TAN is periodic; test within (-π/2, π/2)
  const inputs = [-1, -0.5, 0, 0.5, 1];
  for (const x of inputs) {
    const squashed = activation.squash(x);
    const roundTripped = activation.unSquash(squashed, x);
    assertAlmostEquals(
      roundTripped,
      x,
      1e-5,
      `TAN: unSquash(squash(${x}), ${x}) = ${roundTripped}, expected ≈ ${x}`,
    );
  }
});

// --- Sign-ambiguous functions ---

Deno.test("ABSOLUTE: roundtrip preserves magnitude with hint", () => {
  const activation = Activations.find("ABSOLUTE") as unknown as
    & ActivationInterface
    & UnSquashInterface;

  // Positive inputs round-trip exactly
  for (const x of [0, 1, 5]) {
    const squashed = activation.squash(x);
    const roundTripped = activation.unSquash(squashed, x);
    assertAlmostEquals(roundTripped, x, 1e-10);
  }

  // Negative inputs: unSquash with hint preserves sign
  for (const x of [-1, -5]) {
    const squashed = activation.squash(x);
    const roundTripped = activation.unSquash(squashed, x);
    assertAlmostEquals(roundTripped, x, 1e-10);
  }
});

Deno.test("GAUSSIAN: roundtrip for positive inputs with hint", () => {
  const activation = Activations.find("GAUSSIAN") as unknown as
    & ActivationInterface
    & UnSquashInterface;

  for (const x of [0.5, 1, 2]) {
    const squashed = activation.squash(x);
    const roundTripped = activation.unSquash(squashed, x);
    assertAlmostEquals(
      roundTripped,
      x,
      1e-4,
      `GAUSSIAN: unSquash(squash(${x})) ≈ ${x}`,
    );
  }
});

Deno.test("SQUARE: roundtrip for positive inputs", () => {
  const activation = Activations.find("SQUARE") as unknown as
    & ActivationInterface
    & { unSquash(a: number, h?: number): number };

  for (const x of [0, 1, 3, 5]) {
    const squashed = activation.squash(x);
    const roundTripped = activation.unSquash(squashed, x);
    assertAlmostEquals(
      roundTripped,
      x,
      1e-6,
      `SQUARE: unSquash(squash(${x})) ≈ ${x}`,
    );
  }

  // Negative inputs need hint to preserve sign
  for (const x of [-1, -3]) {
    const squashed = activation.squash(x);
    const roundTripped = activation.unSquash(squashed, x);
    assertAlmostEquals(
      roundTripped,
      x,
      1e-6,
      `SQUARE: unSquash(squash(${x}), hint=${x}) ≈ ${x}`,
    );
  }
});

Deno.test("SQRT: roundtrip for non-negative inputs", () => {
  const activation = Activations.find("SQRT") as unknown as
    & ActivationInterface
    & UnSquashInterface;

  for (const x of [0, 0.25, 1, 4, 9]) {
    const squashed = activation.squash(x);
    const roundTripped = activation.unSquash(squashed, x);
    assertAlmostEquals(
      roundTripped,
      x,
      1e-6,
      `SQRT: unSquash(squash(${x})) ≈ ${x}`,
    );
  }
});

// --- Step functions: not truly invertible ---

Deno.test("BIPOLAR: squash produces correct output", () => {
  const activation = Activations.find("BIPOLAR") as unknown as
    & ActivationInterface
    & UnSquashInterface;

  // Positive → 1, negative → -1
  assertAlmostEquals(activation.squash(5), 1, 0);
  assertAlmostEquals(activation.squash(-5), -1, 0);
  assertAlmostEquals(activation.squash(0), -1, 0); // x > 0 is condition
});

Deno.test("BIPOLAR: unSquash returns hint when sign matches", () => {
  const activation = Activations.find("BIPOLAR") as unknown as
    & ActivationInterface
    & UnSquashInterface;

  assertAlmostEquals(activation.unSquash(1, 3), 3, 0);
  assertAlmostEquals(activation.unSquash(-1, -3), -3, 0);
});

Deno.test("STEP: squash produces correct output", () => {
  const activation = Activations.find("STEP") as unknown as ActivationInterface;

  assertAlmostEquals(activation.squash(5), 1, 0);
  assertAlmostEquals(activation.squash(-5), 0, 0);
  assertAlmostEquals(activation.squash(0), 0, 0);
});
