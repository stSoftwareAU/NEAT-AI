/**
 * Issue #1900 - Data fuzzing (noise injection) for training regularisation.
 *
 * Tests that noise is correctly applied to training data buffers,
 * verifying statistical properties of both Gaussian and uniform
 * distributions.
 */
import {
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
  assertNotEquals,
} from "@std/assert";
import { applyNoise } from "@propagate/DataFuzzing.ts";
import { createSeededRng } from "@utils/RandomNumberGenerator.ts";
import { DEFAULT_DATA_FUZZING_CONFIG } from "../../src/config/DataFuzzingConfig.ts";
import { parseDataFuzzing } from "../../src/config/NeatConfigParsers.ts";

// ---------------------------------------------------------------------------
// Config defaults and parsing
// ---------------------------------------------------------------------------

Deno.test("DataFuzzing defaults are disabled", () => {
  assertEquals(DEFAULT_DATA_FUZZING_CONFIG.enabled, false);
  assertEquals(DEFAULT_DATA_FUZZING_CONFIG.inputNoiseScale, 0.01);
  assertEquals(DEFAULT_DATA_FUZZING_CONFIG.outputNoiseScale, 0);
  assertEquals(DEFAULT_DATA_FUZZING_CONFIG.noiseType, "gaussian");
});

Deno.test("DataFuzzing parser applies defaults when undefined", () => {
  const config = parseDataFuzzing(undefined);
  assertEquals(config.enabled, false);
  assertEquals(config.inputNoiseScale, 0.01);
  assertEquals(config.outputNoiseScale, 0);
  assertEquals(config.noiseType, "gaussian");
});

Deno.test("DataFuzzing parser accepts overrides", () => {
  const config = parseDataFuzzing({
    enabled: true,
    inputNoiseScale: 0.05,
    outputNoiseScale: 0.02,
    noiseType: "uniform",
  });
  assertEquals(config.enabled, true);
  assertEquals(config.inputNoiseScale, 0.05);
  assertEquals(config.outputNoiseScale, 0.02);
  assertEquals(config.noiseType, "uniform");
});

Deno.test("DataFuzzing parser coerces numeric strings", () => {
  const config = parseDataFuzzing({
    inputNoiseScale: "0.03",
    outputNoiseScale: "0.01",
  });
  assertEquals(config.inputNoiseScale, 0.03);
  assertEquals(config.outputNoiseScale, 0.01);
});

Deno.test("DataFuzzing parser defaults noiseType to gaussian for invalid value", () => {
  const config = parseDataFuzzing({
    noiseType: "invalid",
  });
  assertEquals(config.noiseType, "gaussian");
});

// ---------------------------------------------------------------------------
// applyNoise - zero scale does nothing
// ---------------------------------------------------------------------------

Deno.test("applyNoise with scale=0 does not modify buffer", () => {
  const rng = createSeededRng(42);
  const buffer = new Float32Array([1.0, 2.0, 3.0]);
  const original = new Float32Array(buffer);

  applyNoise(buffer, 0, "gaussian", rng);
  assertEquals(buffer, original);

  applyNoise(buffer, 0, "uniform", rng);
  assertEquals(buffer, original);
});

// ---------------------------------------------------------------------------
// applyNoise - Gaussian statistical properties
// ---------------------------------------------------------------------------

Deno.test("Gaussian noise has mean near zero and std dev matching scale", () => {
  const rng = createSeededRng(123);
  const scale = 0.1;
  const N = 10_000;
  const buffer = new Float32Array(N).fill(0);

  applyNoise(buffer, scale, "gaussian", rng);

  // Compute mean and standard deviation of the noise (which is the buffer values
  // since we started with zeros).
  let sum = 0;
  for (let i = 0; i < N; i++) {
    sum += buffer[i];
  }
  const mean = sum / N;

  let varianceSum = 0;
  for (let i = 0; i < N; i++) {
    const diff = buffer[i] - mean;
    varianceSum += diff * diff;
  }
  const stdDev = Math.sqrt(varianceSum / N);

  // Mean should be near zero (within ~3 standard errors).
  const standardError = scale / Math.sqrt(N);
  assertLess(Math.abs(mean), 3 * standardError);

  // Std dev should be close to the scale parameter.
  assertAlmostEquals(stdDev, scale, 0.02);
});

