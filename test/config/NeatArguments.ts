import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

Deno.test("NeatArguments - default array fields are empty arrays", () => {
  const config = createNeatConfig({});
  assertEquals(config.creatures.length, 0);
  assertEquals(config.CRISPRs.length, 0);
  assertEquals(config.focusList.length, 0);
  assertEquals(config.discoveryFocusNeuronUUIDs.length, 0);
});

Deno.test("NeatArguments - logger and rng are always present and callable", () => {
  const config = createNeatConfig({});
  assertNotEquals(config.logger, undefined);
  assertNotEquals(config.rng, undefined);
  // Verify callable rather than checking typeof
  config.logger.info("test");
  const rngValue = config.rng.random();
  assert(rngValue >= 0 && rngValue < 1, "rng.random() should return [0,1)");
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
  assert(
    config.mutation.length > 0,
    "Should have at least one default mutation",
  );
});

Deno.test("NeatArguments - selection is always present with a name", () => {
  const config = createNeatConfig({});
  assertNotEquals(config.selection, undefined);
  assert(
    config.selection.name.length > 0,
    "Selection should have a non-empty name",
  );
});
