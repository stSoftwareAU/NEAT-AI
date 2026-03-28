/**
 * Tests for cached forwardOnlyGuaranteed property.
 * Issue #1535: Cache forwardOnlyGuaranteed flag instead of parsing
 * semanticVersion per activation.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";

Deno.test("forwardOnlyGuaranteed - v4 forward-only creature is true", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "4.0.0",
    layers: [{ count: 2 }],
  });

  assertEquals(
    creature.forwardOnlyGuaranteed,
    true,
    "v4+ forward-only creature should have forwardOnlyGuaranteed=true",
  );
});

Deno.test("forwardOnlyGuaranteed - v3 creature is false", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "3.9.0",
    layers: [{ count: 2 }],
  });

  assertEquals(
    creature.forwardOnlyGuaranteed,
    false,
    "v3 creature should have forwardOnlyGuaranteed=false",
  );
});

Deno.test("forwardOnlyGuaranteed - default version is false", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });

  assertEquals(
    creature.forwardOnlyGuaranteed,
    false,
    "Default v0.0.1 creature should have forwardOnlyGuaranteed=false",
  );
});

Deno.test("forwardOnlyGuaranteed - v5 forward-only creature is true", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "5.1.0",
    layers: [{ count: 2 }],
  });

  assertEquals(
    creature.forwardOnlyGuaranteed,
    true,
    "v5+ forward-only creature should have forwardOnlyGuaranteed=true",
  );
});

Deno.test("forwardOnlyGuaranteed - preserved through fromJSON", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "4.0.0",
    layers: [{ count: 2 }],
  });

  const json = creature.exportInternalJSON();
  const restored = Creature.fromJSON(json);

  assertEquals(
    restored.forwardOnlyGuaranteed,
    true,
    "forwardOnlyGuaranteed should survive JSON round-trip for v4+ creature",
  );
});

Deno.test("forwardOnlyGuaranteed - preserved through shallowClone", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "4.0.0",
    layers: [{ count: 2 }],
  });

  const clone = creature.shallowClone();

  assertEquals(
    clone.forwardOnlyGuaranteed,
    true,
    "forwardOnlyGuaranteed should survive shallowClone for v4+ creature",
  );
});

Deno.test("forwardOnlyGuaranteed - false preserved through fromJSON", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "3.0.0",
    layers: [{ count: 2 }],
  });

  const json = creature.exportInternalJSON();
  const restored = Creature.fromJSON(json);

  assertEquals(
    restored.forwardOnlyGuaranteed,
    false,
    "forwardOnlyGuaranteed=false should survive JSON round-trip",
  );
});

Deno.test("forwardOnlyGuaranteed - false preserved through shallowClone", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "3.0.0",
    layers: [{ count: 2 }],
  });

  const clone = creature.shallowClone();

  assertEquals(
    clone.forwardOnlyGuaranteed,
    false,
    "forwardOnlyGuaranteed=false should survive shallowClone",
  );
});

Deno.test("forwardOnlyGuaranteed - invalid version returns false", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "abc.1.0",
    layers: [{ count: 2 }],
  });

  assertEquals(
    creature.forwardOnlyGuaranteed,
    false,
    "Invalid semantic version should result in forwardOnlyGuaranteed=false",
  );
});
