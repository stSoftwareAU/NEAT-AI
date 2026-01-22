/**
 * WASM Safe Zone Adjustment Unit Tests
 *
 * Issue #1140 - WASM Migration Phase 8: Implement safeZoneAdjustment() in Rust/WASM
 *
 * These tests verify that the WASM safeZoneAdjustment() produces the same results
 * as the JS-based safeZoneAdjustment() implementations for all activation functions.
 *
 * The safeZoneAdjustment function returns a float from 0 (not safe) to 1 (fully safe)
 * indicating how useful it is to backpropagate through a neuron.
 */

import { assert } from "@std/assert";
import {
  initWasmActivation,
  isWasmActivationAvailable,
  SquashType,
  wasmSafeZoneAdjustment,
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
import { STEP } from "../src/methods/activations/types/STEP.ts";
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
const TOLERANCE = 1e-4;

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

// Get the project root directory for WASM module path
const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

// Initialise WASM before tests
Deno.test({
  name: "WASM SafeZoneAdjustment: Module initialisation",
  async fn() {
    const result = await initWasmActivation(wasmPath);
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

// Test values covering different regions
const testInputs = [
  -20.0,
  -10.0,
  -5.0,
  -2.0,
  -1.0,
  -0.5,
  -0.1,
  0.0,
  0.1,
  0.5,
  1.0,
  2.0,
  5.0,
  10.0,
  20.0,
];

// Error values to test with
const testErrors = [-1.0, -0.5, -0.1, 0.0, 0.1, 0.5, 1.0];

// Weight values to test with
const testWeights = [0.0001, 0.001, 0.01, 0.1, 1.0, 10.0, 100.0, 1000.0];

// Helper interface for testing
interface SafeZoneTestable {
  safeZoneAdjustment(rawInput: number, error: number, weight?: number): number;
}

Deno.test({
  name: "WASM SafeZoneAdjustment: IDENTITY",
  fn() {
    const jsImpl = new IDENTITY();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.Identity,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `IDENTITY safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: ReLU",
  fn() {
    const jsImpl = new ReLU();
    for (const x of testInputs) {
      for (const e of testErrors) {
        // ReLU only uses rawInput and error (no weight)
        const wasmResult = wasmSafeZoneAdjustment(SquashType.Relu, x, e);
        const jsResult = jsImpl.safeZoneAdjustment(x, e);
        assertClose(
          wasmResult,
          jsResult,
          `ReLU safeZoneAdjustment at x=${x}, error=${e}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: ReLU6",
  fn() {
    const jsImpl = new ReLU6();
    // Add values specific to ReLU6 boundaries at 0 and 6
    const values = [...testInputs, 5.5, 5.9, 6.0, 6.1, 7.0];
    for (const x of values) {
      for (const e of testErrors) {
        const wasmResult = wasmSafeZoneAdjustment(SquashType.Relu6, x, e);
        const jsResult = jsImpl.safeZoneAdjustment(x, e);
        assertClose(
          wasmResult,
          jsResult,
          `ReLU6 safeZoneAdjustment at x=${x}, error=${e}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: LeakyReLU",
  fn() {
    const jsImpl = new LeakyReLU();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.LeakyRelu,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `LeakyReLU safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: SELU",
  fn() {
    const jsImpl = new SELU();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Selu, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `SELU safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: ELU",
  fn() {
    const jsImpl = new ELU();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Elu, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `ELU safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: LOGISTIC (Sigmoid)",
  fn() {
    const jsImpl = new LOGISTIC();
    for (const x of testInputs) {
      for (const e of testErrors) {
        const wasmResult = wasmSafeZoneAdjustment(SquashType.Logistic, x, e);
        const jsResult = jsImpl.safeZoneAdjustment(x, e);
        assertClose(
          wasmResult,
          jsResult,
          `LOGISTIC safeZoneAdjustment at x=${x}, error=${e}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: TANH",
  fn() {
    const jsImpl = new TANH();
    for (const x of testInputs) {
      for (const e of testErrors) {
        const wasmResult = wasmSafeZoneAdjustment(SquashType.Tanh, x, e);
        const jsResult = jsImpl.safeZoneAdjustment(x, e);
        assertClose(
          wasmResult,
          jsResult,
          `TANH safeZoneAdjustment at x=${x}, error=${e}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: HardTanh",
  fn() {
    const jsImpl = new HARD_TANH();
    // Add values around the boundaries -1 and 1
    const values = [...testInputs, -1.2, -1.0, -0.9, 0.9, 1.0, 1.2];
    for (const x of values) {
      for (const e of testErrors) {
        const wasmResult = wasmSafeZoneAdjustment(SquashType.HardTanh, x, e);
        const jsResult = jsImpl.safeZoneAdjustment(x, e);
        assertClose(
          wasmResult,
          jsResult,
          `HardTanh safeZoneAdjustment at x=${x}, error=${e}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: Softsign",
  fn() {
    const jsImpl = new SOFTSIGN();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.Softsign,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `Softsign safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: Softplus",
  fn() {
    const jsImpl = new Softplus();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.Softplus,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `Softplus safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: Swish",
  fn() {
    const jsImpl = new Swish();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Swish, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `Swish safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: Mish",
  fn() {
    const jsImpl = new Mish();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Mish, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `Mish safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: GELU",
  fn() {
    const jsImpl = new GELU();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Gelu, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `GELU safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: SINE",
  fn() {
    const jsImpl = new SINE();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Sine, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `SINE safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: Cosine",
  fn() {
    const jsImpl = new Cosine();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Cosine, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `Cosine safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: TAN",
  fn() {
    const jsImpl = new TAN();
    // Avoid values near pi/2 where tan is undefined
    const values = [-1.0, -0.5, 0.0, 0.5, 1.0, 2.0, 3.0];
    for (const x of values) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Tan, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `TAN safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: ArcTan",
  fn() {
    const jsImpl = new ArcTan();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.ArcTan, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `ArcTan safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: GAUSSIAN",
  fn() {
    const jsImpl = new GAUSSIAN();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.Gaussian,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `GAUSSIAN safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: BentIdentity",
  fn() {
    const jsImpl = new BENT_IDENTITY();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.BentIdentity,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `BentIdentity safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: BipolarSigmoid",
  fn() {
    const jsImpl = new BIPOLAR_SIGMOID();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.BipolarSigmoid,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `BipolarSigmoid safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

// BIPOLAR and STEP are discontinuous functions - they should always return 0
// (BIPOLAR has no safeZoneAdjustment in JS, STEP has a special implementation)
Deno.test({
  name: "WASM SafeZoneAdjustment: Bipolar returns 0",
  fn() {
    // Bipolar is discontinuous - should always return 0
    for (const x of testInputs) {
      for (const e of testErrors) {
        const wasmResult = wasmSafeZoneAdjustment(SquashType.Bipolar, x, e);
        assertClose(
          wasmResult,
          0.0,
          `Bipolar safeZoneAdjustment at x=${x}, error=${e}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: Step",
  fn() {
    const jsImpl = new STEP();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Step, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `Step safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: ABSOLUTE",
  fn() {
    const jsImpl = new ABSOLUTE();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.Absolute,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `ABSOLUTE safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: SQUARE",
  fn() {
    const jsImpl = new SQUARE();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Square, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `SQUARE safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: Cube",
  fn() {
    const jsImpl = new Cube();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Cube, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `Cube safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: SQRT",
  fn() {
    const jsImpl = new SQRT();
    // Only test values that make sense for SQRT (mainly positive range)
    const values = [
      -5.0,
      -1.0,
      -0.1,
      0.0,
      0.01,
      0.1,
      0.5,
      1.0,
      5.0,
      10.0,
      20.0,
    ];
    for (const x of values) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Sqrt, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `SQRT safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: StdInverse",
  fn() {
    const jsImpl = new StdInverse();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.StdInverse,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `StdInverse safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: Exponential",
  fn() {
    const jsImpl = new Exponential();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.Exponential,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `Exponential safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: LogSigmoid",
  fn() {
    const jsImpl = new LogSigmoid();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.LogSigmoid,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `LogSigmoid safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: ISRU",
  fn() {
    const jsImpl = new ISRU();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Isru, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `ISRU safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

// Test aggregate functions return 0 (they don't have safeZoneAdjustment in traditional sense)
Deno.test({
  name: "WASM SafeZoneAdjustment: Aggregate functions return 0",
  fn() {
    for (const x of testInputs) {
      for (const e of testErrors) {
        const minResult = wasmSafeZoneAdjustment(SquashType.Minimum, x, e);
        assertClose(minResult, 0.0, `Minimum safeZoneAdjustment at x=${x}`);

        const maxResult = wasmSafeZoneAdjustment(SquashType.Maximum, x, e);
        assertClose(maxResult, 0.0, `Maximum safeZoneAdjustment at x=${x}`);

        const ifResult = wasmSafeZoneAdjustment(SquashType.If, x, e);
        assertClose(ifResult, 0.0, `If safeZoneAdjustment at x=${x}`);
      }
    }
  },
});

// Test COMPLEMENT - doesn't have safeZoneAdjustment in JS, should return 1.0 (never saturates)
Deno.test({
  name: "WASM SafeZoneAdjustment: Complement returns 1.0",
  fn() {
    for (const x of testInputs) {
      for (const e of testErrors) {
        const wasmResult = wasmSafeZoneAdjustment(SquashType.Complement, x, e);
        assertClose(
          wasmResult,
          1.0,
          `Complement safeZoneAdjustment at x=${x}, error=${e}`,
        );
      }
    }
  },
});

// Test non-finite inputs
Deno.test({
  name: "WASM SafeZoneAdjustment: Non-finite inputs return 0",
  fn() {
    const nonFiniteValues = [Infinity, -Infinity, NaN];
    for (const x of nonFiniteValues) {
      for (const e of testErrors) {
        const wasmResult = wasmSafeZoneAdjustment(SquashType.Tanh, x, e);
        assertClose(wasmResult, 0.0, `Non-finite input ${x} should return 0`);
      }
    }
  },
});

// Comprehensive test comparing WASM and JS implementations
Deno.test({
  name: "WASM SafeZoneAdjustment: Comprehensive comparison",
  fn() {
    // Test a subset of combinations for comprehensive coverage
    const testInputSubset = [-10.0, -2.0, 0.0, 2.0, 10.0];
    const testErrorSubset = [-0.5, 0.0, 0.5];
    const testWeightSubset = [0.001, 1.0, 1000.0];

    interface TestCase {
      name: string;
      squashType: SquashType;
      jsImpl: SafeZoneTestable;
      usesWeight: boolean;
    }

    const testCases: TestCase[] = [
      {
        name: "IDENTITY",
        squashType: SquashType.Identity,
        jsImpl: new IDENTITY(),
        usesWeight: true,
      },
      {
        name: "ReLU",
        squashType: SquashType.Relu,
        jsImpl: new ReLU(),
        usesWeight: false,
      },
      {
        name: "ReLU6",
        squashType: SquashType.Relu6,
        jsImpl: new ReLU6(),
        usesWeight: false,
      },
      {
        name: "LeakyReLU",
        squashType: SquashType.LeakyRelu,
        jsImpl: new LeakyReLU(),
        usesWeight: true,
      },
      {
        name: "SELU",
        squashType: SquashType.Selu,
        jsImpl: new SELU(),
        usesWeight: true,
      },
      {
        name: "ELU",
        squashType: SquashType.Elu,
        jsImpl: new ELU(),
        usesWeight: true,
      },
      {
        name: "LOGISTIC",
        squashType: SquashType.Logistic,
        jsImpl: new LOGISTIC(),
        usesWeight: false,
      },
      {
        name: "TANH",
        squashType: SquashType.Tanh,
        jsImpl: new TANH(),
        usesWeight: false,
      },
      {
        name: "HardTanh",
        squashType: SquashType.HardTanh,
        jsImpl: new HARD_TANH(),
        usesWeight: false,
      },
      {
        name: "Softsign",
        squashType: SquashType.Softsign,
        jsImpl: new SOFTSIGN(),
        usesWeight: true,
      },
      {
        name: "Softplus",
        squashType: SquashType.Softplus,
        jsImpl: new Softplus(),
        usesWeight: true,
      },
      {
        name: "Swish",
        squashType: SquashType.Swish,
        jsImpl: new Swish(),
        usesWeight: true,
      },
      {
        name: "Mish",
        squashType: SquashType.Mish,
        jsImpl: new Mish(),
        usesWeight: true,
      },
      {
        name: "GELU",
        squashType: SquashType.Gelu,
        jsImpl: new GELU(),
        usesWeight: true,
      },
      {
        name: "SINE",
        squashType: SquashType.Sine,
        jsImpl: new SINE(),
        usesWeight: true,
      },
      {
        name: "Cosine",
        squashType: SquashType.Cosine,
        jsImpl: new Cosine(),
        usesWeight: true,
      },
      {
        name: "TAN",
        squashType: SquashType.Tan,
        jsImpl: new TAN(),
        usesWeight: true,
      },
      {
        name: "ArcTan",
        squashType: SquashType.ArcTan,
        jsImpl: new ArcTan(),
        usesWeight: true,
      },
      {
        name: "GAUSSIAN",
        squashType: SquashType.Gaussian,
        jsImpl: new GAUSSIAN(),
        usesWeight: true,
      },
      {
        name: "BentIdentity",
        squashType: SquashType.BentIdentity,
        jsImpl: new BENT_IDENTITY(),
        usesWeight: true,
      },
      {
        name: "BipolarSigmoid",
        squashType: SquashType.BipolarSigmoid,
        jsImpl: new BIPOLAR_SIGMOID(),
        usesWeight: true,
      },
      {
        name: "Step",
        squashType: SquashType.Step,
        jsImpl: new STEP(),
        usesWeight: true,
      },
      {
        name: "ABSOLUTE",
        squashType: SquashType.Absolute,
        jsImpl: new ABSOLUTE(),
        usesWeight: true,
      },
      {
        name: "SQUARE",
        squashType: SquashType.Square,
        jsImpl: new SQUARE(),
        usesWeight: true,
      },
      {
        name: "Cube",
        squashType: SquashType.Cube,
        jsImpl: new Cube(),
        usesWeight: true,
      },
      {
        name: "SQRT",
        squashType: SquashType.Sqrt,
        jsImpl: new SQRT(),
        usesWeight: true,
      },
      {
        name: "StdInverse",
        squashType: SquashType.StdInverse,
        jsImpl: new StdInverse(),
        usesWeight: true,
      },
      {
        name: "Exponential",
        squashType: SquashType.Exponential,
        jsImpl: new Exponential(),
        usesWeight: true,
      },
      {
        name: "LogSigmoid",
        squashType: SquashType.LogSigmoid,
        jsImpl: new LogSigmoid(),
        usesWeight: true,
      },
      {
        name: "ISRU",
        squashType: SquashType.Isru,
        jsImpl: new ISRU(),
        usesWeight: true,
      },
    ];

    let totalTests = 0;
    let passedTests = 0;

    for (const { name, squashType, jsImpl, usesWeight } of testCases) {
      for (const x of testInputSubset) {
        for (const e of testErrorSubset) {
          const weights = usesWeight ? testWeightSubset : [1.0];
          for (const w of weights) {
            totalTests++;
            try {
              const wasmResult = wasmSafeZoneAdjustment(squashType, x, e, w);
              const jsResult = usesWeight
                ? jsImpl.safeZoneAdjustment(x, e, w)
                : jsImpl.safeZoneAdjustment(x, e);
              assertClose(
                wasmResult,
                jsResult,
                `${name} at x=${x}, e=${e}, w=${w}`,
              );
              passedTests++;
            } catch (err) {
              console.error(
                `Failed: ${name} at x=${x}, e=${e}, w=${w}`,
                err,
              );
            }
          }
        }
      }
    }

    console.log(
      `Comprehensive SafeZoneAdjustment test: ${passedTests}/${totalTests} passed`,
    );
    assert(
      passedTests === totalTests,
      `All tests should pass: ${passedTests}/${totalTests}`,
    );
  },
});
