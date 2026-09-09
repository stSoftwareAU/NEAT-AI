/**
 * Issue #3970 — tests for the `structuralWeightScale` sweep harness.
 *
 * These cover the pure parts — config validation, the distribution summaries,
 * the generators, and the Markdown table — so a broken sweep fails in the fast
 * `deno test` suite rather than after a reader has already quoted its numbers
 * as evidence. The real measurement runs live in the CLI, driven by
 * `deno task bench:structural-scale`.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import {
  assertValidScaleSweepConfig,
  BASELINE_SCALE,
  buildParentCreature,
  buildTask,
  createSeededRng,
  formatScaleSweepMarkdown,
  median,
  parseScales,
  type ProbeResult,
  scaleLabel,
  type ScaleSweepEntry,
  summariseMagnitudes,
  withScaleSweepDefaults,
} from "./structural_weight_scale_sweep.ts";

function probe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    scale: 1,
    mutations: 10,
    behaviourNeutralAtBirth: 0.5,
    medianErrorDelta: 1e-4,
    acceptanceRateAtBirth: 0.4,
    acceptanceRateAfterTraining: 0.3,
    outwardAtBirth: summariseMagnitudes([0.2]),
    outwardAfterTraining: summariseMagnitudes([0.25]),
    escapedBirthScale: 0.1,
    ...overrides,
  };
}

Deno.test("withScaleSweepDefaults - defaults are a runnable, valid sweep", () => {
  const config = withScaleSweepDefaults();
  assertValidScaleSweepConfig(config);
  assert(
    config.scales.includes(BASELINE_SCALE),
    "the default sweep must carry the shipped-default baseline row",
  );
});

Deno.test("assertValidScaleSweepConfig - rejects sweeps that are not evidence", () => {
  // Fewer than three scales is an A/B point, not the curve the issue asks for.
  assertThrows(
    () =>
      assertValidScaleSweepConfig(withScaleSweepDefaults({ scales: [1, 0.1] })),
    Error,
    "at least 3 scales",
  );
  // A sweep with no baseline has nothing to compare against.
  assertThrows(
    () =>
      assertValidScaleSweepConfig(
        withScaleSweepDefaults({ scales: [0.5, 0.1, 0.01] }),
      ),
    Error,
    "baseline row",
  );
  // A duplicate would silently collapse two rows into one.
  assertThrows(
    () =>
      assertValidScaleSweepConfig(
        withScaleSweepDefaults({ scales: [1, 0.1, 0.1] }),
      ),
    Error,
    "Duplicate scale",
  );
  assertThrows(
    () =>
      assertValidScaleSweepConfig(
        withScaleSweepDefaults({ scales: [1, 0.1, -0.5] }),
      ),
    Error,
    "greater than zero",
  );
  assertThrows(
    () => assertValidScaleSweepConfig(withScaleSweepDefaults({ trials: 0 })),
    Error,
    "trials must be a positive integer",
  );
  assertThrows(
    () =>
      assertValidScaleSweepConfig(withScaleSweepDefaults({ trainingSteps: 0 })),
    Error,
    "trainingSteps must be a positive integer",
  );
});

Deno.test("summariseMagnitudes - reports the spread of a weight distribution", () => {
  const summary = summariseMagnitudes([0.1, 0.001, 0.01]);
  assertEquals(summary.count, 3);
  assertAlmostEquals(summary.min, 0.001, 1e-12);
  assertAlmostEquals(summary.median, 0.01, 1e-12);
  assertAlmostEquals(summary.max, 0.1, 1e-12);
  // Geometric mean of three values spanning two decades is the middle one.
  assertAlmostEquals(summary.geometricMean, 0.01, 1e-9);

  const empty = summariseMagnitudes([]);
  assertEquals(empty, {
    count: 0,
    min: 0,
    median: 0,
    max: 0,
    geometricMean: 0,
  });

  assertThrows(
    () => summariseMagnitudes([0.1, Number.NaN]),
    Error,
    "finite and non-negative",
  );
});

Deno.test("median - handles odd, even and empty lists", () => {
  assertEquals(median([3, 1, 2]), 2);
  assertEquals(median([4, 1, 3, 2]), 2.5);
  assertEquals(median([]), 0);
});

Deno.test("scaleLabel - marks the baseline row", () => {
  assertEquals(scaleLabel(1), "scale1 (baseline)");
  assertEquals(scaleLabel(0.001), "scale0.001");
});

Deno.test("parseScales - accepts a list, rejects anything unusable", () => {
  assertEquals(parseScales("1, 0.1 ,0.001"), [1, 0.1, 0.001]);
  assertThrows(() => parseScales("1,zero"), Error, "not a finite scale");
  assertThrows(() => parseScales("1,-2"), Error, "not a finite scale");
  assertThrows(() => parseScales(" , "), Error, "at least one scale");
});

Deno.test("formatScaleSweepMarkdown - one row per scale, worst scale last", () => {
  const entries: ScaleSweepEntry[] = [
    {
      scale: 0.001,
      label: scaleLabel(0.001),
      probe: probe({ scale: 0.001 }),
      evolution: null,
    },
    { scale: 1, label: scaleLabel(1), probe: probe(), evolution: null },
    {
      scale: 0.1,
      label: scaleLabel(0.1),
      probe: probe({ scale: 0.1 }),
      evolution: null,
    },
  ];
  const markdown = formatScaleSweepMarkdown(entries);
  const rows = markdown.split("\n").filter((line) =>
    line.startsWith("| scale")
  );
  assertEquals(rows.length, 3);
  assert(rows[0].startsWith("| scale1 (baseline)"), "baseline sorts first");
  assert(rows[2].startsWith("| scale0.001"), "smallest scale sorts last");
});

Deno.test("formatScaleSweepMarkdown - refuses a table with no baseline", () => {
  assertThrows(
    () =>
      formatScaleSweepMarkdown([
        {
          scale: 0.1,
          label: scaleLabel(0.1),
          probe: probe({ scale: 0.1 }),
          evolution: null,
        },
      ]),
    Error,
    "No baseline row",
  );
});

Deno.test("buildParentCreature - a valid, well-conditioned topology", () => {
  const config = withScaleSweepDefaults({
    inputCount: 4,
    hiddenCount: 3,
    outputCount: 2,
  });
  const parentExport = buildParentCreature(
    config,
    createSeededRng(config.seed),
  );
  assertEquals(parentExport.input, 4);
  assertEquals(parentExport.output, 2);
  assertEquals(parentExport.neurons.length, 5, "3 hidden + 2 output");
  assertEquals(parentExport.synapses.length, 4 * 3 + 3 * 2);

  // It must be a real creature, not just a plausible-looking object.
  const creature = Creature.fromJSON(parentExport);
  creature.validate();
  const output = creature.activate(new Float32Array([0.1, -0.2, 0.3, -0.4]));
  assertEquals(output.length, 2);
  for (const value of output) {
    assert(Number.isFinite(value), `output ${value} must be finite`);
  }
});

Deno.test("buildParentCreature - is reproducible from its seed", () => {
  const config = withScaleSweepDefaults({ inputCount: 4, hiddenCount: 3 });
  const a = buildParentCreature(config, createSeededRng(7));
  const b = buildParentCreature(config, createSeededRng(7));
  assertEquals(a, b);
});

Deno.test("buildTask - shaped, bounded and reproducible", () => {
  const config = withScaleSweepDefaults({
    inputCount: 4,
    outputCount: 2,
    sampleCount: 6,
  });
  const data = buildTask(config, createSeededRng(11));
  assertEquals(data.length, 6);
  for (const record of data) {
    assertEquals(record.input.length, 4);
    assertEquals(record.output.length, 2);
    for (const value of record.output) {
      // tanh(...) * 0.5 — bounded, so an IDENTITY output can reach it.
      assert(Math.abs(value) <= 0.5, `target ${value} must be within ±0.5`);
    }
  }
  assertEquals(buildTask(config, createSeededRng(11)), data);
});
