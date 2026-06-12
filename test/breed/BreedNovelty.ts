/**
 * Breed × novelty-selection wiring tests (Issue #2932).
 *
 * Verifies that the novelty engine, when supplied to a `Breed` and enabled
 * via config, influences mother-selection ranking — and that it is an inert
 * no-op when disabled or when no behaviour descriptors are present, so
 * existing behaviour is unchanged.
 */
import { assert, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
import { Breed } from "@breed/Breed.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Genus } from "@neat/Genus.ts";
import { NoveltySearch } from "@neat/NoveltySearch.ts";

function makeCreature(
  idx: number,
  score: number,
  behaviour?: string,
): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output",
        uuid: "output-0",
        squash: "IDENTITY",
        bias: idx * 0.01,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 + idx * 0.01 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.3 + idx * 0.01 },
    ],
  };
  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  creature.score = score;
  addTag(creature, "score", score.toString());
  if (behaviour !== undefined) addTag(creature, "behaviour", behaviour);
  return creature;
}

function createGenus(creatures: Creature[]): Genus {
  const genus = new Genus();
  for (const creature of creatures) genus.addCreature(creature);
  return genus;
}

Deno.test("Breed novelty - disabled engine leaves the archive untouched", () => {
  const creatures = [
    makeCreature(0, 0.9, "0"),
    makeCreature(1, 0.5, "1"),
    makeCreature(2, 0.1, "10"),
  ];
  const genus = createGenus(creatures);
  const search = new NoveltySearch(
    createNeatConfig({ novelty: { enabled: false } }).novelty,
  );
  const breed = new Breed(
    genus,
    createNeatConfig({ novelty: { enabled: false } }),
    search,
  );
  for (let i = 0; i < 20; i++) breed.breed();
  // Novelty disabled → engine never consulted → archive stays empty.
  assertEquals(search.archive.size, 0);
});

Deno.test("Breed novelty - enabled engine archives behaviours during breeding", () => {
  const config = createNeatConfig({
    novelty: { enabled: true, weight: 0.5, neighbours: 2 },
  });
  const creatures = [
    makeCreature(0, 0.9, "0"),
    makeCreature(1, 0.5, "1"),
    makeCreature(2, 0.1, "10"),
  ];
  const genus = createGenus(creatures);
  const search = new NoveltySearch(config.novelty);
  const breed = new Breed(genus, config, search);

  // The novelty branch runs while building the mother-selection ranking, so
  // a single breed() call consults the engine and archives the described
  // behaviours regardless of whether crossover yields offspring.
  breed.breed();
  assert(search.archive.size > 0, "Archive should accumulate behaviours");
});

Deno.test("Breed novelty - enabled but no behaviour tags is a safe no-op", () => {
  const config = createNeatConfig({ novelty: { enabled: true } });
  const creatures = [
    makeCreature(0, 0.9),
    makeCreature(1, 0.5),
    makeCreature(2, 0.1),
  ];
  const genus = createGenus(creatures);
  const search = new NoveltySearch(config.novelty);
  const breed = new Breed(genus, config, search);
  for (let i = 0; i < 10; i++) breed.breed();
  // No descriptors → nothing meaningful to compare → archive stays empty.
  assertEquals(search.archive.size, 0);
});
