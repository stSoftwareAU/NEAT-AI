import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { assertPathContained } from "@utils/PathContainment.ts";

/**
 * Issue #3670 — an unvalidated `uuid` from untrusted creature JSON reached
 * `Deno.remove(..., { recursive: true })` as a path component.
 */

function baseJSON(): CreatureInternal {
  return {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 1 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1 },
    ],
  } as unknown as CreatureInternal;
}

Deno.test("fromJSON rejects a uuid that escapes its directory", () => {
  const json = baseJSON();
  json.uuid = "../../../some/victim/dir";

  const error = assertThrows(
    () => Creature.fromJSON(json),
    ValidationError,
  ) as ValidationError;

  assertEquals(error.reason, "OTHER");
});

Deno.test("fromJSON rejects uuids containing a path separator", () => {
  for (
    const bad of [
      "..",
      "a/b",
      "/absolute/path",
      "..\\windows",
      "01234567-89ab-cdef-0123-456789abcdef/../..",
    ]
  ) {
    const json = baseJSON();
    json.uuid = bad;
    assertThrows(
      () => Creature.fromJSON(json),
      ValidationError,
      undefined,
      `expected uuid ${JSON.stringify(bad)} to be rejected`,
    );
  }
});

Deno.test("fromJSON rejects a non-UUID uuid", () => {
  for (const bad of ["", "base", "not-a-uuid", "0123456789abcdef"]) {
    const json = baseJSON();
    json.uuid = bad;
    assertThrows(
      () => Creature.fromJSON(json),
      ValidationError,
      undefined,
      `expected uuid ${JSON.stringify(bad)} to be rejected`,
    );
  }
});

/**
 * Issue #3843 — a well-formed uuid is accepted (the load succeeds) but never
 * adopted. A creature's uuid is content-derived, so one that arrived from
 * outside the process carries no guarantee that the neurons and synapses beside
 * it are the ones it was computed from. The validation above still rejects a
 * uuid that is not a uuid, because that means a corrupt or hostile file.
 */
Deno.test("fromJSON accepts a canonical uuid but does not adopt it", () => {
  const json = baseJSON();
  json.uuid = "01234567-89ab-cdef-0123-456789abcdef";

  const creature = Creature.fromJSON(json);
  assertEquals(creature.uuid, undefined);
});

Deno.test("fromJSON accepts an upper-case uuid and a generated uuid, adopting neither", () => {
  const upper = baseJSON();
  upper.uuid = "0123ABCD-89AB-4DEF-8123-456789ABCDEF";
  assertEquals(Creature.fromJSON(upper).uuid, undefined);

  const generated = baseJSON();
  generated.uuid = crypto.randomUUID();
  assertEquals(Creature.fromJSON(generated).uuid, undefined);
});

Deno.test("fromJSON still loads JSON with no uuid", () => {
  const creature = Creature.fromJSON(baseJSON());
  assertEquals(creature.uuid, undefined);
});

Deno.test("exportJSON round-trip survives uuid validation", () => {
  const original = Creature.fromJSON(baseJSON());
  const clone = Creature.fromJSON(original.exportJSON());
  assertEquals(clone.neurons.length, original.neurons.length);
  assertEquals(clone.synapses.length, original.synapses.length);
});

Deno.test("DiscoverStructure refuses a temp dir outside its base directory", () => {
  const creature = Creature.fromJSON(baseJSON());
  // Bypass the deserialisation guard to prove the second layer holds on its
  // own — any future caller-supplied component is contained too.
  creature.uuid = "../../escape";

  assertThrows(
    () =>
      new DiscoverStructure(creature, 60, undefined, {}, {
        baseDirectory: ".discovery/issue-3670",
      }),
    ValidationError,
    "escapes base directory",
  );
});

Deno.test("DiscoverStructure accepts a contained temp dir", async () => {
  const creature = Creature.fromJSON(baseJSON());
  creature.uuid = crypto.randomUUID();
  const baseDirectory = `.discovery/issue-3670-${creature.uuid}`;

  try {
    const discover = new DiscoverStructure(creature, 60, undefined, {}, {
      baseDirectory,
    });
    assertEquals(typeof discover, "object");
  } finally {
    await Deno.remove(baseDirectory, { recursive: true });
  }
});

Deno.test("assertPathContained allows the base itself and descendants", () => {
  assertPathContained("/tmp/base", "/tmp/base", "test");
  assertPathContained("/tmp/base", "/tmp/base/child/grandchild", "test");
  assertPathContained("/tmp/base/", "/tmp/base/child", "test");
  // A sibling whose name merely starts with the base name is not contained.
  assertThrows(
    () => assertPathContained("/tmp/base", "/tmp/base-evil", "test"),
    ValidationError,
  );
  assertThrows(
    () => assertPathContained("/tmp/base", "/tmp/base/../outside", "test"),
    ValidationError,
  );
});
