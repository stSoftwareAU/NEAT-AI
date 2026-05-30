/**
 * Seed warm-up tag persistence (export / load round-trip).
 */
import { assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import {
  creatureForProblem,
  CURRENT_GENERATION_TAG,
  readCurrentGenerationFromCreature,
  readWarmupGenerationsFromCreature,
  WARMUP_GENERATIONS_TAG,
  writeSeedWarmupProgressTags,
} from "@architecture/CreatureFactory.ts";

Deno.test("readCurrentGenerationFromCreature: absent tag returns 0", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  assertEquals(readCurrentGenerationFromCreature(creature), 0);
});

Deno.test("readCurrentGenerationFromCreature: invalid tag returns 0", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  addTag(creature, CURRENT_GENERATION_TAG, "not-a-number");
  assertEquals(readCurrentGenerationFromCreature(creature), 0);
});

Deno.test("writeSeedWarmupProgressTags: both tags survive exportJSON and loadFrom", () => {
  const creature = creatureForProblem({
    inputs: 4,
    outputs: 1,
    cost: "MSE",
    warmupGenerations: 25,
  });
  writeSeedWarmupProgressTags(creature, 25, 12);

  const json = creature.exportJSON();
  const warmupTag = json.tags?.find((t) => t.name === WARMUP_GENERATIONS_TAG);
  const generationTag = json.tags?.find((t) =>
    t.name === CURRENT_GENERATION_TAG
  );
  assertEquals(warmupTag?.value, "25");
  assertEquals(generationTag?.value, "12");

  const loaded = Creature.fromJSON(json);
  assertEquals(readWarmupGenerationsFromCreature(loaded), 25);
  assertEquals(readCurrentGenerationFromCreature(loaded), 12);
});

Deno.test("writeSeedWarmupProgressTags: updated generation survives re-export", () => {
  const creature = creatureForProblem({
    inputs: 4,
    outputs: 1,
    warmupGenerations: 10,
  });
  writeSeedWarmupProgressTags(creature, 10, 3);
  writeSeedWarmupProgressTags(creature, 10, 4);

  const loaded = Creature.fromJSON(creature.exportJSON());
  assertEquals(readCurrentGenerationFromCreature(loaded), 4);
  assertEquals(readWarmupGenerationsFromCreature(loaded), 10);
});
