import { assertRejects, assertThrows } from "@std/assert";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { DiscoveryError } from "@errors/DiscoveryError.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { DiscoveryRunner } from "../../src/discovery/DiscoveryRunner.ts";
import { buildCacheKey } from "../../src/discovery/FailureCacheKey.ts";
import { HoldoutValidator } from "../../src/discovery/HoldoutValidator.ts";
import { DiscoveryReplayRunner } from "../../src/discovery/DiscoveryReplayRunner.ts";
import { makeBaseCreature } from "../fixtures/SimpleCreatures.ts";

Deno.test("DiscoveryRunner throws DiscoveryError when Rust library is unavailable", async () => {
  const runner = new DiscoveryRunner({
    rustDiscoveryEnabled: () => false,
  });

  await assertRejects(
    () =>
      runner.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options: {},
      }),
    DiscoveryError,
    "Discovery requires the NEAT-AI-Discovery Rust library",
  );
});

Deno.test("DiscoveryRunner throws ConfigurationError for non-positive discoverySampleRate", async () => {
  const runner = new DiscoveryRunner({
    rustDiscoveryEnabled: () => true,
  });

  await assertRejects(
    () =>
      runner.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options: { discoverySampleRate: 0 },
      }),
    ConfigurationError,
    "discoverySampleRate",
  );
});

Deno.test("DiscoveryRunner throws ConfigurationError for non-positive discoveryRecordTimeOutMinutes", async () => {
  const runner = new DiscoveryRunner({
    rustDiscoveryEnabled: () => true,
  });

  await assertRejects(
    () =>
      runner.discoverDir({
        creature: makeBaseCreature(),
        dataDir: "/tmp/data",
        options: { discoveryRecordTimeOutMinutes: 0 },
      }),
    ConfigurationError,
    "discoveryRecordTimeOutMinutes",
  );
});

Deno.test("buildCacheKey throws TopologyError for remove-synapse without synapseDetails", () => {
  const creature = makeBaseCreature();

  assertThrows(
    () =>
      buildCacheKey({
        creature,
        change: {
          type: "remove-synapse",
          description: "test removal",
          // synapseDetails intentionally missing
        },
      }),
    TopologyError,
    "synapseDetails",
  );
});

Deno.test("HoldoutValidator throws ValidationError for unknown cost function", () => {
  const validator = new HoldoutValidator({ costName: "NONEXISTENT_COST" });
  const creature = makeBaseCreature();

  assertThrows(
    () => validator.validateCandidate(creature, "/tmp/holdout"),
    ValidationError,
    "Unknown cost function",
  );
});

Deno.test("HoldoutValidator.validateWithGap throws ValidationError for unknown cost function", () => {
  const validator = new HoldoutValidator({ costName: "NONEXISTENT_COST" });
  const creature = makeBaseCreature();

  assertThrows(
    () => validator.validateWithGap(creature, "/tmp/training", "/tmp/holdout"),
    ValidationError,
    "Unknown cost function",
  );
});

Deno.test("DiscoveryReplayRunner throws ConfigurationError when discoverySuccessCacheDir is not set", async () => {
  const runner = new DiscoveryReplayRunner();
  const creature = makeBaseCreature();

  await assertRejects(
    () =>
      runner.replayDir({
        creature,
        dataDir: "/tmp/data",
        options: {},
      }),
    ConfigurationError,
    "discoverySuccessCacheDir",
  );
});
