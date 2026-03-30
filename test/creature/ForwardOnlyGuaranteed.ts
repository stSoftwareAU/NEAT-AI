/**
 * Tests for {@link Creature.forwardOnlyGuaranteed}: mirrors
 * {@link Creature.forwardOnly} === true (topology mode, not semantic version).
 */

import { assertEquals } from "@std/assert";
import { Creature } from "@creature";

Deno.test("forwardOnlyGuaranteed - forward-only creature is true", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "4.0.0",
    layers: [{ count: 2 }],
  });

  assertEquals(
    creature.forwardOnlyGuaranteed,
    true,
    "forward-only creature should have forwardOnlyGuaranteed=true",
  );
});

Deno.test("forwardOnlyGuaranteed - feedback-enabled creature is false", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "3.9.0",
    feedbackEnabled: true,
    layers: [{ count: 2 }],
  });

  assertEquals(
    creature.forwardOnlyGuaranteed,
    false,
    "feedback-enabled creature should have forwardOnlyGuaranteed=false",
  );
});

Deno.test("forwardOnlyGuaranteed - default fresh creature is true", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });

  assertEquals(
    creature.forwardOnlyGuaranteed,
    true,
    "Default fresh creature is forward-only",
  );
  assertEquals(creature.semanticVersion, "4.0.0");
});

Deno.test("forwardOnlyGuaranteed - high semantic version forward-only is true", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "5.1.0",
    layers: [{ count: 2 }],
  });

  assertEquals(
    creature.forwardOnlyGuaranteed,
    true,
    "forwardOnlyGuaranteed follows forwardOnly, not version string",
  );
});

Deno.test("forwardOnlyGuaranteed - preserved through fromJSON", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "4.0.0",
    layers: [{ count: 2 }],
  });

  const json = creature.exportJSON();
  const restored = Creature.fromJSON(json);

  assertEquals(
    restored.forwardOnlyGuaranteed,
    true,
    "forwardOnlyGuaranteed should survive JSON round-trip for forward-only creature",
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
    "forwardOnlyGuaranteed should survive shallowClone for forward-only creature",
  );
});

Deno.test("forwardOnlyGuaranteed - false preserved through fromJSON", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "4.0.0",
    feedbackEnabled: true,
    layers: [{ count: 2 }],
  });

  const json = creature.exportJSON();
  const restored = Creature.fromJSON(json);

  assertEquals(
    restored.forwardOnlyGuaranteed,
    false,
    "forwardOnlyGuaranteed=false should survive JSON round-trip",
  );
});

Deno.test("forwardOnlyGuaranteed - false preserved through shallowClone", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "4.0.0",
    feedbackEnabled: true,
    layers: [{ count: 2 }],
  });

  const clone = creature.shallowClone();

  assertEquals(
    clone.forwardOnlyGuaranteed,
    false,
    "forwardOnlyGuaranteed=false should survive shallowClone",
  );
});

Deno.test("forwardOnlyGuaranteed - invalid semantic version still true when forward-only", () => {
  const creature = new Creature(2, 1, {
    semanticVersion: "abc.1.0",
    layers: [{ count: 2 }],
  });

  assertEquals(
    creature.forwardOnlyGuaranteed,
    true,
    "Invalid semantic version does not override forward-only topology",
  );
});
