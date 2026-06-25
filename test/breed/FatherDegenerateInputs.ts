/**
 * Regression test for PR #3131: `createCompatibleFatherFromCreatures` must not
 * crash when a parent genome carries fewer (or reordered) neuron entries than
 * its declared `input` count.
 *
 * The end-to-end random-immigrants evolution path
 * (test/NEAT/RandomImmigrantsStagnationEscape.ts) bred a degenerate genome
 * whose `neurons` array held fewer entries than `mother.input`. The old code
 * indexed `motherNeurons[i]` positionally for `i < mother.input`, so the
 * missing entry was `undefined` and `.id` threw
 * `TypeError: Cannot read properties of undefined (reading 'id')`
 * (src/breed/Father.ts:662).
 *
 * Input neurons always use `id = inputIndex` (see NeuronId.ts), so the map is
 * built from `i` directly — robust to a short or reordered neuron array.
 */

import { assert, assertEquals } from "@std/assert";
import { createCompatibleFatherFromCreatures } from "@breed/Father.ts";
import { Creature } from "../../mod.ts";

Deno.test(
  "createCompatibleFatherFromCreatures: tolerates a genome with fewer neurons than its input count (PR #3131)",
  () => {
    const mother = new Creature(2, 1);
    const father = new Creature(2, 1);

    // Simulate the degenerate bred genome observed in production: trim the
    // neuron array so `mother.neurons.length < mother.input`. The old
    // positional access `motherNeurons[i].id` would read past the end of the
    // array and throw on the `undefined` slot.
    mother.neurons = mother.neurons.filter((n) => n.type !== "input");
    assert(
      mother.neurons.length < mother.input,
      "test setup: neurons array should now be shorter than input count",
    );

    // Must not throw; input ids map to `input-i` regardless of array shape.
    const adjusted = createCompatibleFatherFromCreatures(mother, father);
    assertEquals(adjusted.input, father.input);
    assertEquals(adjusted.output, father.output);
  },
);
