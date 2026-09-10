/**
 * Tests for the skip-connection null comparison harness (Issue #3973).
 *
 * The harness is evidence-producing code, so its readings are tested the same
 * way any other function is: real profiles in, real numbers out.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { probeGradientDepth } from "@propagate/GradientDepthProbe.ts";
import { longestSerialChain } from "@propagate/SerialChains.ts";
import {
  assertValidSkipNullConfig,
  bucketZeroGradient,
  buildTailParent,
  buildTask,
  chainZeroGradient,
  formatSkipNullMarkdown,
  pooledZeroGradient,
  runSkipNullComparison,
  SKIP_NULL_DEFAULTS,
  withSkipNullDefaults,
} from "./skip_connection_null_comparison.ts";
import { summariseMagnitudes } from "./structural_weight_scale_sweep.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../test/_rngTestLock.ts";

/** A small profile of a creature with a single-file tail. */
function profileTailCreature() {
  const config = withSkipNullDefaults({
    runLength: 6,
    width: 3,
    inputCount: 2,
    samples: 4,
  });
  const rng = createSeededRng(3973);
  const parent = buildTailParent(config, () => rng.random());
  const creature = Creature.fromJSON(parent);
  const samples = [0, 1, 2, 3].map(() => {
    const row = new Float32Array(creature.input);
    for (let i = 0; i < row.length; i++) row[i] = rng.random() * 2 - 1;
    return row;
  });
  return { config, parent, profile: probeGradientDepth(creature, samples) };
}

Deno.test("withSkipNullDefaults - fills every unset field", () => {
  const config = withSkipNullDefaults({ seed: 7 });
  assertEquals(config.seed, 7);
  assertEquals(config.skips, SKIP_NULL_DEFAULTS.skips);
  assertEquals(config.weightScale, SKIP_NULL_DEFAULTS.weightScale);
});

Deno.test("assertValidSkipNullConfig - refuses nonsense", () => {
  assertThrows(
    () => withSkipNullDefaults({ skips: 0 }),
    RangeError,
    "skips must be a positive integer",
  );
  assertThrows(
    () => withSkipNullDefaults({ weightScale: 0 }),
    RangeError,
    "weightScale must be greater than zero",
  );
  assertThrows(
    () => withSkipNullDefaults({ minRunLength: 1 }),
    RangeError,
    "minRunLength must be an integer of at least 2",
  );
  assertThrows(
    () => withSkipNullDefaults({ observationScale: -1 }),
    RangeError,
    "observationScale must be greater than zero",
  );
  // The valid case must not throw.
  assertValidSkipNullConfig(withSkipNullDefaults({}));
});

Deno.test("pooledZeroGradient - pools only the buckets at or below the depth", () => {
  const { profile } = profileTailCreature();
  assert(profile.buckets.length > 2, "the tail should produce several depths");

  const shallow = pooledZeroGradient(profile, 1);
  const deep = pooledZeroGradient(
    profile,
    profile.buckets[profile.buckets.length - 1].depth,
  );
  assert(
    deep.observations > shallow.observations,
    "a deeper cut pools strictly more measurements",
  );

  let expected = 0;
  for (const bucket of profile.buckets) {
    if (bucket.depth <= 1) expected += bucket.observations;
  }
  assertEquals(shallow.observations, expected);
  assertEquals(
    shallow.zeroFraction,
    shallow.observations === 0
      ? 0
      : shallow.zeroObservations / shallow.observations,
  );
});

Deno.test("pooledZeroGradient - an empty cut reads as zero, not NaN", () => {
  const { profile } = profileTailCreature();
  const none = pooledZeroGradient(profile, -1);
  assertEquals(none.observations, 0);
  assertEquals(none.zeroFraction, 0);
});

Deno.test("bucketZeroGradient - reads one depth, and a missing depth as zero", () => {
  const { profile } = profileTailCreature();
  const first = profile.buckets[0];
  const read = bucketZeroGradient(profile, first.depth);
  assertEquals(read.observations, first.observations);
  assertEquals(read.zeroFraction, first.zeroFraction);

  const missing = bucketZeroGradient(profile, 9_999);
  assertEquals(missing.observations, 0);
  assertEquals(missing.zeroFraction, 0);
});

Deno.test("chainZeroGradient - mirrors the profile's own chain aggregate", () => {
  const { profile } = profileTailCreature();
  const chain = chainZeroGradient(profile);
  assert(chain !== undefined, "a single-file tail has a chain profile");
  assertEquals(
    chain.zeroObservations,
    profile.serialChainProfile?.aggregate.zeroObservations,
  );
});

Deno.test("magnitude summary - the harness reuses #3970's, not a second copy", () => {
  // The weight columns are summarised by the sweep harness's own
  // `summariseMagnitudes`; this pins the shape this harness relies on.
  const summary = summariseMagnitudes([0.4, 0.1, 0.3]);
  assertEquals(summary.count, 3);
  assertEquals(summary.min, 0.1);
  assertEquals(summary.median, 0.3);
  assertEquals(summary.max, 0.4);

  const even = summariseMagnitudes([1, 2, 3, 4]);
  assertEquals(even.median, 2.5);
  assertEquals(summariseMagnitudes([]).count, 0);
});

Deno.test("buildTask - produces records of the configured shape", () => {
  const config = withSkipNullDefaults({ inputCount: 3, sampleCount: 5 });
  const rng = createSeededRng(1);
  const data = buildTask(config, () => rng.random());
  assertEquals(data.length, 5);
  assertEquals(data[0].input.length, 3);
  assertEquals(data[0].output.length, 1);
});

