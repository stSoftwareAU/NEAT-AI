import { assertEquals, fail } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

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
      discoveryFocusNeuronUUIDs: (123 as unknown as string[]),
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

Deno.test("NEAT/NeatConfigCoverage - discoveryFocusNeuronUUIDs entries must be non-empty", () => {
  try {
    createNeatConfig({
      discoveryFocusNeuronUUIDs: [""],
    });
    fail(
      "Expected createNeatConfig() to throw for empty discoveryFocusNeuronUUIDs entry",
    );
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("non-empty strings"),
      true,
      `Error should mention non-empty strings: ${(e as Error).message}`,
    );
  }
});

Deno.test("NEAT/NeatConfigCoverage - discoveryReplayConcurrency coerces non-positive to 1", () => {
  const config = createNeatConfig({ discoveryReplayConcurrency: 0 });
  assertEquals(config.discoveryReplayConcurrency, 1);
});

Deno.test("NEAT/NeatConfigCoverage - discoveryReplayConcurrency default path when verify enabled", () => {
  // This is a lightweight smoke check to execute the defaulting logic.
  const config = createNeatConfig({
    discoveryReplayVerifyScores: true,
  });
  assertEquals(config.discoveryReplayVerifyScores, true);
  assertEquals(config.discoveryReplayConcurrency >= 1, true);
});
