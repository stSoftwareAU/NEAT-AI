import { assertEquals, assertNotEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

Deno.test("NeatArguments - default array fields are empty arrays", () => {
  const config = createNeatConfig({});
  assertEquals(config.creatures.length, 0);
  assertEquals(config.CRISPRs.length, 0);
  assertEquals(config.focusList.length, 0);
  assertEquals(config.discoveryFocusNeuronUUIDs.length, 0);
});

Deno.test("NeatArguments - logger and rng are always present", () => {
  const config = createNeatConfig({});
  assertNotEquals(config.logger, undefined);
  assertNotEquals(config.rng, undefined);
  assertEquals(typeof config.logger.info, "function");
  assertEquals(typeof config.rng.random, "function");
});

Deno.test("NeatArguments - optional string fields default to undefined", () => {
  const config = createNeatConfig({});
  assertEquals(config.creatureStore, undefined);
  assertEquals(config.experimentStore, undefined);
  assertEquals(config.traceStore, undefined);
  assertEquals(config.discoveryBaseDirectory, undefined);
});

Deno.test("NeatArguments - mutation array is populated with default mutations", () => {
  const config = createNeatConfig({});
  assertNotEquals(config.mutation.length, 0);
});

Deno.test("NeatArguments - selection is always present", () => {
  const config = createNeatConfig({});
  assertNotEquals(config.selection, undefined);
  assertEquals(typeof config.selection.name, "string");
});
