/**
 * Creature topology mode: explicit construction, mode-switch API, and mutator gating.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { Creature, CURRENT_CREATURE_SEMANTIC_VERSION } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";
import { upgrade } from "@upgrade/Upgrade.ts";

Deno.test("CreatureModeSplit: fresh forward-only is 4.0.0", () => {
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  assertEquals(c.semanticVersion, CURRENT_CREATURE_SEMANTIC_VERSION);
  assertEquals(c.forwardOnly, true);
});

Deno.test("CreatureModeSplit: fresh feedbackEnabled is 4.0.0 and not forward-only", () => {
  const c = new Creature(2, 1, {
    layers: [{ count: 2 }],
    feedbackEnabled: true,
  });
  assertEquals(c.semanticVersion, CURRENT_CREATURE_SEMANTIC_VERSION);
  assertEquals(c.forwardOnly, false);
});

Deno.test("CreatureModeSplit: setForwardOnlyTopology strips recurrent edges", () => {
  const c = new Creature(2, 1, {
    layers: [{ count: 2 }],
    feedbackEnabled: true,
  });
  const hidden = c.neurons[c.input];
  c.connect(hidden.index, hidden.index, 0.1);
  c.setForwardOnlyTopology();
  assertEquals(c.forwardOnly, true);
  creatureValidate(c, { forwardOnly: true });
  assertEquals(c.synapses.some((s) => s.from === s.to), false);
});

Deno.test("CreatureModeSplit: setFeedbackEnabledTopology allows validate without forwardOnly", () => {
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  c.setFeedbackEnabledTopology();
  assertEquals(c.forwardOnly, false);
  assertEquals(c.semanticVersion, CURRENT_CREATURE_SEMANTIC_VERSION);
  creatureValidate(c);
});

Deno.test(
  "CreatureModeSplit: setFeedbackEnabledTopology does not mutate flags when validation fails",
  () => {
    const c = new Creature(2, 1, { layers: [{ count: 2 }] });
    const versionBefore = c.semanticVersion;
    const forwardOnlyBefore = c.forwardOnly;
    const majorBefore = c.cachedMajorVersion;
    c.synapses.length = 0;
    c.clearCache();
    assertThrows(() => c.setFeedbackEnabledTopology(), ValidationError);
    assertEquals(c.forwardOnly, forwardOnlyBefore);
    assertEquals(c.semanticVersion, versionBefore);
    assertEquals(c.cachedMajorVersion, majorBefore);
  },
);

Deno.test("CreatureModeSplit: forward-only mutator cannot select recurrent ops", () => {
  const config = createNeatConfig({
    populationSize: 4,
    mutation: [Mutation.ADD_SELF_CONN],
    feedbackLoop: true,
  });
  const mutator = new Mutator(config);
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  assertThrows(
    () => mutator.selectMutationMethod(c),
    ValidationError,
  );
});

Deno.test("CreatureModeSplit: feedback creature can select recurrent mutation when configured", () => {
  const config = createNeatConfig({
    populationSize: 4,
    mutation: [Mutation.ADD_SELF_CONN],
    feedbackLoop: true,
  });
  const mutator = new Mutator(config);
  const c = new Creature(2, 1, {
    layers: [{ count: 2 }],
    feedbackEnabled: true,
  });
  const method = mutator.selectMutationMethod(c);
  assertEquals(method.name, Mutation.ADD_SELF_CONN.name);
});

Deno.test("CreatureModeSplit: upgrade promotes legacy 2.x JSON with forwardOnly false", () => {
  const c = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "2.0.0",
  });
  c.forwardOnly = false;
  const u = upgrade(c);
  assertEquals(u.semanticVersion, "4.0.0");
  assertEquals(u.forwardOnly, false);
});
