/**
 * Issue #1241 – Final cleanup: verify no WASM feature flags or environment
 * variables remain in the codebase.
 *
 * WASM is the sole activation backend with no opt-out. These tests confirm
 * that the conditional paths and toggle environment variables have been
 * removed entirely.
 */

import { assert, assertEquals } from "@std/assert";
import {
  isWasmActivationAvailable,
  isWasmSquashSupported,
} from "../../src/wasm/mod.ts";

Deno.test({
  name: "No WASM feature flags: WASM activation is unconditionally available",
  fn() {
    assert(
      isWasmActivationAvailable(),
      "WASM activation must be available – there is no JS-only fallback",
    );
  },
});

Deno.test({
  name: "No WASM feature flags: shouldUseWasmBackprop is no longer exported",
  async fn() {
    // Dynamically import mod.ts and verify the old toggle is gone
    // deno-lint-ignore no-explicit-any
    const mod = await import("../../src/wasm/mod.ts") as any;
    assertEquals(
      mod.shouldUseWasmBackprop,
      undefined,
      "shouldUseWasmBackprop should no longer be exported (Issue #1241)",
    );
    assertEquals(
      mod.resetWasmBackpropFlag,
      undefined,
      "resetWasmBackpropFlag should no longer be exported (Issue #1241)",
    );
  },
});

Deno.test({
  name:
    "No WASM feature flags: all standard squash functions are WASM-supported",
  fn() {
    const squashNames = [
      "IDENTITY",
      "ReLU",
      "ReLU6",
      "LeakyReLU",
      "SELU",
      "ELU",
      "LOGISTIC",
      "TANH",
      "HARD_TANH",
      "SOFTSIGN",
      "Softplus",
      "Swish",
      "Mish",
      "GELU",
      "SINE",
      "Cosine",
      "TAN",
      "ArcTan",
      "GAUSSIAN",
      "BENT_IDENTITY",
      "BIPOLAR_SIGMOID",
      "BIPOLAR",
      "STEP",
      "COMPLEMENT",
      "ABSOLUTE",
      "SQUARE",
      "Cube",
      "SQRT",
      "StdInverse",
      "Exponential",
      "LogSigmoid",
      "ISRU",
      "IF",
      "MINIMUM",
      "MAXIMUM",
    ];

    for (const name of squashNames) {
      assert(
        isWasmSquashSupported(name),
        `${name} must be supported by WASM – no JS-only activation path exists`,
      );
    }
  },
});
