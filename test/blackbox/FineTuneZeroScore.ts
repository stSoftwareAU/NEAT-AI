import { assert } from "@std/assert";
import { Creature } from "@creature";
import { fineTuneImprovement } from "@blackbox/FineTune.ts";

/**
 * Regression test for issue #2295:
 * fineTuneImprovement must accept a fittest creature with score === 0.
 * Previously, `assert(fittest.score)` failed because 0 is falsy.
 */
Deno.test("fineTuneImprovement accepts zero score", () => {
  const previousFittest = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0.5,
        squash: "BIPOLAR_SIGMOID",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.9 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.8 },
    ],
  }, true);

  const fittest = Creature.fromJSON(previousFittest.exportJSON(), true);

  // Score of exactly 0 — a valid, perfect score
  fittest.score = 0;
  previousFittest.score = -0.5;

  // Adjust bias so tuning has something to work with
  fittest.neurons[fittest.input].bias = 0.6;

  // This must NOT throw an AssertionError
  const fineTuned = fineTuneImprovement(
    fittest,
    previousFittest,
    false,
    5,
  );

  // We should get fine-tuned candidates since scores differ
  assert(
    fineTuned.length > 0,
    `Expected fine-tuned candidates with zero score, got: ${fineTuned.length}`,
  );
});

/**
 * Verify that fineTuneImprovement still returns empty for undefined score
 * (the original guard should still work for genuinely missing scores).
 */
Deno.test("fineTuneImprovement returns empty for non-finite score", () => {
  const previousFittest = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0.5,
        squash: "BIPOLAR_SIGMOID",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.9 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.8 },
    ],
  }, true);

  const fittest = Creature.fromJSON(previousFittest.exportJSON(), true);

  // NaN is not a finite score
  fittest.score = NaN;
  previousFittest.score = -0.5;

  const fineTuned = fineTuneImprovement(
    fittest,
    previousFittest,
    false,
    5,
  );

  assert(
    fineTuned.length === 0,
    `Expected no candidates for NaN score, got: ${fineTuned.length}`,
  );
});

/**
 * Verify that both fittest and previousFittest can have score 0
 * and the function returns empty (since scores are equal).
 */
Deno.test("fineTuneImprovement returns empty when both scores are zero", () => {
  const previousFittest = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0.5,
        squash: "BIPOLAR_SIGMOID",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.9 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.8 },
    ],
  }, true);

  const fittest = Creature.fromJSON(previousFittest.exportJSON(), true);

  // Both scores are zero — equal, so no fine-tuning should occur
  fittest.score = 0;
  previousFittest.score = 0;

  const fineTuned = fineTuneImprovement(
    fittest,
    previousFittest,
    false,
    5,
  );

  assert(
    fineTuned.length === 0,
    `Expected no candidates when scores are equal (both zero), got: ${fineTuned.length}`,
  );
});

/**
 * Verify that negative zero score is handled correctly.
 */
Deno.test("fineTuneImprovement handles negative zero score", () => {
  const previousFittest = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0.5,
        squash: "BIPOLAR_SIGMOID",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.9 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.8 },
    ],
  }, true);

  const fittest = Creature.fromJSON(previousFittest.exportJSON(), true);

  // -0 is finite and equals 0 in JS
  fittest.score = -0;
  previousFittest.score = -0.5;

  fittest.neurons[fittest.input].bias = 0.6;

  // Should not throw — -0 is a valid finite number
  const fineTuned = fineTuneImprovement(
    fittest,
    previousFittest,
    false,
    5,
  );

  assert(
    fineTuned.length > 0,
    `Expected fine-tuned candidates with -0 score, got: ${fineTuned.length}`,
  );
});