Deno.test("runSkipNullComparison - measures three arms with a matched null", async () => {
  await withRngTestLock(() => {
    const config = withSkipNullDefaults({
      runLength: 8,
      width: 3,
      inputCount: 2,
      samples: 4,
      skips: 3,
      profileOnly: true,
    });
    const rng = createSeededRng(3973);
    const parent = buildTailParent(config, () => rng.random());

    const report = runSkipNullComparison(parent, "unit-test parent", config);
    assertEquals(report.arms.map((a) => a.arm), ["baseline", "skip", "random"]);

    const skip = report.arms.find((a) => a.arm === "skip")!;
    const random = report.arms.find((a) => a.arm === "random")!;
    const baseline = report.arms.find((a) => a.arm === "baseline")!;

    assertEquals(baseline.added, 0, "the baseline arm adds nothing");
    assert(skip.added > 0, "the skip arm should find its bypass");
    assertEquals(
      random.added,
      skip.added,
      "the null arm is matched to what the skip arm actually added",
    );
    // The bypass starts at the run's entry neuron — the same neuron
    // `longestSerialChain` names, not an arbitrary source.
    const chain = longestSerialChain(Creature.fromJSON(parent));
    assert(chain !== undefined);
    assertEquals(skip.edges[0].split("->")[0], String(chain.members[0].index));
    assertEquals(report.entryDepth, chain.members[0].depth);
    assert(
      report.runLength >= config.minRunLength,
      "the run it aimed at is worth bypassing",
    );
    // Not trained: no error or magnitude readings are invented.
    assertEquals(skip.errorBefore, undefined);
    assertEquals(skip.trained, undefined);
  });
});

Deno.test("runSkipNullComparison - leaves the caller's RNG in place", async () => {
  await withRngTestLock(() => {
    const config = withSkipNullDefaults({
      runLength: 8,
      width: 3,
      inputCount: 2,
      samples: 4,
      profileOnly: true,
    });
    const previous = getRandomNumberGenerator();
    try {
      // Seed a distinctive stream, note where it is, and confirm the harness
      // hands it back rather than leaving its own seeded RNG installed.
      setRandomNumberGenerator(createSeededRng(11));
      const rng = getRandomNumberGenerator();
      const expected = rng.random();

      setRandomNumberGenerator(createSeededRng(11));
      const parentRng = createSeededRng(3973);
      const parent = buildTailParent(config, () => parentRng.random());
      runSkipNullComparison(parent, "unit-test parent", config);

      assertEquals(
        getRandomNumberGenerator().random(),
        expected,
        "the harness must not leave its own seeded RNG installed",
      );
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

Deno.test("runSkipNullComparison - refuses a run it cannot bypass", () => {
  // A chain shorter than `minRunLength` yields no bypass, which would make all
  // three arms identical — that is reported loudly, not as a clean result.
  const config = withSkipNullDefaults({
    runLength: 4,
    width: 3,
    inputCount: 2,
    samples: 2,
    minRunLength: 12,
    profileOnly: true,
  });
  const rng = createSeededRng(3973);
  const parent = buildTailParent(config, () => rng.random());

  assertThrows(
    () => runSkipNullComparison(parent, "short-run parent", config),
    Error,
    "offers no bypass",
  );
});

Deno.test("runSkipNullComparison - refuses a creature with no serial run", () => {
  const flat = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "b", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "b", weight: 0.5 },
      { fromUUID: "a", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "b", toUUID: "output-0", weight: 0.5 },
    ],
  }).exportJSON();

  assertThrows(
    () =>
      runSkipNullComparison(
        flat,
        "flat creature",
        withSkipNullDefaults({
          samples: 2,
          profileOnly: true,
        }),
      ),
    Error,
    "has no serial run",
  );
});

Deno.test("formatSkipNullMarkdown - renders every arm and the edges it added", async () => {
  await withRngTestLock(() => {
    const config = withSkipNullDefaults({
      runLength: 8,
      width: 3,
      inputCount: 2,
      samples: 4,
      profileOnly: true,
    });
    const rng = createSeededRng(3973);
    const parent = buildTailParent(config, () => rng.random());
    const markdown = formatSkipNullMarkdown(
      runSkipNullComparison(parent, "unit-test parent", config),
    );

    assert(markdown.includes("| baseline |"));
    assert(markdown.includes("| skip |"));
    assert(markdown.includes("| random |"));
    assert(markdown.includes("Entry zero-gradient"));
    assert(markdown.includes("**skip** added:"));
    assert(
      markdown.includes("profile only (no training arm)"),
      "an untrained report must say so rather than quote an epoch count",
    );
  });
});

Deno.test("formatSkipNullMarkdown - a trained report names its epoch count", () => {
  // The trained columns cannot be reproduced without the epoch count, so the
  // provenance line has to carry it. Rendered from a synthesised report rather
  // than a real training run, which is a benchmark's job, not a unit test's.
  const config = withSkipNullDefaults({ iterations: 250 });
  const markdown = formatSkipNullMarkdown({
    config,
    provenance: "unit-test report",
    entryDepth: 2,
    runLength: 6,
    arms: [{
      arm: "skip",
      added: 1,
      edges: ["2->8"],
      upstream: { observations: 4, zeroObservations: 1, zeroFraction: 0.25 },
      entry: { observations: 2, zeroObservations: 0, zeroFraction: 0 },
      errorBefore: 0.5,
      errorAfter: 0.25,
      birth: { count: 1, min: 0.1, median: 0.1, max: 0.1, geometricMean: 0.1 },
      trained: {
        count: 1,
        min: 0.4,
        median: 0.4,
        max: 0.4,
        geometricMean: 0.4,
      },
    }],
  });

  assert(
    markdown.includes("250 training epochs"),
    `the header must name the epoch count, got:\n${markdown}`,
  );
});
