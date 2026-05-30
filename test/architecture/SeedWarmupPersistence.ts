/**
 * Seed warm-up tag persistence (export / load round-trip).
 */
import { assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Offspring } from "@architecture/Offspring.ts";
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

Deno.test("Offspring.breed: warm-up tags survive standard breeding", () => {
  const mum = Creature.fromJSON({
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
    ],
  } as CreatureExport);
  const dad = Creature.fromJSON({
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.7 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.2 },
    ],
  } as CreatureExport);
  writeSeedWarmupProgressTags(mum, 25, 12);
  writeSeedWarmupProgressTags(dad, 25, 12);

  let child: Creature | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    child = Offspring.breed(mum, dad, { forwardOnly: true });
    if (child) break;
  }

  assertEquals(child !== undefined, true);
  assertEquals(readWarmupGenerationsFromCreature(child!), 25);
  assertEquals(readCurrentGenerationFromCreature(child!), 12);
});

Deno.test("Offspring.breed: warm-up tags survive grafted breeding", () => {
  const mum = creatureForProblem({
    inputs: 3,
    outputs: 1,
    warmupGenerations: 40,
  });
  const dad = creatureForProblem({
    inputs: 3,
    outputs: 1,
    warmupGenerations: 40,
  });
  writeSeedWarmupProgressTags(mum, 40, 7);
  writeSeedWarmupProgressTags(dad, 40, 7);

  let child: Creature | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    child = Offspring.breed(mum, dad, {
      forwardOnly: true,
      geneticCompatibilityThreshold: 1.1,
    });
    if (child) break;
  }

  assertEquals(child !== undefined, true);
  assertEquals(readWarmupGenerationsFromCreature(child!), 40);
  assertEquals(readCurrentGenerationFromCreature(child!), 7);
});
