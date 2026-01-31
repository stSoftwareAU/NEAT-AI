/**
 * WASM CalculateError Unit Tests
 *
 * Issue #1141 - WASM Migration Phase 9: Implement calculateError() in Rust/WASM
 *
 * These tests verify that the WASM calculateError() produces the same results
 * as the JS-based calculateError() implementations for all 32 standard activation functions.
 */

import { assert } from "@std/assert";
import {
  initWasmActivation,
  isWasmActivationAvailable,
  SquashType,
  wasmCalculateError,
} from "../src/wasm/mod.ts";

// Import JS activation implementations for comparison
import { IDENTITY } from "../src/methods/activations/types/IDENTITY.ts";
import { ReLU } from "../src/methods/activations/types/ReLU.ts";
import { ReLU6 } from "../src/methods/activations/types/ReLU6.ts";
import { LeakyReLU } from "../src/methods/activations/types/LeakyReLU.ts";
import { SELU } from "../src/methods/activations/types/SELU.ts";
import { ELU } from "../src/methods/activations/types/ELU.ts";
import { LOGISTIC } from "../src/methods/activations/types/LOGISTIC.ts";
import { TANH } from "../src/methods/activations/types/TANH.ts";
import { HARD_TANH } from "../src/methods/activations/types/HARD_TANH.ts";
import { SOFTSIGN } from "../src/methods/activations/types/SOFTSIGN.ts";
import { Softplus } from "../src/methods/activations/types/Softplus.ts";
import { Swish } from "../src/methods/activations/types/Swish.ts";
import { Mish } from "../src/methods/activations/types/Mish.ts";
import { GELU } from "../src/methods/activations/types/GELU.ts";
import { SINE } from "../src/methods/activations/types/SINE.ts";
import { Cosine } from "../src/methods/activations/types/Cosine.ts";
import { TAN } from "../src/methods/activations/types/TAN.ts";
import { ArcTan } from "../src/methods/activations/types/ArcTan.ts";
import { GAUSSIAN } from "../src/methods/activations/types/GAUSSIAN.ts";
import { BENT_IDENTITY } from "../src/methods/activations/types/BENT_IDENTITY.ts";
import { BIPOLAR_SIGMOID } from "../src/methods/activations/types/BIPOLAR_SIGMOID.ts";
import { BIPOLAR } from "../src/methods/activations/types/BIPOLAR.ts";
import { STEP } from "../src/methods/activations/types/STEP.ts";
import { COMPLEMENT } from "../src/methods/activations/types/COMPLEMENT.ts";
import { ABSOLUTE } from "../src/methods/activations/types/ABSOLUTE.ts";
import { SQUARE } from "../src/methods/activations/types/SQUARE.ts";
import { Cube } from "../src/methods/activations/types/Cube.ts";
import { SQRT } from "../src/methods/activations/types/SQRT.ts";
import { StdInverse } from "../src/methods/activations/types/StdInverse.ts";
import { Exponential } from "../src/methods/activations/types/Exponential.ts";
import { LogSigmoid } from "../src/methods/activations/types/LogSigmoid.ts";
import { ISRU } from "../src/methods/activations/types/ISRU.ts";

// Tolerance for floating point comparisons
// WASM uses f32, JS uses f64, so we need some tolerance
const TOLERANCE = 1e-3;

function assertClose(
  actual: number,
  expected: number,
  message?: string,
  tolerance: number = TOLERANCE,
): void {
  const diff = Math.abs(actual - expected);
  const relDiff = expected !== 0 ? diff / Math.abs(expected) : diff;
  // Use relative tolerance for larger values, absolute for smaller
  const effectiveTolerance = Math.max(
    tolerance,
    Math.abs(expected) * tolerance,
  );
  const msg = message
    ? `${message}: expected ${expected}, got ${actual} (diff: ${diff}, relDiff: ${relDiff})`
    : `Expected ${expected}, got ${actual} (diff: ${diff}, relDiff: ${relDiff})`;
  assert(diff < effectiveTolerance, msg);
}

