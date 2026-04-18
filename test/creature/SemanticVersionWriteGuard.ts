/**
 * Regression tests for Issue #2349: creature JSON files must always carry
 * a valid semanticVersion when written to disk.
 *
 * Covers:
 * - fromJSON with empty / undefined / missing semanticVersion
 * - Constructor with empty semanticVersion
 * - exportJSON always produces a valid version
 * - writeCreatures produces files with valid semanticVersion
 * - Validation utility (isValidWriteableSemanticVersion)
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { CURRENT_CREATURE_SEMANTIC_VERSION } from "@creature";
import {
  assertValidWriteableSemanticVersion,
  isValidWriteableSemanticVersion,
} from "@upgrade/SemanticVersionValidation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// ---------- Validation utility tests ----------

Deno.test(
  "isValidWriteableSemanticVersion rejects empty string",
  () => {
    assertEquals(isValidWriteableSemanticVersion(""), false);
  },
);

Deno.test(
  "isValidWriteableSemanticVersion rejects undefined",
  () => {
    assertEquals(isValidWriteableSemanticVersion(undefined), false);
  },
);

Deno.test(
  "isValidWriteableSemanticVersion rejects 0.x versions",
  () => {
    assertEquals(isValidWriteableSemanticVersion("0.0.1"), false);
  },
);

Deno.test(
  "isValidWriteableSemanticVersion rejects 1.x versions",
  () => {
    assertEquals(isValidWriteableSemanticVersion("1.0.0"), false);
  },
);

Deno.test(
  "isValidWriteableSemanticVersion accepts 2.0.0",
  () => {
    assertEquals(isValidWriteableSemanticVersion("2.0.0"), true);
  },
);

Deno.test(
  "isValidWriteableSemanticVersion accepts 4.0.0",
  () => {
    assertEquals(isValidWriteableSemanticVersion("4.0.0"), true);
  },
);

Deno.test(
  "isValidWriteableSemanticVersion accepts 10.1.3",
  () => {
    assertEquals(isValidWriteableSemanticVersion("10.1.3"), true);
  },
);

Deno.test(
  "isValidWriteableSemanticVersion rejects non-semver strings",
  () => {
    assertEquals(isValidWriteableSemanticVersion("abc"), false);
    assertEquals(isValidWriteableSemanticVersion("4"), false);
    assertEquals(isValidWriteableSemanticVersion("4.0"), false);
  },
);

Deno.test(
  "assertValidWriteableSemanticVersion throws on empty string",
  () => {
    assertThrows(
      () => assertValidWriteableSemanticVersion(""),
      Error,
      "Invalid semanticVersion",
    );
  },
);

Deno.test(
  "assertValidWriteableSemanticVersion throws on undefined",
  () => {
    assertThrows(
      () => assertValidWriteableSemanticVersion(undefined),
      Error,
      "Invalid semanticVersion",
    );
  },
);

Deno.test(
  "assertValidWriteableSemanticVersion passes on 4.0.0",
  () => {
    assertValidWriteableSemanticVersion("4.0.0"); // should not throw
  },
);

// ---------- fromJSON with empty/missing semanticVersion ----------

Deno.test(
  "fromJSON with empty semanticVersion defaults to current version",
  () => {
    const json = {
      neurons: [
        {
          type: "hidden" as const,
          squash: "LOGISTIC",
          bias: 0.1,
          uuid: "sv-guard-1111",
        },
        {
          type: "output" as const,
          squash: "IDENTITY",
          bias: 0.0,
          uuid: "output-0",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "sv-guard-1111", weight: 1.0 },
        { fromUUID: "sv-guard-1111", toUUID: "output-0", weight: 0.5 },
      ],
      input: 1,
      output: 1,
      semanticVersion: "",
    };

    const creature = Creature.fromJSON(json);
    assertEquals(
      creature.semanticVersion,
      CURRENT_CREATURE_SEMANTIC_VERSION,
      "Empty semanticVersion should be replaced with current version",
    );
    assert(
      isValidWriteableSemanticVersion(creature.semanticVersion),
      "Resulting version must be writeable",
    );
  },
);

Deno.test(
  "fromJSON with undefined semanticVersion defaults to current version",
  () => {
    const json = {
      neurons: [
        {
          type: "hidden" as const,
          squash: "LOGISTIC",
          bias: 0.1,
          uuid: "sv-guard-2222",
        },
        {
          type: "output" as const,
          squash: "IDENTITY",
          bias: 0.0,
          uuid: "output-0",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "sv-guard-2222", weight: 1.0 },
        { fromUUID: "sv-guard-2222", toUUID: "output-0", weight: 0.5 },
      ],
      input: 1,
      output: 1,
    };

    const creature = Creature.fromJSON(json);
    assert(
      isValidWriteableSemanticVersion(creature.semanticVersion),
      `semanticVersion "${creature.semanticVersion}" should be valid writeable version`,
    );
  },
);

// ---------- Constructor edge case ----------

Deno.test(
  "constructor with empty semanticVersion uses default",
  () => {
    const creature = new Creature(1, 1, {
      semanticVersion: "",
    });
    assertEquals(
      creature.semanticVersion,
      CURRENT_CREATURE_SEMANTIC_VERSION,
      "Empty string semanticVersion should be replaced by default",
    );
  },
);

// ---------- exportJSON always has valid semanticVersion ----------

Deno.test(
  "exportJSON includes valid semanticVersion after fromJSON with empty version",
  () => {
    const json = {
      neurons: [
        {
          type: "hidden" as const,
          squash: "LOGISTIC",
          bias: 0.1,
          uuid: "sv-guard-3333",
        },
        {
          type: "output" as const,
          squash: "IDENTITY",
          bias: 0.0,
          uuid: "output-0",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "sv-guard-3333", weight: 1.0 },
        { fromUUID: "sv-guard-3333", toUUID: "output-0", weight: 0.5 },
      ],
      input: 1,
      output: 1,
      semanticVersion: "",
    };

    const creature = Creature.fromJSON(json);
    const exported = creature.exportJSON();

    assert(
      exported.semanticVersion !== undefined && exported.semanticVersion !== "",
      `exportJSON must never produce empty semanticVersion, got: "${exported.semanticVersion}"`,
    );
    assert(
      isValidWriteableSemanticVersion(exported.semanticVersion),
      `exportJSON semanticVersion "${exported.semanticVersion}" must be a valid writeable version`,
    );
  },
);

Deno.test(
  "exportJSON includes valid semanticVersion for a new creature",
  () => {
    const creature = new Creature(2, 1);
    const exported = creature.exportJSON();

    assert(
      isValidWriteableSemanticVersion(exported.semanticVersion),
      `New creature exportJSON must have valid version, got: "${exported.semanticVersion}"`,
    );
  },
);

// ---------- Round-trip with empty version ----------

Deno.test(
  "round-trip: fromJSON(empty version) → exportJSON → fromJSON preserves valid version",
  () => {
    const json = {
      neurons: [
        {
          type: "hidden" as const,
          squash: "LOGISTIC",
          bias: 0.1,
          uuid: "sv-guard-4444",
        },
        {
          type: "output" as const,
          squash: "IDENTITY",
          bias: 0.0,
          uuid: "output-0",
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "sv-guard-4444", weight: 1.0 },
        { fromUUID: "sv-guard-4444", toUUID: "output-0", weight: 0.5 },
      ],
      input: 1,
      output: 1,
      semanticVersion: "",
    };

    const creature1 = Creature.fromJSON(json);
    const exported1 = creature1.exportJSON();
    const creature2 = Creature.fromJSON(exported1);
    const exported2 = creature2.exportJSON();

    assertEquals(
      exported1.semanticVersion,
      exported2.semanticVersion,
      "Version must be stable across round-trips",
    );
    assert(
      isValidWriteableSemanticVersion(exported2.semanticVersion),
      "Version must remain valid after round-trip",
    );
  },
);
