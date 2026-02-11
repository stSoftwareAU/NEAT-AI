/**
 * Issue #1280: TDD tests for parsing and validating NeatOptions when building NeatConfig.
 *
 * - Valid numeric values (number and string) → parsed and accepted
 * - Invalid values (non-numeric string, out-of-range) → clear error thrown
 * - Missing option → default used
 */
import { assertEquals, fail } from "@std/assert";
import {
  createNeatConfig,
  DEFAULT_COST_OF_GROWTH,
  DEFAULT_DISCOVERY_RECORD_TIMEOUT_MINUTES,
  DEFAULT_DISCOVERY_SAMPLE_RATE,
} from "../../src/config/NeatConfig.ts";

Deno.test("NeatConfigParseOptions - trainingSampleRate accepts number", () => {
  const config = createNeatConfig({ trainingSampleRate: 0.5 });
  assertEquals(config.trainingSampleRate, 0.5);
});

Deno.test("NeatConfigParseOptions - trainingSampleRate accepts string", () => {
  const config = createNeatConfig({ trainingSampleRate: "0.5" });
  assertEquals(config.trainingSampleRate, 0.5);
});

Deno.test("NeatConfigParseOptions - trainingSampleRate invalid string throws clear error", () => {
  try {
    createNeatConfig({ trainingSampleRate: "abc" });
    fail("Expected error for invalid trainingSampleRate");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("Training Sample Rate must be a number"),
      true,
      `Error: ${(e as Error).message}`,
    );
  }
});

Deno.test("NeatConfigParseOptions - trainingSampleRate out of range throws clear error", () => {
  try {
    createNeatConfig({ trainingSampleRate: 2 });
    fail("Expected error for out-of-range trainingSampleRate");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("Training Sample Rate must be between"),
      true,
      `Error: ${(e as Error).message}`,
    );
  }
});

Deno.test("NeatConfigParseOptions - trainingSampleRate missing uses default", () => {
  const config = createNeatConfig({});
  assertEquals(config.trainingSampleRate, 1);
});

Deno.test("NeatConfigParseOptions - targetError accepts number and string", () => {
  assertEquals(createNeatConfig({ targetError: 0.1 }).targetError, 0.1);
  assertEquals(createNeatConfig({ targetError: "0.1" }).targetError, 0.1);
});

Deno.test("NeatConfigParseOptions - targetError invalid string throws", () => {
  try {
    createNeatConfig({ targetError: "not-a-number" });
    fail("Expected error for invalid targetError");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("Target error must be a number"),
      true,
      `Error: ${(e as Error).message}`,
    );
  }
});

Deno.test("NeatConfigParseOptions - targetError missing uses default", () => {
  assertEquals(createNeatConfig({}).targetError, 0.05);
});

Deno.test("NeatConfigParseOptions - costOfGrowth 0 is valid (not the default)", () => {
  const config = createNeatConfig({ costOfGrowth: 0 });
  assertEquals(config.costOfGrowth, 0);
});

Deno.test("NeatConfigParseOptions - costOfGrowth missing uses default", () => {
  const config = createNeatConfig({});
  assertEquals(config.costOfGrowth, DEFAULT_COST_OF_GROWTH);
});

Deno.test("NeatConfigParseOptions - sparseRatio accepts number and string", () => {
  assertEquals(createNeatConfig({ sparseRatio: 0.5 }).sparseRatio, 0.5);
  assertEquals(createNeatConfig({ sparseRatio: "0.5" }).sparseRatio, 0.5);
});

Deno.test("NeatConfigParseOptions - sparseRatio invalid string throws", () => {
  try {
    createNeatConfig({ sparseRatio: "invalid" });
    fail("Expected error for invalid sparseRatio");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("Sparse Ratio must be a number"),
      true,
      `Error: ${(e as Error).message}`,
    );
  }
});

Deno.test("NeatConfigParseOptions - timeoutMinutes accepts string", () => {
  const config = createNeatConfig({ timeoutMinutes: "10" });
  assertEquals(config.timeoutMinutes, 10);
});

Deno.test("NeatConfigParseOptions - populationSize accepts string", () => {
  const config = createNeatConfig({ populationSize: "100" });
  assertEquals(config.populationSize, 100);
});

