import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  getMajorVersion,
  upgrade,
  upgradeSemanticVersionIfForwardOnlyConfirmed,
} from "../../src/upgrade/Upgrade.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("getMajorVersion - extracts major version from string", () => {
  assertEquals(getMajorVersion("1.0.0"), 1);
  assertEquals(getMajorVersion("2.3.4"), 2);
  assertEquals(getMajorVersion("3.1.0"), 3);
  assertEquals(getMajorVersion("4.0.0"), 4);
  assertEquals(getMajorVersion("10.2.3"), 10);
});

Deno.test("getMajorVersion - returns 0 for undefined or invalid", () => {
  assertEquals(getMajorVersion(undefined), 0);
  assertEquals(getMajorVersion(""), 0);
  assertEquals(getMajorVersion("abc"), 0);
});

Deno.test("upgradeSemanticVersionIfForwardOnlyConfirmed - upgrades 2.x to 4.0.0", () => {
  const creature = { semanticVersion: "2.0.0" };
  upgradeSemanticVersionIfForwardOnlyConfirmed(creature);
  assertEquals(creature.semanticVersion, "4.0.0");
});

Deno.test("upgradeSemanticVersionIfForwardOnlyConfirmed - upgrades 3.x to 4.0.0", () => {
  const creature = { semanticVersion: "3.1.0" };
  upgradeSemanticVersionIfForwardOnlyConfirmed(creature);
  assertEquals(creature.semanticVersion, "4.0.0");
});

Deno.test("upgradeSemanticVersionIfForwardOnlyConfirmed - does not downgrade 4.x", () => {
  const creature = { semanticVersion: "4.1.2" };
  upgradeSemanticVersionIfForwardOnlyConfirmed(creature);
  assertEquals(creature.semanticVersion, "4.1.2");
});

Deno.test("upgradeSemanticVersionIfForwardOnlyConfirmed - does not change undefined", () => {
  const creature = { semanticVersion: undefined };
  upgradeSemanticVersionIfForwardOnlyConfirmed(creature);
  assertEquals(creature.semanticVersion, undefined);
});

Deno.test("upgrade - 2.x with forwardOnly true upgrades to 4.x", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 1,
    output: 1,
    semanticVersion: "2.0.0",
  });
  creature.forwardOnly = true;

  const upgraded = upgrade(creature);
  assertEquals(getMajorVersion(upgraded.semanticVersion), 4);
  creatureValidate(upgraded);
});

Deno.test("upgrade - 2.x without forwardOnly stays at 2.x", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 1,
    output: 1,
    semanticVersion: "2.0.0",
  });
  // forwardOnly is undefined by default

  const upgraded = upgrade(creature);
  assertEquals(getMajorVersion(upgraded.semanticVersion), 2);
});

Deno.test("upgrade - 4.x creature stays at 4.x", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 1,
    output: 1,
    semanticVersion: "4.0.0",
  });
  creature.forwardOnly = true;

  const upgraded = upgrade(creature);
  assertEquals(getMajorVersion(upgraded.semanticVersion), 4);
  assertEquals(upgraded.forwardOnly, true);
  creatureValidate(upgraded);
});

Deno.test("upgrade - 0.x creature upgrades through full path to 2.x+", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
    input: 1,
    output: 1,
  });
  // No semanticVersion = version 0

  const upgraded = upgrade(creature);
  const majorVersion = getMajorVersion(upgraded.semanticVersion);
  assert(majorVersion >= 2, `Should be at least 2.x, got: ${majorVersion}`);
  creatureValidate(upgraded);
});
