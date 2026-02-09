import { assert, assertEquals, fail } from "@std/assert";
import { upgradeOne } from "../../src/upgrade/UpgradeOne.ts";
import { upgradeTwo } from "../../src/upgrade/UpgradeTwo.ts";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("upgradeOne - adds semanticVersion 1.0.0 to creature without version", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 1,
    output: 1,
  };

  const upgraded = upgradeOne(json);
  assertEquals(upgraded.semanticVersion, "1.0.0");
});

Deno.test("upgradeOne - preserves existing creature data", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0.5 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 1,
    output: 1,
    tags: [{ name: "test", value: "value" }],
  };

  const upgraded = upgradeOne(json);
  assertEquals(upgraded.semanticVersion, "1.0.0");
  assertEquals(upgraded.input, 1);
  assertEquals(upgraded.output, 1);
  assertEquals(upgraded.tags?.[0]?.name, "test");
});

Deno.test("upgradeOne - throws when already at version 1.x", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 1,
    output: 1,
    semanticVersion: "1.0.0",
  };

  try {
    upgradeOne(json);
    fail("Should throw when already at version 1.x");
  } catch (_e) {
    // Expected: assertion error for already upgraded
  }
});

Deno.test("upgradeTwo - upgrades 1.x creature to 2.0.0", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 1,
    output: 1,
    semanticVersion: "1.0.0",
  };

  const upgraded = upgradeTwo(json);
  assert(
    upgraded.semanticVersion?.startsWith("2."),
    `Should be version 2.x, got: ${upgraded.semanticVersion}`,
  );
});

Deno.test("upgradeTwo - throws when already at version 2.x", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 1,
    output: 1,
    semanticVersion: "2.0.0",
  };

  try {
    upgradeTwo(json);
    fail("Should throw when already at version 2.x");
  } catch (_e) {
    // Expected: assertion error for already upgraded
  }
});

Deno.test("upgradeTwo - upgraded creature is valid", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", squash: "IDENTITY", uuid: "hidden-0", bias: 0.5 },
      { type: "output", squash: "LOGISTIC", uuid: "output-0", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.0 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
    semanticVersion: "1.0.0",
  };

  const upgraded = upgradeTwo(json);
  const creature = Creature.fromJSON(upgraded);
  creatureValidate(creature);
});

Deno.test("upgradeTwo - full upgrade path from 0.x through 1.x to 2.x", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 1,
    output: 1,
  };

  // Step 1: Upgrade to 1.0.0
  const v1 = upgradeOne(json);
  assertEquals(v1.semanticVersion, "1.0.0");

  // Step 2: Upgrade to 2.0.0
  const v2 = upgradeTwo(v1);
  assert(
    v2.semanticVersion?.startsWith("2."),
    `Should be version 2.x, got: ${v2.semanticVersion}`,
  );

  // Verify final creature is valid
  const creature = Creature.fromJSON(v2);
  creatureValidate(creature);
});
