import { assert, assertEquals } from "@std/assert";
import {
  calculateDiscoveryTimeout,
  DEFAULT_DISCOVERY_TIMEOUT_BOUNDS,
} from "../../src/discovery/DiscoveryTimeout.ts";

Deno.test("calculateDiscoveryTimeout - minimal creature returns near-minimum timeout", () => {
  const timeout = calculateDiscoveryTimeout({
    neuronCount: 3, // 2 input + 1 output = minimal
    synapseCount: 2,
  });
  assert(
    timeout >= DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.minTimeoutMinutes,
    "Minimal creature timeout should be at least the minimum",
  );
  assert(
    timeout < DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.maxTimeoutMinutes * 0.5,
    `Minimal creature timeout (${timeout}) should be well below half the maximum`,
  );
});

Deno.test("calculateDiscoveryTimeout - complex creature returns higher timeout", () => {
  const simpleTimeout = calculateDiscoveryTimeout({
    neuronCount: 5,
    synapseCount: 4,
  });
  const complexTimeout = calculateDiscoveryTimeout({
    neuronCount: 100,
    synapseCount: 500,
  });

  assert(
    complexTimeout > simpleTimeout,
    `Complex creature timeout (${complexTimeout}) should exceed simple creature timeout (${simpleTimeout})`,
  );
});

Deno.test("calculateDiscoveryTimeout - very complex creature is capped at maximum", () => {
  const timeout = calculateDiscoveryTimeout({
    neuronCount: 10_000,
    synapseCount: 100_000,
  });
  assertEquals(
    timeout,
    DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.maxTimeoutMinutes,
    "Very complex creature should be capped at maximum timeout",
  );
});

Deno.test("calculateDiscoveryTimeout - zero neurons/synapses returns minimum", () => {
  const timeout = calculateDiscoveryTimeout({
    neuronCount: 0,
    synapseCount: 0,
  });
  assertEquals(
    timeout,
    DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.minTimeoutMinutes,
    "Zero-size creature should get minimum timeout",
  );
});

Deno.test("calculateDiscoveryTimeout - scales logarithmically", () => {
  // Doubling complexity should NOT double timeout (logarithmic, not linear)
  const t1 = calculateDiscoveryTimeout({
    neuronCount: 10,
    synapseCount: 20,
  });
  const t2 = calculateDiscoveryTimeout({
    neuronCount: 20,
    synapseCount: 40,
  });
  const t4 = calculateDiscoveryTimeout({
    neuronCount: 40,
    synapseCount: 80,
  });

  // The ratio of increase should diminish (logarithmic property)
  const increase1to2 = t2 - t1;
  const increase2to4 = t4 - t2;

  assert(
    increase2to4 <= increase1to2 * 1.5, // Allow small tolerance
    `Logarithmic scaling: doubling input again should yield diminishing returns. ` +
      `First increase: ${increase1to2.toFixed(4)}, second increase: ${
        increase2to4.toFixed(4)
      }`,
  );
});

Deno.test("calculateDiscoveryTimeout - custom bounds are respected", () => {
  const customMin = 2;
  const customMax = 5;

  const minTimeout = calculateDiscoveryTimeout(
    { neuronCount: 1, synapseCount: 0 },
    { minTimeoutMinutes: customMin, maxTimeoutMinutes: customMax },
  );
  assertEquals(minTimeout, customMin, "Should respect custom minimum");

  const maxTimeout = calculateDiscoveryTimeout(
    { neuronCount: 10_000, synapseCount: 100_000 },
    { minTimeoutMinutes: customMin, maxTimeoutMinutes: customMax },
  );
  assertEquals(maxTimeout, customMax, "Should respect custom maximum");
});

Deno.test("calculateDiscoveryTimeout - more synapses increases timeout", () => {
  const fewSynapses = calculateDiscoveryTimeout({
    neuronCount: 20,
    synapseCount: 10,
  });
  const manySynapses = calculateDiscoveryTimeout({
    neuronCount: 20,
    synapseCount: 200,
  });

  assert(
    manySynapses >= fewSynapses,
    `More synapses (${manySynapses}) should yield >= timeout than fewer (${fewSynapses})`,
  );
});

Deno.test("calculateDiscoveryTimeout - more neurons increases timeout", () => {
  const fewNeurons = calculateDiscoveryTimeout({
    neuronCount: 5,
    synapseCount: 20,
  });
  const manyNeurons = calculateDiscoveryTimeout({
    neuronCount: 50,
    synapseCount: 20,
  });

  assert(
    manyNeurons >= fewNeurons,
    `More neurons (${manyNeurons}) should yield >= timeout than fewer (${fewNeurons})`,
  );
});

Deno.test("calculateDiscoveryTimeout - default bounds are sensible", () => {
  assert(
    DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.minTimeoutMinutes > 0,
    "Minimum timeout must be positive",
  );
  assert(
    DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.maxTimeoutMinutes >
      DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.minTimeoutMinutes,
    "Maximum timeout must exceed minimum",
  );
  assert(
    DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.maxTimeoutMinutes <= 10,
    "Maximum timeout should not exceed 10 minutes",
  );
});

Deno.test("calculateDiscoveryTimeout - negative inputs treated as zero", () => {
  const timeout = calculateDiscoveryTimeout({
    neuronCount: -5,
    synapseCount: -10,
  });
  assertEquals(
    timeout,
    DEFAULT_DISCOVERY_TIMEOUT_BOUNDS.minTimeoutMinutes,
    "Negative inputs should be treated as zero complexity",
  );
});
