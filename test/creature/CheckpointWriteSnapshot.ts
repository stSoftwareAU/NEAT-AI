/**
 * Issue #4052 — a checkpoint write must snapshot the population membership at
 * entry. After a hard-deadline abandonment, the background `evolve()` can
 * reorder `neat.population` in place (sortCreaturesByScore) while the writer
 * awaits batches; iterating the live array then duplicates some members and
 * silently drops others.
 */

import { assertEquals } from "@std/assert";
import { addTag, getTag, type TagsInterface } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { writeCreatures } from "@creature/CheckpointWriter.ts";

const SIZE = 8;

function buildPopulation(size: number): Creature[] {
  const population: Creature[] = [];
  for (let i = 0; i < size; i++) {
    const creature = new Creature(3, 1, { layers: [{ count: 4 }] });
    creature.score = i;
    addTag(creature, "member", `m${i}`);
    population.push(creature);
  }
  return population;
}

/** Member tags of every file written to `dir`, sorted. */
async function writtenMembers(dir: string): Promise<string[]> {
  const entries = await Array.fromAsync(Deno.readDir(dir));
  const members: string[] = [];
  for (const entry of entries) {
    const parsed = JSON.parse(
      // deno-lint-ignore no-await-in-loop
      await Deno.readTextFile(`${dir}/${entry.name}`),
    ) as TagsInterface;
    members.push(getTag(parsed, "member") ?? "<missing>");
  }
  return members.sort();
}

async function checkReorder(
  prefix: string,
  reorder: (population: Creature[]) => void,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix });
  try {
    const population = buildPopulation(SIZE);
    const expected = population.map((_, i) => `m${i}`).sort();
    let calls = 0;
    const writeTextFile = (path: string, text: string): Promise<void> => {
      if (calls++ === 0) reorder(population);
      return Deno.writeTextFile(path, text);
    };

    await writeCreatures(
      { population, warmupGenerations: 0, currentGeneration: 0 },
      dir,
      { batchSize: 2, writeTextFile },
    );

    assertEquals(
      await writtenMembers(dir),
      expected,
      "every original member written exactly once despite in-place reorder",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("writeCreatures writes each member once when the population is reversed in place mid-write (#4052)", async () => {
  await checkReorder("neat_ckpt_snap_rev_", (p) => {
    p.reverse();
  });
});

Deno.test("writeCreatures writes each member once when the population is re-sorted by score mid-write (#4052)", async () => {
  await checkReorder("neat_ckpt_snap_sort_", (p) => {
    p.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  });
});
