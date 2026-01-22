/**
 * WASM Range Validation Tests
 *
 * Issue #1142 - WASM Migration Phase 10: Implement range validation in Rust/WASM
 *
 * These tests verify that the WASM range validation functions match the
 * TypeScript ActivationRange implementations for all activation functions.
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { Activations } from "../../src/methods/activations/Activations.ts";
import {
  initWasmActivation,
  isWasmActivationAvailable,
  wasmGetRange,
  wasmLimitRange,
  wasmValidateRange,
} from "../../src/wasm/WasmActivation.ts";
import { SquashType } from "../../src/wasm/SquashType.ts";

// Initialise WASM module before tests
const wasmPath = new URL("../../wasm_activation/pkg", import.meta.url).pathname;
await initWasmActivation(wasmPath);

/**
 * Maps TypeScript activation names to SquashType enum values
 */
const activationToSquashType: Record<string, SquashType> = {
  IDENTITY: SquashType.Identity,
  ReLU: SquashType.Relu,
  ReLU6: SquashType.Relu6,
  LeakyReLU: SquashType.LeakyRelu,
  SELU: SquashType.Selu,
  ELU: SquashType.Elu,
  LOGISTIC: SquashType.Logistic,
  TANH: SquashType.Tanh,
  HARD_TANH: SquashType.HardTanh,
  SOFTSIGN: SquashType.Softsign,
  Softplus: SquashType.Softplus,
  Swish: SquashType.Swish,
  Mish: SquashType.Mish,
  GELU: SquashType.Gelu,
  SINE: SquashType.Sine,
  Cosine: SquashType.Cosine,
  TAN: SquashType.Tan,
  ArcTan: SquashType.ArcTan,
  GAUSSIAN: SquashType.Gaussian,
  BENT_IDENTITY: SquashType.BentIdentity,
  BIPOLAR_SIGMOID: SquashType.BipolarSigmoid,
  BIPOLAR: SquashType.Bipolar,
  STEP: SquashType.Step,
  COMPLEMENT: SquashType.Complement,
  ABSOLUTE: SquashType.Absolute,
  SQUARE: SquashType.Square,
  Cube: SquashType.Cube,
  SQRT: SquashType.Sqrt,
  StdInverse: SquashType.StdInverse,
  Exponential: SquashType.Exponential,
  LogSigmoid: SquashType.LogSigmoid,
  ISRU: SquashType.Isru,
  MINIMUM: SquashType.Minimum,
  MAXIMUM: SquashType.Maximum,
  IF: SquashType.If,
};

Deno.test("WASM Range Validation - Module is available", () => {
  assertEquals(
    isWasmActivationAvailable(),
    true,
    "WASM module should be available",
  );
});

