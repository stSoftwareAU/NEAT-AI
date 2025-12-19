import { assertEquals } from "@std/assert";
import { Creature } from "../../mod.ts";
import { SEMANTIC_MAJOR_VERSION, upgrade } from "../../src/upgrade/Upgrade.ts";

Deno.test("SEMANTIC_MAJOR_VERSION should be 3", () => {
  assertEquals(
    SEMANTIC_MAJOR_VERSION,
    3,
    "Current semantic major version should be 3",
  );
});

Deno.test("upgrade should not modify 3.x creatures", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "3.0.0",
  });

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "3.0.0",
    "3.x creatures should not be modified",
  );
});

Deno.test("upgrade should not modify 3.x.x creatures with patch versions", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "3.1.5",
  });

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "3.1.5",
    "3.x.x creatures should retain their version",
  );
});

Deno.test("upgrade should not modify future 4.x creatures", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "4.0.0",
  });

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "4.0.0",
    "Future version creatures should not be downgraded",
  );
});

Deno.test("upgrade should not modify future 10.x creatures", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "10.2.3",
  });

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion,
    "10.2.3",
    "Future major versions should be preserved",
  );
});

Deno.test("upgrade should upgrade 2.x creatures to 3.x", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "2.0.0",
  });

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion.startsWith("3."),
    true,
    "2.x creatures should be upgraded to 3.x",
  );
});

Deno.test("upgrade should upgrade 1.x creatures through 2.x to 3.x", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "1.0.0",
  });

  const upgraded = upgrade(creature);

  assertEquals(
    upgraded.semanticVersion.startsWith("3."),
    true,
    "1.x creatures should be upgraded to 3.x",
  );
});
