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
  summariseMagnitudes,
  withSkipNullDefaults,
} from "./skip_connection_null_comparison.ts";
import { createSeededRng } from "@utils/RandomNumberGenerator.ts";

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

Deno.test("summariseMagnitudes - reports the distribution, and empty as zeroes", () => {
  const summary = summariseMagnitudes([0.4, 0.1, 0.3]);
  assertEquals(summary.count, 3);
  assertEquals(summary.min, 0.1);
  assertEquals(summary.median, 0.3);
  assertEquals(summary.max, 0.4);
  assertEquals(Math.round(summary.mean * 1000) / 1000, 0.267);

  const even = summariseMagnitudes([1, 2, 3, 4]);
  assertEquals(even.median, 2.5);

  assertEquals(summariseMagnitudes([]), {
    count: 0,
    min: 0,
    median: 0,
    mean: 0,
    max: 0,
  });
});

Deno.test("buildTask - produces records of the configured shape", () => {
  const config = withSkipNullDefaults({ inputCount: 3, sampleCount: 5 });
  const rng = createSeededRng(1);
  const data = buildTask(config, () => rng.random());
  assertEquals(data.length, 5);
  assertEquals(data[0].input.length, 3);
  assertEquals(data[0].output.length, 1);
});

Deno.test("runSkipNullComparison - measures three arms with a matched null", () => {
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

Deno.test("formatSkipNullMarkdown - renders every arm and the edges it added", () => {
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
});