Deno.test("WASM Range Validation - get_range matches TypeScript for all activations", () => {
  // Test bounded activations that should have exact range matches
  const boundedActivations = [
    "LOGISTIC", // [0, 1]
    "TANH", // [-1, 1]
    "HARD_TANH", // [-1, 1]
    "SINE", // [-1, 1]
    "Cosine", // [-1, 1]
    "GAUSSIAN", // [0, 1]
    "STEP", // [0, 1]
    "BIPOLAR_SIGMOID", // [-1, 1]
    "BIPOLAR", // [-1, 1]
    "ISRU", // [-1, 1]
    "ReLU6", // [0, 6]
    "ArcTan", // [-π/2, π/2]
  ];

  for (const name of boundedActivations) {
    const activation = Activations.find(name);
    const squashType = activationToSquashType[name];

    if (squashType === undefined) {
      continue;
    }

    const tsRange = activation.range;
    const wasmRange = wasmGetRange(squashType);

    const tolerance = 1e-5;

    assertAlmostEquals(
      wasmRange.low,
      tsRange.low,
      tolerance,
      `${name}: low bound mismatch (TS: ${tsRange.low}, WASM: ${wasmRange.low})`,
    );

    assertAlmostEquals(
      wasmRange.high,
      tsRange.high,
      tolerance,
      `${name}: high bound mismatch (TS: ${tsRange.high}, WASM: ${wasmRange.high})`,
    );
  }

  // Test unbounded activations - they should have very large bounds in WASM
  const unboundedActivations = [
    "IDENTITY",
    "LeakyReLU",
    "TAN",
    "BENT_IDENTITY",
    "COMPLEMENT",
    "Cube",
    "StdInverse",
  ];

  for (const name of unboundedActivations) {
    const squashType = activationToSquashType[name];
    if (squashType === undefined) continue;

    const wasmRange = wasmGetRange(squashType);

    assertEquals(
      wasmRange.low < -1e30,
      true,
      `${name}: low bound should be very negative (got ${wasmRange.low})`,
    );
    assertEquals(
      wasmRange.high > 1e30,
      true,
      `${name}: high bound should be very positive (got ${wasmRange.high})`,
    );
  }

  // Test one-sided unbounded [0, inf)
  const oneSidedUnbounded = [
    "ReLU",
    "ABSOLUTE",
    "SQUARE",
    "SQRT",
    "Exponential",
  ];

  for (const name of oneSidedUnbounded) {
    const squashType = activationToSquashType[name];
    if (squashType === undefined) continue;

    const wasmRange = wasmGetRange(squashType);

    assertEquals(
      wasmRange.low >= 0,
      true,
      `${name}: low bound should be >= 0 (got ${wasmRange.low})`,
    );
    assertEquals(
      wasmRange.high > 1e30,
      true,
      `${name}: high bound should be very positive (got ${wasmRange.high})`,
    );
  }
});

Deno.test("WASM Range Validation - validate_range returns true for valid activations", () => {
  const testCases: Array<{ squashType: SquashType; value: number }> = [
    // LOGISTIC [0, 1]
    { squashType: SquashType.Logistic, value: 0.5 },
    { squashType: SquashType.Logistic, value: 0 },
    { squashType: SquashType.Logistic, value: 1 },
    // TANH [-1, 1]
    { squashType: SquashType.Tanh, value: 0 },
    { squashType: SquashType.Tanh, value: -0.5 },
    { squashType: SquashType.Tanh, value: 0.9 },
    // ReLU [0, inf]
    { squashType: SquashType.Relu, value: 0 },
    { squashType: SquashType.Relu, value: 100 },
    // ReLU6 [0, 6]
    { squashType: SquashType.Relu6, value: 3 },
    { squashType: SquashType.Relu6, value: 0 },
    { squashType: SquashType.Relu6, value: 6 },
    // GAUSSIAN [0, 1]
    { squashType: SquashType.Gaussian, value: 0.5 },
    // ArcTan [-π/2, π/2]
    { squashType: SquashType.ArcTan, value: 0 },
    { squashType: SquashType.ArcTan, value: 1 },
    // STEP [0, 1]
    { squashType: SquashType.Step, value: 0 },
    { squashType: SquashType.Step, value: 1 },
    // IDENTITY - unbounded
    { squashType: SquashType.Identity, value: -1000 },
    { squashType: SquashType.Identity, value: 1000 },
  ];

  for (const { squashType, value } of testCases) {
    const result = wasmValidateRange(squashType, value);
    assertEquals(
      result,
      true,
      `Expected validate_range(${SquashType[squashType]}, ${value}) to be true`,
    );
  }
});

