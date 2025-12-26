import { assertEquals } from "@std/assert";
import { Creature } from "../../mod.ts";
import { SEMANTIC_MAJOR_VERSION, upgrade } from "../../src/upgrade/Upgrade.ts";

/**
 * Tests for the upgrade() function.
 *
 * Version 4.x indicates the creature has been validated as strictly forward-only
 * (no recurrent connections). Once at 4.x, the creature must remain forward-only
 * and any violation is an error condition.
 *
 * - forwardOnly: true + validated = upgrade to 4.x
 * - forwardOnly: false = stay at 2.x (explicitly allows feedback loops)
 * - forwardOnly: undefined = stay at 2.x (status not yet determined)
 */

Deno.test("SEMANTIC_MAJOR_VERSION should be 3", () => {
  assertEquals(
    SEMANTIC_MAJOR_VERSION,
    4,
    "Current semantic major version should be 4",
  );
});

// === 2.x creatures with undefined forwardOnly stay at 2.x ===

Deno.test("upgrade should not modify 2.x creatures with undefined forwardOnly", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "2.0.0",
  });
  // forwardOnly is undefined by default

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "2.0.0",
    "2.x creatures with undefined forwardOnly should stay at 2.x",
  );
});

Deno.test("upgrade should not modify 2.x.x creatures with patch versions and undefined forwardOnly", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "2.1.5",
  });

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "2.1.5",
    "2.x.x creatures with undefined forwardOnly should retain their version",
  );
});

// === 2.x creatures with forwardOnly: true upgrade to 3.x if valid ===

Deno.test("upgrade should upgrade 2.x creatures with forwardOnly: true to 4.x", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "2.0.0",
  });
  creature.forwardOnly = true;

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "4.0.0",
    "2.x creatures with forwardOnly: true should be upgraded to 4.x",
  );
  assertEquals(
    upgraded.forwardOnly,
    true,
    "forwardOnly flag should be preserved",
  );
});

// === 2.x creatures with forwardOnly: false stay at 2.x ===

Deno.test("upgrade should not modify 2.x creatures with forwardOnly: false", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "2.0.0",
  });
  creature.forwardOnly = false;

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "2.0.0",
    "2.x creatures with forwardOnly: false should stay at 2.x (allows feedback loops)",
  );
  assertEquals(
    upgraded.forwardOnly,
    false,
    "forwardOnly: false should be preserved",
  );
});

// === 3.x creatures are validated and should not be modified ===

Deno.test("upgrade should validate and not modify valid 3.x creatures", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "3.0.0",
  });

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "3.0.0",
    "Valid 3.x creatures should not be modified",
  );
});

Deno.test("upgrade should validate and not modify 3.x.x creatures with patch versions", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "3.1.5",
  });

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "3.1.5",
    "Valid 3.x.x creatures should retain their version",
  );
});

// === 3.x creatures with self/back connections should log warning but not modify ===

Deno.test("upgrade should log warning but not modify 3.x creature with self-connection", () => {
  // Create a creature and manually add a self-connection to simulate the error
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "3.0.0",
  });

  // Add a self-connection (synapse where from === to)
  const hiddenNeuron = creature.neurons[creature.input]; // First hidden neuron
  creature.connect(hiddenNeuron.index, hiddenNeuron.index, 0.5);

  // Should not throw and should not modify - just log a warning
  // (Fixing should only happen on offspring, not parents during breeding)
  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "3.0.0",
    "3.x creatures should not be modified by upgrade() - offspring validation handles fixing",
  );

  // Verify the self-connection was NOT removed (creature not modified)
  const selfConnection = upgraded.getSynapse(
    hiddenNeuron.index,
    hiddenNeuron.index,
  );
  assertEquals(
    selfConnection !== null,
    true,
    "Self-connection should NOT be removed - fixing happens on offspring only",
  );
});

// === Future versions should be validated ===

Deno.test("upgrade should validate and not modify valid 4.x creatures", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "4.0.0",
  });

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "4.0.0",
    "Valid 4.x creatures should be validated and not downgraded",
  );
});

/**
 * Test for https://github.com/stSoftwareAU/NEAT-AI/issues/956
 *
 * A 4.x creature with recurrent connections should be repaired automatically.
 * This allows production workflows to continue whilst logging a warning for
 * investigation. The recurrent connections are removed during repair.
 */
Deno.test("upgrade should repair corrupted 4.x creatures with recurrent connections", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "4.0.0",
  });
  creature.forwardOnly = true;

  const hiddenNeuron = creature.neurons[creature.input]; // First hidden neuron
  // Inject a recurrent self-loop. `connect()` guards against adding recurrent
  // links when `forwardOnly` is set, so temporarily clear the flag to simulate
  // a corrupted persisted creature.
  creature.forwardOnly = undefined;
  creature.connect(hiddenNeuron.index, hiddenNeuron.index, 0.5);
  creature.forwardOnly = true;

  // Act: upgrading a corrupted 4.x creature should repair it.
  const upgraded = upgrade(creature);

  // Assert: creature should now be valid and still 4.x.
  upgraded.validate({ forwardOnly: true });
  assertEquals(upgraded.forwardOnly, true);
  const major = parseInt(upgraded.semanticVersion?.split(".")[0] ?? "0", 10);
  assertEquals(major, 4);

  // The self connection should have been removed.
  const hasSelfConnection = upgraded.synapses.some((s) => s.from === s.to);
  assertEquals(
    hasSelfConnection,
    false,
    "Self connections should be removed",
  );
});

Deno.test("upgrade should validate and not modify future 10.x creatures", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "10.2.3",
  });

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "10.2.3",
    "Future major versions should be validated and preserved",
  );
});

// === 1.x creatures upgrade to 2.x (or 3.x if forwardOnly: true) ===

Deno.test("upgrade should upgrade 1.x creatures to 2.x when forwardOnly undefined", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "1.0.0",
  });

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion.startsWith("2."),
    true,
    "1.x creatures with undefined forwardOnly should be upgraded to 2.x",
  );
});

Deno.test("upgrade should upgrade 1.x creatures with forwardOnly: true to 4.x", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "1.0.0",
  });
  creature.forwardOnly = true;

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "4.0.0",
    "1.x creatures with forwardOnly: true should be upgraded to 4.x",
  );
});

// === 0.x/undefined/invalid versions upgrade to 2.x (or 3.x if forwardOnly: true) ===

Deno.test("upgrade should handle 0.x creatures by upgrading to 2.x when forwardOnly undefined", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "0.1.0",
  });

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion.startsWith("2."),
    true,
    "0.x creatures with undefined forwardOnly should be upgraded to 2.x",
  );
});

Deno.test("upgrade should handle creatures without semanticVersion by upgrading to 2.x", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });

  // Remove the semanticVersion to simulate an old creature without versioning
  delete (creature as unknown as { semanticVersion?: string }).semanticVersion;

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion.startsWith("2."),
    true,
    "Creatures without semanticVersion should be upgraded to 2.x",
  );
});

Deno.test("upgrade should handle creatures with invalid version format by upgrading to 2.x", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });

  // Set an invalid version format
  (creature as unknown as { semanticVersion: string }).semanticVersion =
    "invalid";

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion.startsWith("2."),
    true,
    "Creatures with invalid version format should be upgraded to 2.x",
  );
});
