/**
 * Issue #3881, acceptance 3: `Score.ts` and `rust_scorer/src/scoring.rs` must
 * agree on the score of the same creature across the magnitudes production
 * actually produces.
 *
 * `test/score/MagnitudeSelectionPressure.ts` pins the curve as data, which both
 * engines read. This lane closes the loop end to end: it drives the **real**
 * `rust_scorer` binary over a creature whose weights and biases sit at a chosen
 * magnitude and compares the complexity penalty it reports with the one
 * `calculate()` produced in-process. A curve that matched case by case but was
 * wired into the score differently would pass the corpus and fail here.
 *
 * The binary is resolved exactly as `quality.sh` resolves it; without one the
 * lane is skipped rather than failed, so a contributor with no scorer checkout
 * is not blocked. CI always has it.
 */

import { assert } from "@std/assert";
import { Creature } from "@creature";
import { calculate } from "@architecture/Score.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import {
  makeScoringDataDir,
  relativeDifference,
  resolveRustScorerBinary,
} from "./NativeScorerFixtures.ts";

const BINARY = resolveRustScorerBinary();
const SKIP = BINARY === undefined;

/** The fleet's production growth cost, and the scorer's own default. */
const GROWTH_COST = 1e-7;

/**
 * Both engines accumulate the per-value penalties in f64 but in a different
 * order, so agreement is relative rather than exact.
 */
const PARITY_REL_TOLERANCE = 1e-9;

/**
 * Magnitudes spanning the range the issue reports: a well-conditioned creature,
 * the `avg|w|` of the published champion, its `max|w|`, and a value past the
 * point the old curve had saturated entirely.
 */
const MAGNITUDES = [10, 4544, 1.631e8, 1e13];

/** A creature whose every weight and bias sits at `magnitude`. */
function creatureAtMagnitude(magnitude: number): Creature {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3, squash: IDENTITY.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });
  creature.synapses.forEach((s, i) => s.weight = i % 2 ? -magnitude : magnitude);
  for (let i = creature.input; i < creature.neurons.length; i++) {
    creature.neurons[i].bias = magnitude / 3;
  }
  creature.invalidateScoreCache();
  return creature;
}

/** Run the binary and return the complexity penalty it reports. */
async function nativeComplexityPenalty(
  creature: Creature,
  dataDir: string,
): Promise<number> {
  const file = await Deno.makeTempFile({
    prefix: "magnitude-parity-",
    suffix: ".json",
  });
  try {
    await Deno.writeTextFile(file, JSON.stringify(creature.exportJSON()));
    const { stdout, stderr, success } = await new Deno.Command(BINARY!, {
      args: ["--gpu", "off", file, dataDir],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const text = new TextDecoder().decode(stdout);
    assert(
      success,
      `rust_scorer failed: ${new TextDecoder().decode(stderr)}`,
    );
    const start = text.indexOf("{");
    assert(start >= 0, `rust_scorer emitted no JSON: ${text}`);
    const parsed = JSON.parse(text.substring(start));
    const penalty = parsed.complexityPenalty;
    assert(
      typeof penalty === "number" && Number.isFinite(penalty),
      `rust_scorer reported no finite complexityPenalty: ${text}`,
    );
    return penalty;
  } finally {
    await Deno.remove(file);
  }
}

for (const magnitude of MAGNITUDES) {
  Deno.test({
    name:
      `Magnitude #3881: rust_scorer and TypeScript agree on the penalty at |w|=${magnitude}`,
    ignore: SKIP,
    async fn() {
      const dataDir = makeScoringDataDir();
      try {
        const creature = creatureAtMagnitude(magnitude);
        const native = await nativeComplexityPenalty(creature, dataDir);

        // score = 1 - error - complexityPenalty - versionPenalty, so scoring a
        // zero error against a current-version creature isolates the penalty.
        const typescript = 1 - calculate(creature, 0, GROWTH_COST);

        const difference = relativeDifference(native, typescript);
        assert(
          difference <= PARITY_REL_TOLERANCE,
          `complexity penalty at |w|=${magnitude} disagrees: ` +
            `native=${native} typescript=${typescript} (relative ${difference})`,
        );
      } finally {
        await Deno.remove(dataDir, { recursive: true });
      }
    },
  });
}

Deno.test({
  name:
    "Magnitude #3881: both engines charge more as the magnitude grows, in step",
  ignore: SKIP,
  async fn() {
    const dataDir = makeScoringDataDir();
    try {
      const penalties: number[] = [];
      for (const magnitude of MAGNITUDES) {
        penalties.push(
          await nativeComplexityPenalty(creatureAtMagnitude(magnitude), dataDir),
        );
      }
      for (let i = 1; i < penalties.length; i++) {
        assert(
          penalties[i] > penalties[i - 1],
          `the native penalty must rise from |w|=${MAGNITUDES[i - 1]} ` +
            `(${penalties[i - 1]}) to |w|=${MAGNITUDES[i]} (${penalties[i]})`,
        );
      }
    } finally {
      await Deno.remove(dataDir, { recursive: true });
    }
  },
});
