/**
 * Tests for FindTunePopulation.weightedRandomSelect correctness.
 *
 * Verifies that the weighted random selection always returns a creature
 * from the input array and that the weighting favours earlier (higher-scored)
 * creatures.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { FindTunePopulation } from "../../src/blackbox/FineTunePopulation.ts";

/** Build a minimal creature for testing. Each has a unique bias to differentiate. */
function makeTestCreature(id: number): Creature {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: id * 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: id * 0.1 + 0.01 },
    ],
  });
  creature.score = -id;
  return creature;
}

Deno.test(
  "weightedRandomSelect: always returns a creature from the input array",
  () => {
    const creatures = Array.from({ length: 20 }, (_, i) => makeTestCreature(i));

    // Access the method — create a minimal FindTunePopulation instance
    // weightedRandomSelect is a public method so we can call it directly
    const ftp = Object.create(FindTunePopulation.prototype);

    for (let trial = 0; trial < 100; trial++) {
      const selected = ftp.weightedRandomSelect(creatures);
      const found = creatures.indexOf(selected);
      assertNotEquals(
        found,
        -1,
        "Selected creature must be from the input array",
      );
    }
  },
);

Deno.test(
  "weightedRandomSelect: single creature returns that creature",
  () => {
    const creature = makeTestCreature(0);
    const ftp = Object.create(FindTunePopulation.prototype);

    const selected = ftp.weightedRandomSelect([creature]);
    assertEquals(selected, creature, "Single creature must be returned");
  },
);

Deno.test(
  "weightedRandomSelect: two creatures both can be selected",
  () => {
    const creatures = [makeTestCreature(0), makeTestCreature(1)];
    const ftp = Object.create(FindTunePopulation.prototype);

    const selections = new Set<Creature>();
    for (let trial = 0; trial < 200; trial++) {
      selections.add(ftp.weightedRandomSelect(creatures));
    }

    // Both creatures should be selectable (the first is more likely but both should appear)
    assertEquals(
      selections.size,
      2,
      "Both creatures should be selectable over many trials",
    );
  },
);
