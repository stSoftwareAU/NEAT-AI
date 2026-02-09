import { assertEquals, fail } from "@std/assert";
import {
  DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS,
} from "../../src/config/AdaptiveMutationThresholds.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

Deno.test("AdaptiveMutationThresholds - defaults are applied", () => {
  const config = createNeatConfig({});
  assertEquals(
    config.adaptiveMutationThresholds.medium,
    DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS.medium,
  );
  assertEquals(
    config.adaptiveMutationThresholds.large,
    DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS.large,
  );
  assertEquals(
    config.adaptiveMutationThresholds.largeTopologyWeight,
    DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS.largeTopologyWeight,
  );
});

Deno.test("AdaptiveMutationThresholds - custom values override defaults", () => {
  const config = createNeatConfig({
    adaptiveMutationThresholds: {
      medium: 50,
      large: 200,
      largeTopologyWeight: 0.5,
    },
  });
  assertEquals(config.adaptiveMutationThresholds.medium, 50);
  assertEquals(config.adaptiveMutationThresholds.large, 200);
  assertEquals(config.adaptiveMutationThresholds.largeTopologyWeight, 0.5);
});

Deno.test("AdaptiveMutationThresholds - partial overrides keep other defaults", () => {
  const config = createNeatConfig({
    adaptiveMutationThresholds: {
      medium: 50,
      large: 200,
    },
  });
  assertEquals(config.adaptiveMutationThresholds.medium, 50);
  assertEquals(config.adaptiveMutationThresholds.large, 200);
  assertEquals(
    config.adaptiveMutationThresholds.largeTopologyWeight,
    DEFAULT_ADAPTIVE_MUTATION_THRESHOLDS.largeTopologyWeight,
  );
});

Deno.test("AdaptiveMutationThresholds - validation: large must be greater than medium", () => {
  try {
    createNeatConfig({
      adaptiveMutationThresholds: {
        medium: 100,
        large: 50, // Less than medium
      },
    });
    fail("Should throw when large <= medium");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes(
        "large threshold must be greater than medium",
      ),
      true,
      `Error should mention threshold ordering: ${(e as Error).message}`,
    );
  }
});

Deno.test("AdaptiveMutationThresholds - validation: equal values are rejected", () => {
  try {
    createNeatConfig({
      adaptiveMutationThresholds: {
        medium: 100,
        large: 100, // Equal to medium
      },
    });
    fail("Should throw when large === medium");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes(
        "large threshold must be greater than medium",
      ),
      true,
      `Error should mention threshold ordering: ${(e as Error).message}`,
    );
  }
});

Deno.test("AdaptiveMutationThresholds - string values are parsed from CLI", () => {
  const config = createNeatConfig({
    adaptiveMutationThresholds: {
      medium: "75" as unknown as number,
      large: "250" as unknown as number,
      largeTopologyWeight: "0.3" as unknown as number,
    },
  });
  assertEquals(config.adaptiveMutationThresholds.medium, 75);
  assertEquals(config.adaptiveMutationThresholds.large, 250);
  assertEquals(config.adaptiveMutationThresholds.largeTopologyWeight, 0.3);
});