Deno.test("Gaussian noise modifies buffer values", () => {
  const rng = createSeededRng(99);
  const buffer = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0]);
  const original = new Float32Array(buffer);

  applyNoise(buffer, 0.1, "gaussian", rng);

  // At least one value should differ
  let anyDifferent = false;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] !== original[i]) {
      anyDifferent = true;
      break;
    }
  }
  assertEquals(anyDifferent, true);
});

// ---------------------------------------------------------------------------
// applyNoise - Uniform statistical properties
// ---------------------------------------------------------------------------

Deno.test("Uniform noise is bounded within [-scale, +scale]", () => {
  const rng = createSeededRng(456);
  const scale = 0.5;
  const N = 10_000;
  const buffer = new Float32Array(N).fill(0);

  applyNoise(buffer, scale, "uniform", rng);

  for (let i = 0; i < N; i++) {
    assertGreater(buffer[i], -scale - 1e-7);
    assertLess(buffer[i], scale + 1e-7);
  }
});

Deno.test("Uniform noise has mean near zero", () => {
  const rng = createSeededRng(789);
  const scale = 0.1;
  const N = 10_000;
  const buffer = new Float32Array(N).fill(0);

  applyNoise(buffer, scale, "uniform", rng);

  let sum = 0;
  for (let i = 0; i < N; i++) {
    sum += buffer[i];
  }
  const mean = sum / N;

  // Uniform [-s, s] has std dev = s / sqrt(3) ≈ 0.0577 for s=0.1
  const stdDev = scale / Math.sqrt(3);
  const standardError = stdDev / Math.sqrt(N);
  assertLess(Math.abs(mean), 3 * standardError);
});

// ---------------------------------------------------------------------------
// applyNoise - odd-length buffer handling for Gaussian
// ---------------------------------------------------------------------------

Deno.test("Gaussian noise handles odd-length buffers correctly", () => {
  const rng = createSeededRng(101);
  const buffer = new Float32Array([0, 0, 0]); // odd length

  applyNoise(buffer, 0.5, "gaussian", rng);

  // All elements should have been modified (extremely unlikely all zero with scale=0.5)
  let allZero = true;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] !== 0) {
      allZero = false;
      break;
    }
  }
  assertEquals(allZero, false);
});

// ---------------------------------------------------------------------------
// applyNoise - single-element buffer
// ---------------------------------------------------------------------------

Deno.test("applyNoise handles single-element buffer", () => {
  const rng = createSeededRng(202);
  const buffer = new Float32Array([5.0]);

  applyNoise(buffer, 0.1, "gaussian", rng);
  assertNotEquals(buffer[0], 5.0);
});

// ---------------------------------------------------------------------------
// Reproducibility with seeded RNG
// ---------------------------------------------------------------------------

Deno.test("Noise is reproducible with same seed", () => {
  const scale = 0.1;
  const N = 100;

  const rng1 = createSeededRng(42);
  const buf1 = new Float32Array(N).fill(1.0);
  applyNoise(buf1, scale, "gaussian", rng1);

  const rng2 = createSeededRng(42);
  const buf2 = new Float32Array(N).fill(1.0);
  applyNoise(buf2, scale, "gaussian", rng2);

  assertEquals(buf1, buf2);
});

Deno.test("Different seeds produce different noise", () => {
  const scale = 0.1;
  const N = 100;

  const rng1 = createSeededRng(42);
  const buf1 = new Float32Array(N).fill(1.0);
  applyNoise(buf1, scale, "gaussian", rng1);

  const rng2 = createSeededRng(43);
  const buf2 = new Float32Array(N).fill(1.0);
  applyNoise(buf2, scale, "gaussian", rng2);

  // Buffers should differ
  let anyDifferent = false;
  for (let i = 0; i < N; i++) {
    if (buf1[i] !== buf2[i]) {
      anyDifferent = true;
      break;
    }
  }
  assertEquals(anyDifferent, true);
});