Deno.test("NeatConfigParseOptions - dataSetPartitionBreak invalid string throws clear error", () => {
  try {
    createNeatConfig({ dataSetPartitionBreak: "abc" });
    fail("Expected error for non-numeric dataSetPartitionBreak");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("Data Set Partition Break"),
      true,
      `Error should mention field: ${(e as Error).message}`,
    );
    assertEquals(
      (e as Error).message.includes("abc"),
      true,
      `Error should include invalid value: ${(e as Error).message}`,
    );
  }
});

Deno.test("NeatConfigParseOptions - discoverySampleRate -1 (disabled) accepted", () => {
  const config = createNeatConfig({ discoverySampleRate: -1 });
  assertEquals(config.discoverySampleRate, -1);
});

Deno.test("NeatConfigParseOptions - discoverySampleRate -1 as string accepted", () => {
  const config = createNeatConfig({ discoverySampleRate: "-1" });
  assertEquals(config.discoverySampleRate, -1);
});

Deno.test("NeatConfigParseOptions - discoverySampleRate 0 and 0.05 and 1 accepted", () => {
  assertEquals(
    createNeatConfig({ discoverySampleRate: 0 }).discoverySampleRate,
    0,
  );
  assertEquals(
    createNeatConfig({ discoverySampleRate: 0.05 }).discoverySampleRate,
    0.05,
  );
  assertEquals(
    createNeatConfig({ discoverySampleRate: 1 }).discoverySampleRate,
    1,
  );
});

Deno.test("NeatConfigParseOptions - discoverySampleRate other negative (e.g. -0.12) throws", () => {
  try {
    createNeatConfig({ discoverySampleRate: -0.12 });
    fail("Expected error for discoverySampleRate -0.12");
  } catch (e) {
    const msg = (e as Error).message;
    assertEquals(
      msg.includes(
        "Discovery sample rate must be -1 (disabled) or between 0 and 1",
      ),
      true,
      `Error: ${msg}`,
    );
    assertEquals(
      msg.includes("-0.12"),
      true,
      `Error should include value: ${msg}`,
    );
  }
});

Deno.test("NeatConfigParseOptions - discoverySampleRate missing uses default", () => {
  assertEquals(
    createNeatConfig({}).discoverySampleRate,
    DEFAULT_DISCOVERY_SAMPLE_RATE,
  );
});

Deno.test("NeatConfigParseOptions - discoverySampleRate default is 0.2 (#1386)", () => {
  assertEquals(DEFAULT_DISCOVERY_SAMPLE_RATE, 0.2);
  assertEquals(createNeatConfig({}).discoverySampleRate, 0.2);
});

Deno.test("NeatConfigParseOptions - discoveryRecordTimeOutMinutes missing uses default", () => {
  assertEquals(
    createNeatConfig({}).discoveryRecordTimeOutMinutes,
    DEFAULT_DISCOVERY_RECORD_TIMEOUT_MINUTES,
  );
});

Deno.test("NeatConfigParseOptions - discoveryRecordTimeOutMinutes default is 5 (#1386)", () => {
  assertEquals(DEFAULT_DISCOVERY_RECORD_TIMEOUT_MINUTES, 5);
  assertEquals(createNeatConfig({}).discoveryRecordTimeOutMinutes, 5);
});

Deno.test("NeatConfigParseOptions - discoverySampleRate explicit override still works", () => {
  assertEquals(
    createNeatConfig({ discoverySampleRate: 0.05 }).discoverySampleRate,
    0.05,
  );
  assertEquals(
    createNeatConfig({ discoverySampleRate: 0.5 }).discoverySampleRate,
    0.5,
  );
});

Deno.test("NeatConfigParseOptions - discoveryRecordTimeOutMinutes explicit override still works", () => {
  assertEquals(
    createNeatConfig({ discoveryRecordTimeOutMinutes: 1 })
      .discoveryRecordTimeOutMinutes,
    1,
  );
  assertEquals(
    createNeatConfig({ discoveryRecordTimeOutMinutes: 10 })
      .discoveryRecordTimeOutMinutes,
    10,
  );
});