Deno.test("WASM Range Validation - validate_range returns false for invalid activations", () => {
  const testCases: Array<{ squashType: SquashType; value: number }> = [
    // LOGISTIC [0, 1] - out of range
    { squashType: SquashType.Logistic, value: -0.1 },
    { squashType: SquashType.Logistic, value: 1.1 },
    // TANH [-1, 1] - out of range
    { squashType: SquashType.Tanh, value: -1.5 },
    { squashType: SquashType.Tanh, value: 1.5 },
    // ReLU [0, inf] - negative
    { squashType: SquashType.Relu, value: -1 },
    // ReLU6 [0, 6] - out of range
    { squashType: SquashType.Relu6, value: -1 },
    { squashType: SquashType.Relu6, value: 7 },
    // GAUSSIAN [0, 1] - out of range
    { squashType: SquashType.Gaussian, value: -0.1 },
    { squashType: SquashType.Gaussian, value: 1.1 },
    // STEP [0, 1] - out of range
    { squashType: SquashType.Step, value: -0.5 },
    { squashType: SquashType.Step, value: 1.5 },
    // NaN and Infinity
    { squashType: SquashType.Logistic, value: NaN },
    { squashType: SquashType.Tanh, value: Infinity },
    { squashType: SquashType.Relu, value: -Infinity },
  ];

  for (const { squashType, value } of testCases) {
    const result = wasmValidateRange(squashType, value);
    assertEquals(
      result,
      false,
      `Expected validate_range(${
        SquashType[squashType]
      }, ${value}) to be false`,
    );
  }
});

Deno.test("WASM Range Validation - limit_range clamps values correctly", () => {
  const testCases: Array<{
    squashType: SquashType;
    value: number;
    expected: number;
  }> = [
    // LOGISTIC [0, 1]
    { squashType: SquashType.Logistic, value: 0.5, expected: 0.5 },
    { squashType: SquashType.Logistic, value: -0.1, expected: 0 },
    { squashType: SquashType.Logistic, value: 1.5, expected: 1 },
    // TANH [-1, 1]
    { squashType: SquashType.Tanh, value: 0, expected: 0 },
    { squashType: SquashType.Tanh, value: -2, expected: -1 },
    { squashType: SquashType.Tanh, value: 2, expected: 1 },
    // ReLU6 [0, 6]
    { squashType: SquashType.Relu6, value: 3, expected: 3 },
    { squashType: SquashType.Relu6, value: -1, expected: 0 },
    { squashType: SquashType.Relu6, value: 10, expected: 6 },
    // GAUSSIAN [0, 1]
    { squashType: SquashType.Gaussian, value: 0.5, expected: 0.5 },
    { squashType: SquashType.Gaussian, value: -1, expected: 0 },
    { squashType: SquashType.Gaussian, value: 2, expected: 1 },
    // Infinity handling
    { squashType: SquashType.Logistic, value: Infinity, expected: 1 },
    { squashType: SquashType.Logistic, value: -Infinity, expected: 0 },
    { squashType: SquashType.Tanh, value: Infinity, expected: 1 },
    { squashType: SquashType.Tanh, value: -Infinity, expected: -1 },
  ];

  for (const { squashType, value, expected } of testCases) {
    const result = wasmLimitRange(squashType, value);
    assertAlmostEquals(
      result,
      expected,
      1e-6,
      `limit_range(${
        SquashType[squashType]
      }, ${value}) should be ${expected}, got ${result}`,
    );
  }
});

Deno.test("WASM Range Validation - limit_range matches TypeScript range.limit()", () => {
  // Test with finite values - these should match exactly
  const finiteTestValues = [-100, -10, -1, -0.5, 0, 0.5, 1, 10, 100];

  // Only test bounded activations for exact matching
  const boundedActivations = [
    "LOGISTIC",
    "TANH",
    "ReLU6",
    "GAUSSIAN",
    "HARD_TANH",
    "BIPOLAR_SIGMOID",
  ];

  for (const name of boundedActivations) {
    const activation = Activations.find(name);
    const squashType = activationToSquashType[name];

    if (squashType === undefined) {
      continue;
    }

    for (const value of finiteTestValues) {
      // Get TypeScript result
      let tsResult: number;
      try {
        tsResult = activation.range.limit(value);
      } catch {
        // TypeScript throws for NaN, skip
        continue;
      }

      const wasmResult = wasmLimitRange(squashType, value);

      // Compare results (both should be finite after clamping)
      if (Number.isFinite(tsResult)) {
        assertAlmostEquals(
          wasmResult,
          tsResult,
          1e-5,
          `${name}.range.limit(${value}): TS=${tsResult}, WASM=${wasmResult}`,
        );
      }
    }
  }

  // Test Infinity handling separately for bounded functions
  // WASM should clamp to the activation bounds
  assertEquals(wasmLimitRange(SquashType.Logistic, Infinity), 1.0);
  assertEquals(wasmLimitRange(SquashType.Logistic, -Infinity), 0.0);
  assertEquals(wasmLimitRange(SquashType.Tanh, Infinity), 1.0);
  assertEquals(wasmLimitRange(SquashType.Tanh, -Infinity), -1.0);
  assertEquals(wasmLimitRange(SquashType.Relu6, Infinity), 6.0);
  assertEquals(wasmLimitRange(SquashType.Relu6, -Infinity), 0.0);
});

