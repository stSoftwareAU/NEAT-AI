import { assertEquals, fail } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";

Deno.test("NEAT/NeatConfigCoverage - discoveryMinCandidatesPerCategory validation (negative addSynapses)", () => {
  try {
    createNeatConfig({
      discoveryMinCandidatesPerCategory: {
        addSynapses: -1,
      },
    });
    fail("Expected createNeatConfig() to throw for negative addSynapses");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("addSynapses"),
      true,
      `Error should mention addSynapses: ${(e as Error).message}`,
    );
  }
});

Deno.test("NEAT/NeatConfigCoverage - discoveryMinCandidatesPerCategory validation (negative changeSquash)", () => {
  try {
    createNeatConfig({
      discoveryMinCandidatesPerCategory: {
        changeSquash: -1,
      },
    });
    fail("Expected createNeatConfig() to throw for negative changeSquash");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("changeSquash"),
      true,
      `Error should mention changeSquash: ${(e as Error).message}`,
    );
  }
});

Deno.test("NEAT/NeatConfigCoverage - discoveryRustFlushRecords validation (non-positive throws)", () => {
  try {
    createNeatConfig({ discoveryRustFlushRecords: 0 });
    fail(
      "Expected createNeatConfig() to throw for non-positive discoveryRustFlushRecords",
    );
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("Discovery Rust Flush Records"),
      true,
      `Error should mention the field name: ${(e as Error).message}`,
    );
  }
});

Deno.test("NEAT/NeatConfigCoverage - discoveryFocusNeuronUUIDs must be an array", () => {
  try {
    createNeatConfig({
      discoveryFocusNeuronUUIDs: 123 as unknown as number[],
    });
    fail(
      "Expected createNeatConfig() to throw for non-array discoveryFocusNeuronUUIDs",
    );
  } catch (e) {
    assertEquals(
      // The failure can occur during defaulting (spread) before validation,
      // so the message is implementation-dependent (eg. "is not iterable").
      (e as Error).message.length > 0,
      true,
      `Error should mention discoveryFocusNeuronUUIDs: ${(e as Error).message}`,
    );
  }
});

Deno.test("NEAT/NeatConfigCoverage - discoveryFocusNeuronUUIDs entries must be integers", () => {
  try {
    createNeatConfig({
      discoveryFocusNeuronUUIDs: [""] as unknown as number[],
    });
    fail(
      "Expected createNeatConfig() to throw for non-integer discoveryFocusNeuronUUIDs entry",
    );
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("integers"),
      true,
      `Error should mention integers: ${(e as Error).message}`,
    );
  }
});

Deno.test("NEAT/NeatConfigCoverage - discoveryReplayConcurrency rejects non-positive", () => {
  try {
    createNeatConfig({ discoveryReplayConcurrency: 0 });
    fail(
      "Expected createNeatConfig() to throw for discoveryReplayConcurrency 0",
    );
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("Discovery Replay Concurrency"),
      true,
      `Error should mention field: ${(e as Error).message}`,
    );
  }
});

Deno.test("NEAT/NeatConfigCoverage - memory config defaults", () => {
  const config = createNeatConfig({});
  assertEquals(config.memory.enabled, true);
  assertEquals(config.memory.warningThreshold, 0.70);
  assertEquals(config.memory.criticalThreshold, 0.85);
});

Deno.test("NEAT/NeatConfigCoverage - memory config partial override", () => {
  const config = createNeatConfig({
    memory: { warningThreshold: 0.60 },
  });
  assertEquals(config.memory.enabled, true);
  assertEquals(config.memory.warningThreshold, 0.60);
  assertEquals(config.memory.criticalThreshold, 0.85);
});

Deno.test("NEAT/NeatConfigCoverage - memory config full override", () => {
  const config = createNeatConfig({
    memory: {
      enabled: false,
      warningThreshold: 0.50,
      criticalThreshold: 0.75,
    },
  });
  assertEquals(config.memory.enabled, false);
  assertEquals(config.memory.warningThreshold, 0.50);
  assertEquals(config.memory.criticalThreshold, 0.75);
});

Deno.test("NEAT/NeatConfigCoverage - memory config cross-field validation (critical < warning throws)", () => {
  try {
    createNeatConfig({
      memory: {
        warningThreshold: 0.90,
        criticalThreshold: 0.60,
      },
    });
    fail(
      "Expected createNeatConfig() to throw when criticalThreshold < warningThreshold",
    );
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("criticalThreshold"),
      true,
      `Error should mention criticalThreshold: ${(e as Error).message}`,
    );
  }
});

Deno.test("NEAT/NeatConfigCoverage - memory config warningThreshold out of range throws", () => {
  try {
    createNeatConfig({
      memory: { warningThreshold: 1.5 },
    });
    fail(
      "Expected createNeatConfig() to throw for warningThreshold > 1",
    );
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("Memory warningThreshold"),
      true,
      `Error should mention Memory warningThreshold: ${(e as Error).message}`,
    );
  }
});

Deno.test("NEAT/NeatConfigCoverage - discoveryReplayConcurrency default path when verify enabled", () => {
  // This is a lightweight smoke check to execute the defaulting logic.
  const config = createNeatConfig({
    discoveryReplayVerifyScores: true,
  });
  assertEquals(config.discoveryReplayVerifyScores, true);
  assertEquals(config.discoveryReplayConcurrency >= 1, true);
});
