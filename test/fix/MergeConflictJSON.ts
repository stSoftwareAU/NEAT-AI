import { assertEquals, assertThrows } from "@std/assert";
import { stripMergeConflictMarkers } from "@utils/MergeConflictCleaner.ts";
import { Creature } from "@creature";

// Build conflict marker strings programmatically so that the raw markers
// never appear at column 1 in this source file — this avoids false positives
// from the CI "Check for Merge Conflict Markers" step.
const OURS_TAG = "<".repeat(7) + " Updated upstream";
const THEIRS_TAG = ">".repeat(7) + " Stashed changes";
const HEAD_TAG = "<".repeat(7) + " HEAD";
const MAIN_TAG = ">".repeat(7) + " main";
const SEPARATOR = "=".repeat(7);

Deno.test(
  "stripMergeConflictMarkers: resolves git conflict markers keeping theirs side",
  () => {
    const conflicted = [
      `{`,
      ` "key": "before",`,
      OURS_TAG,
      ` "value": "ours"`,
      SEPARATOR,
      ` "value": "theirs"`,
      THEIRS_TAG,
      `}`,
    ].join("\n");

    const cleaned = stripMergeConflictMarkers(conflicted);
    const parsed = JSON.parse(cleaned);
    assertEquals(parsed.value, "theirs");
  },
);

Deno.test(
  "stripMergeConflictMarkers: handles multiple conflict blocks",
  () => {
    const conflicted = [
      `{`,
      ` "a": 1,`,
      OURS_TAG,
      ` "b": 2`,
      SEPARATOR,
      ` "b": 3`,
      THEIRS_TAG,
      `,`,
      HEAD_TAG,
      ` "c": 4`,
      SEPARATOR,
      ` "c": 5`,
      MAIN_TAG,
      `}`,
    ].join("\n");

    const cleaned = stripMergeConflictMarkers(conflicted);
    const parsed = JSON.parse(cleaned);
    assertEquals(parsed.b, 3);
    assertEquals(parsed.c, 5);
  },
);

Deno.test(
  "stripMergeConflictMarkers: returns unchanged text when no markers present",
  () => {
    const clean = `{"key": "value"}`;
    assertEquals(stripMergeConflictMarkers(clean), clean);
  },
);

Deno.test(
  "stripMergeConflictMarkers: handles real GRQ model conflict (issue #2103)",
  () => {
    const conflicted = [
      `{`,
      ` "semanticVersion": "4.0.0",`,
      ` "forwardOnly": true,`,
      ` "neurons": [`,
      `  {`,
      `   "type": "output",`,
      `   "id": -1,`,
      `   "bias": -0.05564856795471758,`,
      OURS_TAG,
      `   "squash": "LeakyReLU"`,
      SEPARATOR,
      `   "squash": "LeakyReLU",`,
      `   "uuid": "output-0"`,
      THEIRS_TAG,
      `  },`,
      `  {`,
      `   "type": "output",`,
      `   "id": -2,`,
      `   "bias": -0.3331931459113623,`,
      OURS_TAG,
      `   "squash": "Cube"`,
      SEPARATOR,
      `   "squash": "Cube",`,
      `   "uuid": "output-1"`,
      THEIRS_TAG,
      `  }`,
      ` ],`,
      ` "synapses": [`,
      `  {`,
      `   "weight": 0.1,`,
      `   "fromId": 0,`,
      `   "toId": -1`,
      `  }`,
      ` ]`,
      `}`,
    ].join("\n");

    const cleaned = stripMergeConflictMarkers(conflicted);
    const parsed = JSON.parse(cleaned);
    assertEquals(parsed.neurons[0].uuid, "output-0");
    assertEquals(parsed.neurons[1].uuid, "output-1");
    assertEquals(parsed.neurons[0].squash, "LeakyReLU");
    assertEquals(parsed.neurons[1].squash, "Cube");
  },
);

Deno.test(
  "stripMergeConflictMarkers: handles conflict with differing values",
  () => {
    const conflicted = [
      `{`,
      OURS_TAG,
      ` "bias": 0.003535602735860919,`,
      SEPARATOR,
      ` "bias": 0.0035363019429889395,`,
      THEIRS_TAG,
      ` "squash": "Swish"`,
      `}`,
    ].join("\n");

    const cleaned = stripMergeConflictMarkers(conflicted);
    const parsed = JSON.parse(cleaned);
    assertEquals(parsed.bias, 0.0035363019429889395);
  },
);

Deno.test(
  "fromPersistedText: loads creature from conflicted JSON text (issue #2103)",
  () => {
    const conflicted = [
      `{`,
      ` "semanticVersion": "4.0.0",`,
      ` "forwardOnly": true,`,
      ` "input": 1,`,
      ` "output": 1,`,
      ` "neurons": [`,
      `  {`,
      `   "type": "output",`,
      `   "id": -1,`,
      `   "bias": 0.1,`,
      OURS_TAG,
      `   "squash": "IDENTITY"`,
      SEPARATOR,
      `   "squash": "IDENTITY",`,
      `   "uuid": "output-0"`,
      THEIRS_TAG,
      `  }`,
      ` ],`,
      ` "synapses": [`,
      `  {`,
      `   "weight": 1.0,`,
      `   "fromId": 0,`,
      `   "toId": -1`,
      `  }`,
      ` ]`,
      `}`,
    ].join("\n");

    const creature = Creature.fromPersistedText(conflicted);
    assertEquals(creature.forwardOnly, true);
    assertEquals(creature.input, 1);
    assertEquals(creature.output, 1);
    creature.validate({ forwardOnly: true });
  },
);

Deno.test(
  "fromPersistedText: works with clean JSON too",
  () => {
    const clean = JSON.stringify({
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 2,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "output-0", weight: 0.3 },
      ],
    });

    const creature = Creature.fromPersistedText(clean);
    assertEquals(creature.input, 2);
    assertEquals(creature.output, 1);
    creature.validate({ forwardOnly: true });
  },
);

Deno.test(
  "stripMergeConflictMarkers: throws on unclosed conflict marker",
  () => {
    const malformed = [
      `{`,
      "<".repeat(7) + " Updated upstream",
      ` "key": "value"`,
      `}`,
    ].join("\n");

    assertThrows(
      () => stripMergeConflictMarkers(malformed),
      Error,
      "Unclosed merge conflict",
    );
  },
);