// Initialise WASM before tests
Deno.test({
  name: "WASM CalculateError: Module initialisation",
  async fn() {
    const result = await initWasmActivation();
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

// Test values covering different regions for currentValue
const currentValues = [-5.0, -2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0, 5.0];

// Test cases: [currentActivation, targetActivation] pairs
const errorTestCases: Array<[number, number]> = [
  [0.0, 0.0], // No error
  [0.5, 0.5], // No error
  [0.0, 0.5], // Positive error
  [0.5, 0.0], // Negative error
  [0.2, 0.8], // Large positive error
  [0.8, 0.2], // Large negative error
  [-0.5, 0.5], // Crossing zero
  [0.1, 0.9], // Near extremes
  [0.9, 0.1], // Near extremes reversed
];

Deno.test({
  name: "WASM CalculateError: Identity",
  fn() {
    const jsImpl = new IDENTITY();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const wasmResult = wasmCalculateError(
          SquashType.Identity,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Identity calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: ReLU",
  fn() {
    const jsImpl = new ReLU();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const safeTarget = Math.max(0, targetActivation); // ReLU outputs >= 0
        const wasmResult = wasmCalculateError(
          SquashType.Relu,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `ReLU calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: ReLU6",
  fn() {
    const jsImpl = new ReLU6();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const safeTarget = Math.max(0, Math.min(6, targetActivation * 6));
        const wasmResult = wasmCalculateError(
          SquashType.Relu6,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `ReLU6 calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: LeakyReLU",
  fn() {
    const jsImpl = new LeakyReLU();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const wasmResult = wasmCalculateError(
          SquashType.LeakyRelu,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `LeakyReLU calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: SELU",
  fn() {
    const jsImpl = new SELU();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const wasmResult = wasmCalculateError(
          SquashType.Selu,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `SELU calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: ELU",
  fn() {
    const jsImpl = new ELU();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const wasmResult = wasmCalculateError(
          SquashType.Elu,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `ELU calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: LOGISTIC (Sigmoid)",
  fn() {
    const jsImpl = new LOGISTIC();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // Clamp target to valid sigmoid range
        const safeTarget = Math.max(0.01, Math.min(0.99, targetActivation));
        const wasmResult = wasmCalculateError(
          SquashType.Logistic,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `LOGISTIC calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: TANH",
  fn() {
    const jsImpl = new TANH();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // Scale target to tanh range [-1, 1]
        const safeTarget = Math.max(
          -0.99,
          Math.min(0.99, targetActivation * 2 - 1),
        );
        const wasmResult = wasmCalculateError(
          SquashType.Tanh,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `TANH calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: HardTanh",
  fn() {
    const jsImpl = new HARD_TANH();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const safeTarget = Math.max(-1, Math.min(1, targetActivation * 2 - 1));
        const wasmResult = wasmCalculateError(
          SquashType.HardTanh,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `HardTanh calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Softsign",
  fn() {
    const jsImpl = new SOFTSIGN();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const safeTarget = Math.max(
          -0.99,
          Math.min(0.99, targetActivation * 2 - 1),
        );
        const wasmResult = wasmCalculateError(
          SquashType.Softsign,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Softsign calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Softplus",
  fn() {
    const jsImpl = new Softplus();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const safeTarget = Math.max(0.01, targetActivation + 1);
        const wasmResult = wasmCalculateError(
          SquashType.Softplus,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Softplus calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Swish",
  fn() {
    const jsImpl = new Swish();
    const smallerValues = [-2.0, -1.0, 0.0, 1.0, 2.0];
    for (const currentValue of smallerValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const wasmResult = wasmCalculateError(
          SquashType.Swish,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Swish calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Mish",
  fn() {
    const jsImpl = new Mish();
    const smallerValues = [-2.0, -1.0, 0.0, 1.0, 2.0];
    for (const currentValue of smallerValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const wasmResult = wasmCalculateError(
          SquashType.Mish,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Mish calculateError at currentValue=${currentValue}, target=${targetActivation}`,
          1e-2, // Mish has complex calculations, use larger tolerance
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: GELU",
  fn() {
    const jsImpl = new GELU();
    const smallerValues = [-2.0, -1.0, 0.0, 1.0, 2.0];
    for (const currentValue of smallerValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const wasmResult = wasmCalculateError(
          SquashType.Gelu,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `GELU calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: SINE",
  fn() {
    const jsImpl = new SINE();
    const sineValues = [-1.0, -0.5, 0.0, 0.5, 1.0];
    for (const currentValue of sineValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const safeTarget = Math.max(-1, Math.min(1, targetActivation * 2 - 1));
        const wasmResult = wasmCalculateError(
          SquashType.Sine,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `SINE calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Cosine",
  fn() {
    const jsImpl = new Cosine();
    const cosValues = [-1.0, -0.5, 0.0, 0.5, 1.0];
    for (const currentValue of cosValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const safeTarget = Math.max(-1, Math.min(1, targetActivation * 2 - 1));
        const wasmResult = wasmCalculateError(
          SquashType.Cosine,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Cosine calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: TAN",
  fn() {
    const jsImpl = new TAN();
    // Avoid values near pi/2 where tan is undefined
    const tanValues = [-0.5, -0.25, 0.0, 0.25, 0.5];
    for (const currentValue of tanValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const wasmResult = wasmCalculateError(
          SquashType.Tan,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `TAN calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: ArcTan",
  fn() {
    const jsImpl = new ArcTan();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // ArcTan range is approximately (-pi/2, pi/2) ≈ (-1.57, 1.57)
        const safeTarget = Math.max(-1.5, Math.min(1.5, targetActivation * 2));
        const wasmResult = wasmCalculateError(
          SquashType.ArcTan,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `ArcTan calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: GAUSSIAN",
  fn() {
    const jsImpl = new GAUSSIAN();
    const gaussValues = [-2.0, -1.0, 0.0, 1.0, 2.0];
    for (const currentValue of gaussValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // Gaussian range is (0, 1]
        const safeTarget = Math.max(0.01, Math.min(1, targetActivation));
        const wasmResult = wasmCalculateError(
          SquashType.Gaussian,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `GAUSSIAN calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: BentIdentity",
  fn() {
    const jsImpl = new BENT_IDENTITY();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const wasmResult = wasmCalculateError(
          SquashType.BentIdentity,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `BentIdentity calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: BipolarSigmoid",
  fn() {
    const jsImpl = new BIPOLAR_SIGMOID();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // BipolarSigmoid range is (-1, 1)
        const safeTarget = Math.max(
          -0.99,
          Math.min(0.99, targetActivation * 2 - 1),
        );
        const wasmResult = wasmCalculateError(
          SquashType.BipolarSigmoid,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `BipolarSigmoid calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Bipolar",
  fn() {
    const jsImpl = new BIPOLAR();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      // Bipolar only outputs -1 or 1
      for (const targetActivation of [-1.0, 1.0]) {
        const wasmResult = wasmCalculateError(
          SquashType.Bipolar,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Bipolar calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Step",
  fn() {
    const jsImpl = new STEP();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      // Step only outputs 0 or 1
      for (const targetActivation of [0.0, 1.0]) {
        const wasmResult = wasmCalculateError(
          SquashType.Step,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Step calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Complement",
  fn() {
    const jsImpl = new COMPLEMENT();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const wasmResult = wasmCalculateError(
          SquashType.Complement,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Complement calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Absolute",
  fn() {
    const jsImpl = new ABSOLUTE();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // Absolute only outputs >= 0
        const safeTarget = Math.abs(targetActivation);
        const wasmResult = wasmCalculateError(
          SquashType.Absolute,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Absolute calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Square",
  fn() {
    const jsImpl = new SQUARE();
    const smallerValues = [-2.0, -1.0, 0.0, 1.0, 2.0];
    for (const currentValue of smallerValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // Square only outputs >= 0
        const safeTarget = Math.abs(targetActivation);
        const wasmResult = wasmCalculateError(
          SquashType.Square,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Square calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Cube",
  fn() {
    const jsImpl = new Cube();
    const smallerValues = [-2.0, -1.0, 0.0, 1.0, 2.0];
    for (const currentValue of smallerValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const wasmResult = wasmCalculateError(
          SquashType.Cube,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Cube calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Sqrt",
  fn() {
    const jsImpl = new SQRT();
    // Only test positive values for sqrt
    const sqrtValues = [0.1, 0.5, 1.0, 2.0, 4.0];
    for (const currentValue of sqrtValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // Sqrt only outputs >= 0
        const safeTarget = Math.max(0, targetActivation);
        const wasmResult = wasmCalculateError(
          SquashType.Sqrt,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Sqrt calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: StdInverse",
  fn() {
    const jsImpl = new StdInverse();
    // Avoid values near zero where StdInverse explodes
    const stdInvValues = [-5.0, -2.0, -1.0, 1.0, 2.0, 5.0];
    for (const currentValue of stdInvValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // StdInverse range is (0, 1]
        const safeTarget = Math.max(0.01, Math.min(0.99, targetActivation));
        const wasmResult = wasmCalculateError(
          SquashType.StdInverse,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `StdInverse calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Exponential",
  fn() {
    const jsImpl = new Exponential();
    // Limit range to avoid overflow
    const expValues = [-2.0, -1.0, 0.0, 1.0, 2.0];
    for (const currentValue of expValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // Exponential only outputs > 0
        const safeTarget = Math.max(0.01, targetActivation + 1);
        const wasmResult = wasmCalculateError(
          SquashType.Exponential,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Exponential calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: LogSigmoid",
  fn() {
    const jsImpl = new LogSigmoid();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // LogSigmoid range is (-inf, 0)
        const safeTarget = Math.min(-0.01, targetActivation - 1);
        const wasmResult = wasmCalculateError(
          SquashType.LogSigmoid,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `LogSigmoid calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: ISRU",
  fn() {
    const jsImpl = new ISRU();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // ISRU range is (-1, 1)
        const safeTarget = Math.max(
          -0.99,
          Math.min(0.99, targetActivation * 2 - 1),
        );
        const wasmResult = wasmCalculateError(
          SquashType.Isru,
          activation,
          safeTarget,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          safeTarget,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `ISRU calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

// Test aggregate functions return 0 (they don't have traditional calculateError)
Deno.test({
  name: "WASM CalculateError: Aggregate functions return 0",
  fn() {
    for (const currentValue of currentValues) {
      for (const [currentActivation, targetActivation] of errorTestCases) {
        const minResult = wasmCalculateError(
          SquashType.Minimum,
          currentActivation,
          targetActivation,
          currentValue,
        );
        assertClose(minResult, 0.0, `Minimum calculateError should return 0`);

        const maxResult = wasmCalculateError(
          SquashType.Maximum,
          currentActivation,
          targetActivation,
          currentValue,
        );
        assertClose(maxResult, 0.0, `Maximum calculateError should return 0`);

        const ifResult = wasmCalculateError(
          SquashType.If,
          currentActivation,
          targetActivation,
          currentValue,
        );
        assertClose(ifResult, 0.0, `If calculateError should return 0`);
      }
    }
  },
});

// Test that error clamping works
Deno.test({
  name: "WASM CalculateError: Error clamping",
  fn() {
    // Test with values that would produce very large errors
    const largeErrorResult = wasmCalculateError(
      SquashType.Identity,
      0.0,
      1000.0,
      0.0,
    );
    assert(
      Math.abs(largeErrorResult) <= 100,
      `Error should be clamped to ±100, got ${largeErrorResult}`,
    );

    const negLargeErrorResult = wasmCalculateError(
      SquashType.Identity,
      1000.0,
      0.0,
      1000.0,
    );
    assert(
      Math.abs(negLargeErrorResult) <= 100,
      `Negative error should be clamped to ±100, got ${negLargeErrorResult}`,
    );
  },
});

// Test that tiny errors return 0
Deno.test({
  name: "WASM CalculateError: Tiny errors return 0",
  fn() {
    // Test with values that produce very small errors (< ERROR_EPSILON = 1e-6)
    const tinyErrorResult = wasmCalculateError(
      SquashType.Identity,
      0.5,
      0.5 + 1e-8,
      0.5,
    );
    assertClose(
      tinyErrorResult,
      0.0,
      "Tiny error should return 0",
    );
  },
});

// Comprehensive test comparing WASM and JS implementations
Deno.test({
  name: "WASM CalculateError: Comprehensive comparison with JS implementations",
  fn() {
    const implementations: Array<{
      name: string;
      squashType: SquashType;
      jsImpl: {
        squash: (x: number) => number;
        calculateError: (a: number, b: number, c: number) => number;
      };
      testValues: number[];
      targetTransform?: (t: number) => number;
      tolerance?: number;
    }> = [
      {
        name: "IDENTITY",
        squashType: SquashType.Identity,
        jsImpl: new IDENTITY(),
        testValues: currentValues,
      },
      {
        name: "ReLU",
        squashType: SquashType.Relu,
        jsImpl: new ReLU(),
        testValues: currentValues,
        targetTransform: (t) => Math.max(0, t),
      },
      {
        name: "LeakyReLU",
        squashType: SquashType.LeakyRelu,
        jsImpl: new LeakyReLU(),
        testValues: currentValues,
      },
      {
        name: "TANH",
        squashType: SquashType.Tanh,
        jsImpl: new TANH(),
        testValues: currentValues,
        targetTransform: (t) => Math.max(-0.99, Math.min(0.99, t * 2 - 1)),
      },
      {
        name: "LOGISTIC",
        squashType: SquashType.Logistic,
        jsImpl: new LOGISTIC(),
        testValues: currentValues,
        targetTransform: (t) => Math.max(0.01, Math.min(0.99, t)),
      },
      {
        name: "COMPLEMENT",
        squashType: SquashType.Complement,
        jsImpl: new COMPLEMENT(),
        testValues: currentValues,
      },
    ];

    let totalTests = 0;
    let passedTests = 0;

    for (
      const {
        name,
        squashType,
        jsImpl,
        testValues: vals,
        targetTransform,
        tolerance,
      } of implementations
    ) {
      for (const currentValue of vals) {
        const activation = jsImpl.squash(currentValue);
        for (const [_, targetActivation] of errorTestCases) {
          totalTests++;
          try {
            const safeTarget = targetTransform
              ? targetTransform(targetActivation)
              : targetActivation;
            const wasmResult = wasmCalculateError(
              squashType,
              activation,
              safeTarget,
              currentValue,
            );
            const jsResult = jsImpl.calculateError(
              activation,
              safeTarget,
              currentValue,
            );
            assertClose(
              wasmResult,
              jsResult,
              `${name} calculateError at currentValue=${currentValue}, target=${safeTarget}`,
              tolerance ?? TOLERANCE,
            );
            passedTests++;
          } catch (e) {
            console.error(`Failed: ${name} at currentValue=${currentValue}`, e);
          }
        }
      }
    }

    console.log(`Comprehensive test: ${passedTests}/${totalTests} passed`);
    assert(
      passedTests === totalTests,
      `All tests should pass: ${passedTests}/${totalTests}`,
    );
  },
});
