import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { allocateBreedingQuotas } from "../../src/NEAT/BreedingQuotas.ts";
import { Genus } from "../../src/NEAT/Genus.ts";

Deno.test("breeding quotas: a cold start divides slots evenly and deterministically", () => {
  const genus = new Genus();
  for (const hiddenCount of [1, 11, 21]) {
    const creature = new Creature(1, 1, {
      layers: [{ count: hiddenCount }],
    });
    creature.score = 0;
    genus.addCreature(creature);
  }
  genus.updateSpeciesStatistics();

  const keys = [...genus.speciesMap.keys()].sort();
  assertEquals(keys.length, 3);
  const quotas = allocateBreedingQuotas(genus, 11, 1);
  assertEquals(keys.map((key) => quotas.get(key)), [4, 4, 3]);
  assertEquals(
    allocateBreedingQuotas(genus, 11, 1),
    quotas,
    "a cold start must assign the same species the remainder slots",
  );
});
