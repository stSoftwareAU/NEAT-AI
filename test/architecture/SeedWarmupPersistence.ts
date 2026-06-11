/**
 * Seed warm-up tag persistence (export / load round-trip).
 */
import { assertEquals } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Offspring } from "@architecture/Offspring.ts";
import {
  applySeedWarmupTagsAtSave,
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

Deno.test("writeSeedWarmupProgressTags: never lowers an existing higher generation (Issue #2831)", () => {
  // Simulates the end-of-round tagging clobber: a fittest creature that
  // carried generation 30 (e.g. from a cross-bred ancestor on another
  // machine) must not be reset to a lower local counter (6).
  const creature = creatureForProblem({
    inputs: 4,
    outputs: 1,
    warmupGenerations: 25,
  });
  writeSeedWarmupProgressTags(creature, 25, 30);
  // A later write with a lower generation must keep the higher value.
  writeSeedWarmupProgressTags(creature, 25, 6);

  assertEquals(readCurrentGenerationFromCreature(creature), 30);
  assertEquals(readWarmupGenerationsFromCreature(creature), 25);
});

Deno.test("writeSeedWarmupProgressTags: still raises generation when higher (Issue #2831)", () => {
  const creature = creatureForProblem({
    inputs: 4,
    outputs: 1,
    warmupGenerations: 25,
  });
  writeSeedWarmupProgressTags(creature, 25, 6);
  writeSeedWarmupProgressTags(creature, 25, 14);

  assertEquals(readCurrentGenerationFromCreature(creature), 14);
});

Deno.test("Offspring.breed: carries the HIGHER of two differing parent generations (Issue #2831)", () => {
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
  // Differing generations: the offspring must inherit the larger (30).
  writeSeedWarmupProgressTags(mum, 25, 30);
  writeSeedWarmupProgressTags(dad, 25, 5);

  let child: Creature | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    child = Offspring.breed(mum, dad, { forwardOnly: true });
    if (child) break;
  }

  assertEquals(child !== undefined, true);
  assertEquals(readCurrentGenerationFromCreature(child!), 30);
  assertEquals(readWarmupGenerationsFromCreature(child!), 25);
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

// ─── Issue #2909: save-boundary stamping / stripping ────────────────────────

Deno.test("applySeedWarmupTagsAtSave: while warming stamps both tags from counter", () => {
  const creature = creatureForProblem({
    inputs: 4,
    outputs: 1,
    warmupGenerations: 20,
  });
  // Stale seed value lingering on the creature.
  addTag(creature, CURRENT_GENERATION_TAG, "1");

  applySeedWarmupTagsAtSave(creature, 20, 8);

  assertEquals(readWarmupGenerationsFromCreature(creature), 20);
  // Never a stale seed value — carries the accumulated counter.
  assertEquals(readCurrentGenerationFromCreature(creature), 8);
});

Deno.test("applySeedWarmupTagsAtSave: keeps #2831 monotonic-max guard", () => {
  const creature = creatureForProblem({
    inputs: 4,
    outputs: 1,
    warmupGenerations: 30,
  });
  addTag(creature, CURRENT_GENERATION_TAG, "15");

  // A lower Neat-level counter must never lower an existing higher generation.
  applySeedWarmupTagsAtSave(creature, 30, 9);

  assertEquals(readCurrentGenerationFromCreature(creature), 15);
});

Deno.test("applySeedWarmupTagsAtSave: once warm strips both tags", () => {
  const creature = creatureForProblem({
    inputs: 4,
    outputs: 1,
    warmupGenerations: 10,
  });
  // Stale warm-up tags present from earlier warming.
  addTag(creature, WARMUP_GENERATIONS_TAG, "10");
  addTag(creature, CURRENT_GENERATION_TAG, "10");

  // counter (11) > warmupGenerations (10) => warm.
  applySeedWarmupTagsAtSave(creature, 10, 11);

  assertEquals(getTag(creature, WARMUP_GENERATIONS_TAG), null);
  assertEquals(getTag(creature, CURRENT_GENERATION_TAG), null);
});

Deno.test("applySeedWarmupTagsAtSave: not configured strips stale tags", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  addTag(creature, WARMUP_GENERATIONS_TAG, "5");
  addTag(creature, CURRENT_GENERATION_TAG, "3");

  // warmupGenerations 0 => warm-up never configured.
  applySeedWarmupTagsAtSave(creature, 0, 0);

  assertEquals(getTag(creature, WARMUP_GENERATIONS_TAG), null);
  assertEquals(getTag(creature, CURRENT_GENERATION_TAG), null);
});

Deno.test("applySeedWarmupTagsAtSave: not configured adds no tags", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

  applySeedWarmupTagsAtSave(creature, 0, 0);

  assertEquals(getTag(creature, WARMUP_GENERATIONS_TAG), null);
  assertEquals(getTag(creature, CURRENT_GENERATION_TAG), null);
});

Deno.test("applySeedWarmupTagsAtSave: stamps the exported JSON object", () => {
  const creature = creatureForProblem({
    inputs: 4,
    outputs: 1,
    warmupGenerations: 25,
  });
  const json: CreatureExport = creature.exportJSON();

  applySeedWarmupTagsAtSave(json, 25, 13);

  const warmupTag = json.tags?.find((t) => t.name === WARMUP_GENERATIONS_TAG);
  const generationTag = json.tags?.find((t) =>
    t.name === CURRENT_GENERATION_TAG
  );
  assertEquals(warmupTag?.value, "25");
  assertEquals(generationTag?.value, "13");
});

Deno.test("applySeedWarmupTagsAtSave: strips stale tags from exported JSON once warm", () => {
  const creature = creatureForProblem({
    inputs: 4,
    outputs: 1,
    warmupGenerations: 12,
  });
  // Stale seed value on the live creature that would otherwise land on disk.
  addTag(creature, CURRENT_GENERATION_TAG, "1");
  const json: CreatureExport = creature.exportJSON();

  // counter (13) > warmupGenerations (12) => warm.
  applySeedWarmupTagsAtSave(json, 12, 13);

  assertEquals(
    json.tags?.find((t) => t.name === WARMUP_GENERATIONS_TAG),
    undefined,
  );
  assertEquals(
    json.tags?.find((t) => t.name === CURRENT_GENERATION_TAG),
    undefined,
  );
});
