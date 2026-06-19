/**
 * Tests for the discovery focus-selection diversity floor (Issue #3074).
 *
 * On a plateaued network the squared error × impact weighting lets a single
 * neuron capture almost all of the roulette weight, so the nominally-distinct
 * focus neurons collapse onto one target. The diversity floor caps each
 * neuron's weight at 1/N of the total (the mean), bounding the
 * `weightConcentrationRatio` recorded in focus-selection.json. During a drought
 * the selection switches to deterministic round-robin across the top-ranked
 * neurons.
 *
 * These are pure "what" tests: they call the real selection function with
 * synthetic neuron error data and assert on its outputs and the analysis JSON
 * it writes. No Rust / WASM is required.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  selectNeuronsWeightedByError,
} from "@architecture/ErrorGuidedStructuralEvolution/FocusSelectionWeighting.ts";
import type {
  FocusNeuronCandidate,
  NeuronErrorInfo,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";

const noopLog = (
  _level: "debug" | "info" | "warn" | "error",
  _message: string,
  _details?: unknown,
): void => {};

interface WrittenAnalysis {
  weightConcentrationRatio?: number;
  selectionMethod: string;
  candidates: FocusNeuronCandidate[];
}

async function runSelection(
  neuronErrors: NeuronErrorInfo[],
  count: number,
  costOfGrowth: number,
  diversity: { epochsSinceLastAccepted?: number; droughtThreshold?: number } =
    {},
): Promise<{
  selected: number[];
  mode: string;
  concentration?: number;
  analysis: WrittenAnalysis;
}> {
  const tempDir = await Deno.makeTempDir({ prefix: "focus-diversity-" });
  try {
    const result = await selectNeuronsWeightedByError(
      count,
      costOfGrowth,
      neuronErrors,
      () => Promise.resolve(0), // no output-error cap
      false,
      "test-discovery",
      tempDir,
      noopLog,
      undefined,
      "add",
      diversity,
    );
    const analysis = JSON.parse(
      await Deno.readTextFile(`${tempDir}/focus-selection.json`),
    ) as WrittenAnalysis;
    return {
      selected: result.selected,
      mode: result.focusSelection.mode,
      concentration: result.focusSelection.weightConcentrationRatio,
      analysis,
    };
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

/**
 * Builds a candidate pool with one dominant neuron (id 0) plus `tail` modest
 * neurons. The dominant neuron's error × impact is far larger, so without a
 * floor it would hold almost all of the squared roulette weight.
 */
function dominantPool(
  tail: number,
  dominantErrorImpact = 1.0,
): NeuronErrorInfo[] {
  const neurons: NeuronErrorInfo[] = [
    { id: 0, totalError: dominantErrorImpact, impact: 1 },
  ];
  for (let i = 1; i <= tail; i++) {
    // error × impact just above costOfGrowth so they remain viable but tiny.
    neurons.push({ id: i, totalError: 0.002, impact: 1 });
  }
  return neurons;
}

Deno.test("Diversity floor keeps weight concentration below 0.5 on a synthetic dominant neuron", async () => {
  const neuronErrors = dominantPool(49); // 50 candidates, one dominant
  const { concentration, analysis } = await runSelection(
    neuronErrors,
    6,
    0.001,
  );

  assert(concentration !== undefined, "concentration ratio should be recorded");
  assert(
    concentration! < 0.5,
    `post-floor concentration ${concentration} should be < 0.5`,
  );
  assertEquals(
    analysis.weightConcentrationRatio,
    concentration,
    "analysis JSON should record the same concentration ratio",
  );

  // The raw (pre-floor) squared weights show the dominance the floor corrects:
  // the dominant neuron's weightedScore vastly exceeds the rest.
  const dominant = analysis.candidates.find((c) => c.neuronId === 0)!;
  const preFloorTotal = analysis.candidates.reduce(
    (s, c) => s + c.weightedScore,
    0,
  );
  const preFloorShare = dominant.weightedScore / preFloorTotal;
  assert(
    preFloorShare > 0.9,
    `pre-floor share ${preFloorShare} should dominate (> 0.9), proving the floor matters`,
  );
});

Deno.test("Diversity floor bounds concentration on a GRQ-3 sized pool (1673 neurons)", async () => {
  // GRQ-3 fixture shape: 1673 candidate neurons, one holding ~98% of the
  // squared roulette weight before the floor is applied.
  const neuronErrors = dominantPool(1672);
  const { concentration } = await runSelection(neuronErrors, 6, 0.001);

  assert(concentration !== undefined);
  assert(
    concentration! < 0.5,
    `GRQ-3 fixture post-floor concentration ${concentration} should be < 0.5`,
  );
});

Deno.test("Diversity floor is a no-op for an already uniform distribution", async () => {
  const neuronErrors: NeuronErrorInfo[] = Array.from(
    { length: 20 },
    (_, i) => ({ id: i, totalError: 0.5, impact: 1 }),
  );
  const { concentration } = await runSelection(neuronErrors, 6, 0.001);

  assert(concentration !== undefined);
  // Uniform weights → each holds 1/20 of the total.
  assertAlmostEquals(concentration!, 1 / 20, 1e-9);
});

Deno.test("Drought triggers deterministic round-robin across distinct top-ranked neurons", async () => {
  const neuronErrors = dominantPool(49);
  const { selected, mode, analysis } = await runSelection(
    neuronErrors,
    6,
    0.001,
    { epochsSinceLastAccepted: 100, droughtThreshold: 20 },
  );

  assertEquals(mode, "round-robin");
  assertEquals(analysis.selectionMethod, "round-robin-drought");
  assertEquals(selected.length, 6, "should select the requested count");
  assertEquals(
    new Set(selected).size,
    6,
    "round-robin selection must be distinct neurons",
  );
});

Deno.test("Round-robin offset rotates with the drought length", async () => {
  // 30 candidates → pool size = 3 × count = 18 (smaller than the pool).
  const neuronErrors = dominantPool(29);

  // Different drought lengths produce different start offsets, so the rotated
  // focus lists differ — successive plateaued epochs explore distinct targets.
  const first = await runSelection(neuronErrors, 6, 0.001, {
    epochsSinceLastAccepted: 21,
    droughtThreshold: 20,
  });
  const second = await runSelection(neuronErrors, 6, 0.001, {
    epochsSinceLastAccepted: 25,
    droughtThreshold: 20,
  });

  assertEquals(first.mode, "round-robin");
  assertEquals(second.mode, "round-robin");
  assert(
    JSON.stringify(first.selected) !== JSON.stringify(second.selected),
    "different drought lengths should rotate to different focus lists",
  );
});

Deno.test("No drought (epochs below threshold) keeps the weighted roulette path", async () => {
  const neuronErrors = dominantPool(49);
  const { mode } = await runSelection(neuronErrors, 6, 0.001, {
    epochsSinceLastAccepted: 5,
    droughtThreshold: 20,
  });
  assertEquals(mode, "weighted");
});
