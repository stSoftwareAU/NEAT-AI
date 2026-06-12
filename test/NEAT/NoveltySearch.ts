import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature, CreatureUtil } from "../../mod.ts";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { DEFAULT_NOVELTY_CONFIG } from "@config/NoveltyConfig.ts";
import {
  behaviourDistance,
  blendScores,
  buildNoveltyBlendedScores,
  extractBehaviour,
  meanNearestNeighbourDistance,
  normalise,
  NoveltyArchive,
  NoveltySearch,
} from "@neat/NoveltySearch.ts";

/** Build a minimal valid creature with a unique UUID and optional tags. */
function makeCreature(
  idx: number,
  score: number,
  behaviour?: string,
): Creature {
  const internal: CreatureInternal = {
    input: 1,
    output: 1,
    neurons: [{
      index: 1,
      type: "output",
      squash: "IDENTITY",
      bias: idx * 0.001,
    }],
    synapses: [{ from: 0, to: 1, weight: 1 + idx * 0.001 }],
  };
  const creature = Creature.fromJSON(internal);
  CreatureUtil.makeUUID(creature);
  creature.score = score;
  if (behaviour !== undefined) addTag(creature, "behaviour", behaviour);
  return creature;
}

Deno.test("behaviourDistance - Euclidean over shared prefix", () => {
  assertEquals(behaviourDistance([0, 0], [3, 4]), 5);
  assertEquals(behaviourDistance([1, 1], [1, 1]), 0);
  // Differing lengths compare the shared prefix only.
  assertEquals(behaviourDistance([0, 0, 99], [3, 4]), 5);
  assertEquals(behaviourDistance([], [1, 2]), 0);
});

Deno.test("meanNearestNeighbourDistance - averages the k closest", () => {
  const target = [0];
  const others = [[1], [2], [10]];
  // k=2 → mean of distances 1 and 2 = 1.5
  assertAlmostEquals(meanNearestNeighbourDistance(target, others, 2), 1.5);
  // k larger than available is clamped → mean of 1,2,10 = 13/3
  assertAlmostEquals(
    meanNearestNeighbourDistance(target, others, 99),
    13 / 3,
  );
  // No neighbours → 0
  assertEquals(meanNearestNeighbourDistance(target, [], 3), 0);
});

Deno.test("NoveltyArchive - bounded FIFO eviction", () => {
  const archive = new NoveltyArchive(3);
  archive.add([1]);
  archive.add([2]);
  archive.add([3]);
  assertEquals(archive.size, 3);
  archive.add([4]); // evicts [1]
  assertEquals(archive.size, 3);
  assertEquals(archive.entries[0], [2]);
  assertEquals(archive.entries[2], [4]);
});

Deno.test("NoveltyArchive - stores defensive copies and ignores empty", () => {
  const archive = new NoveltyArchive(5);
  const original = [1, 2];
  archive.add(original);
  original[0] = 99;
  assertEquals(archive.entries[0], [1, 2]); // unaffected by mutation
  archive.add([]); // ignored
  assertEquals(archive.size, 1);
  archive.clear();
  assertEquals(archive.size, 0);
});

Deno.test("NoveltyArchive - limit floors at 1", () => {
  const archive = new NoveltyArchive(0);
  archive.add([1]);
  archive.add([2]);
  assertEquals(archive.size, 1);
  assertEquals(archive.entries[0], [2]);
});

Deno.test("normalise - min-max into [0,1] with neutral flat", () => {
  assertEquals(normalise([0, 5, 10]), [0, 0.5, 1]);
  assertEquals(normalise([7, 7, 7]), [0.5, 0.5, 0.5]);
  assertEquals(normalise([]), []);
});

Deno.test("blendScores - weight 0 is pure fitness order, weight 1 is novelty", () => {
  const fitness = [10, 0]; // creature 0 fitter
  const novelty = [0, 10]; // creature 1 more novel
  const pureFitness = blendScores(fitness, novelty, 0);
  assert(pureFitness[0] > pureFitness[1]);
  const pureNovelty = blendScores(fitness, novelty, 1);
  assert(pureNovelty[1] > pureNovelty[0]);
  // Balanced blend ties.
  const balanced = blendScores(fitness, novelty, 0.5);
  assertAlmostEquals(balanced[0], balanced[1]);
});

Deno.test("blendScores - weight is clamped to [0,1]", () => {
  const fitness = [10, 0];
  const novelty = [0, 10];
  assertEquals(
    blendScores(fitness, novelty, 5),
    blendScores(fitness, novelty, 1),
  );
  assertEquals(
    blendScores(fitness, novelty, -5),
    blendScores(fitness, novelty, 0),
  );
});

Deno.test("NoveltySearch.computeNovelty - isolated behaviour scores highest", () => {
  const search = new NoveltySearch({
    ...DEFAULT_NOVELTY_CONFIG,
    enabled: true,
    neighbours: 2,
  });
  const behaviours = [[0], [0.1], [0.2], [10]];
  const novelty = search.computeNovelty(behaviours);
  // The outlier at 10 is far from everything → most novel.
  const maxIdx = novelty.indexOf(Math.max(...novelty));
  assertEquals(maxIdx, 3);
});

Deno.test("NoveltySearch.updateArchive - admits above threshold only", () => {
  const search = new NoveltySearch({
    ...DEFAULT_NOVELTY_CONFIG,
    enabled: true,
    addThreshold: 1,
  });
  search.updateArchive([[0], [1], [2]], [0.5, 2, 1.5]);
  assertEquals(search.archive.size, 2); // only novelty 2 and 1.5 admitted
});

Deno.test("extractBehaviour - parses comma-separated numeric tag", () => {
  const c = makeCreature(0, 1, "0.5, 1.0, -2");
  assertEquals(extractBehaviour(c, "behaviour"), [0.5, 1.0, -2]);
});

Deno.test("extractBehaviour - returns undefined for missing or invalid tags", () => {
  const noTag = makeCreature(1, 1);
  assertEquals(extractBehaviour(noTag, "behaviour"), undefined);
  const invalid = makeCreature(2, 1, "0.5, oops");
  assertEquals(extractBehaviour(invalid, "behaviour"), undefined);
});

Deno.test("buildNoveltyBlendedScores - returns undefined when too few descriptors", () => {
  const search = new NoveltySearch({
    ...DEFAULT_NOVELTY_CONFIG,
    enabled: true,
  });
  const pop = [makeCreature(0, 1, "0"), makeCreature(1, 2)]; // only one described
  const result = buildNoveltyBlendedScores(pop, (c) => c.score!, search);
  assertEquals(result, undefined);
});

Deno.test("buildNoveltyBlendedScores - blends, maps every creature, and archives", () => {
  const search = new NoveltySearch({
    ...DEFAULT_NOVELTY_CONFIG,
    enabled: true,
    weight: 1, // pure novelty so the outlier wins regardless of fitness
    neighbours: 2,
  });
  const pop = [
    makeCreature(0, 5, "0"),
    makeCreature(1, 5, "0.1"),
    makeCreature(2, 5, "0.2"),
    makeCreature(3, 1, "10"), // low fitness but behaviourally isolated
  ];
  const result = buildNoveltyBlendedScores(pop, (c) => c.score!, search);
  assert(result !== undefined);
  // Every creature present in the map.
  assertEquals(result!.size, 4);
  // Under pure-novelty blend the isolated creature ranks highest.
  const outlier = result!.get(pop[3].uuid!)!;
  for (let i = 0; i < 3; i++) {
    assert(outlier > result!.get(pop[i].uuid!)!);
  }
  // Described behaviours were archived.
  assertEquals(search.archive.size, 4);
});