Deno.test("WASM Range Validation - aggregate functions have unbounded ranges", () => {
  const aggregateFunctions = [
    SquashType.Minimum,
    SquashType.Maximum,
    SquashType.If,
  ];

  for (const squashType of aggregateFunctions) {
    const range = wasmGetRange(squashType);

    // Aggregate functions should have unbounded ranges
    assertEquals(
      range.low < -1e30,
      true,
      `${SquashType[squashType]} should have very low lower bound`,
    );
    assertEquals(
      range.high > 1e30,
      true,
      `${SquashType[squashType]} should have very high upper bound`,
    );
  }
});

Deno.test("WASM Range Validation - GELU has correct negative lower bound", () => {
  const range = wasmGetRange(SquashType.Gelu);

  // GELU has a minimum around -0.17
  assertAlmostEquals(
    range.low,
    -0.17,
    0.01,
    "GELU lower bound should be approximately -0.17",
  );
});

Deno.test("WASM Range Validation - LogSigmoid has correct range (-inf, 0]", () => {
  const range = wasmGetRange(SquashType.LogSigmoid);

  // LogSigmoid: output is always negative or zero
  assertEquals(
    range.low < -1e30,
    true,
    "LogSigmoid should have very low lower bound",
  );
  assertAlmostEquals(range.high, 0, 1e-5, "LogSigmoid upper bound should be 0");
});

Deno.test("WASM Range Validation - ELU has correct range [-1, inf)", () => {
  const range = wasmGetRange(SquashType.Elu);

  // ELU with alpha=1 has minimum of -1
  assertAlmostEquals(range.low, -1, 1e-5, "ELU lower bound should be -1");
  assertEquals(
    range.high > 1e30,
    true,
    "ELU should have very high upper bound",
  );
});

Deno.test("WASM Range Validation - ArcTan has correct range [-π/2, π/2]", () => {
  const range = wasmGetRange(SquashType.ArcTan);

  assertAlmostEquals(
    range.low,
    -Math.PI / 2,
    1e-5,
    "ArcTan lower bound should be -π/2",
  );
  assertAlmostEquals(
    range.high,
    Math.PI / 2,
    1e-5,
    "ArcTan upper bound should be π/2",
  );
});

Deno.test("WASM Range Validation - Softplus has correct range (0, 100)", () => {
  const range = wasmGetRange(SquashType.Softplus);

  // Softplus has a small positive lower bound (1e-15 in TypeScript) and upper bound (100)
  assertEquals(range.low >= 0, true, "Softplus lower bound should be >= 0");
  // Softplus in TypeScript has upper bound of 100 to prevent overflow
  assertEquals(
    range.high === 100,
    true,
    `Softplus upper bound should be 100, got ${range.high}`,
  );
});

Deno.test("WASM Range Validation - ISRU has correct range [-1, 1]", () => {
  const range = wasmGetRange(SquashType.Isru);

  assertAlmostEquals(range.low, -1, 1e-5, "ISRU lower bound should be -1");
  assertAlmostEquals(range.high, 1, 1e-5, "ISRU upper bound should be 1");
});
