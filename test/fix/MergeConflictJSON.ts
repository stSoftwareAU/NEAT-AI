import { assertEquals, assertThrows } from "@std/assert";
import { stripMergeConflictMarkers } from "@utils/MergeConflictCleaner.ts";
import { Creature } from "@creature";

Deno.test(
  "stripMergeConflictMarkers: resolves git conflict markers keeping theirs side",
  () => {
    const conflicted = `{
 "key": "before",
<<<<<<< Updated upstream
 "value": "ours"
=======
 "value": "theirs"
>>>>>>> Stashed changes
}`;

    const cleaned = stripMergeConflictMarkers(conflicted);
    const parsed = JSON.parse(cleaned);
    assertEquals(parsed.value, "theirs");
  },
);

Deno.test(
  "stripMergeConflictMarkers: handles multiple conflict blocks",
  () => {
    const conflicted = `{
 "a": 1,
<<<<<<< Updated upstream
 "b": 2
=======
 "b": 3
>>>>>>> Stashed changes
,
<<<<<<< HEAD
 "c": 4
=======
 "c": 5
>>>>>>> main
}`;

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
    const conflicted = `{
 "semanticVersion": "4.0.0",
 "forwardOnly": true,
 "neurons": [
  {
   "type": "output",
   "id": -1,
   "bias": -0.05564856795471758,
<<<<<<< Updated upstream
   "squash": "LeakyReLU"
=======
   "squash": "LeakyReLU",
   "uuid": "output-0"
>>>>>>> Stashed changes
  },
  {
   "type": "output",
   "id": -2,
   "bias": -0.3331931459113623,
<<<<<<< Updated upstream
   "squash": "Cube"
=======
   "squash": "Cube",
   "uuid": "output-1"
>>>>>>> Stashed changes
  }
 ],
 "synapses": [
  {
   "weight": 0.1,
   "fromId": 0,
   "toId": -1
  }
 ]
}`;

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
    const conflicted = `{
<<<<<<< Updated upstream
 "bias": 0.003535602735860919,
=======
 "bias": 0.0035363019429889395,
>>>>>>> Stashed changes
 "squash": "Swish"
}`;

    const cleaned = stripMergeConflictMarkers(conflicted);
    const parsed = JSON.parse(cleaned);
    assertEquals(parsed.bias, 0.0035363019429889395);
  },
);

Deno.test(
  "fromPersistedText: loads creature from conflicted JSON text (issue #2103)",
  () => {
    const conflicted = `{
 "semanticVersion": "4.0.0",
 "forwardOnly": true,
 "input": 1,
 "output": 1,
 "neurons": [
  {
   "type": "output",
   "id": -1,
   "bias": 0.1,
<<<<<<< Updated upstream
   "squash": "IDENTITY"
=======
   "squash": "IDENTITY",
   "uuid": "output-0"
>>>>>>> Stashed changes
  }
 ],
 "synapses": [
  {
   "weight": 1.0,
   "fromId": 0,
   "toId": -1
  }
 ]
}`;

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
    const malformed = `{
<<<<<<< Updated upstream
 "key": "value"
}`;

    assertThrows(
      () => stripMergeConflictMarkers(malformed),
      Error,
      "Unclosed merge conflict",
    );
  },
);
