/**
 * The Stage 1 memetic-gain harness (Issue #3934).
 *
 * The harness is the evidence, so the properties tested here are the ones the
 * report's credibility rests on: the corpus is deterministic, the `top` arm is
 * the production rule rather than a restatement of it, the `random` arm reaches
 * ranks the production rule can never observe, and a real arm produces one event
 * per scheduled gradient step with ranks and scores that mean what they say.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  buildStudyCorpus,
  DEFAULT_STUDY_SETTINGS,
  isStudyTrainerAvailable,
  runMemeticArm,
  scoreExactly,
  SELECTION_POLICIES,
  selectUnderPolicy,
  type StudySettings,
} from "../../scripts/lib/memeticGainStudy.ts";
import { selectTrainingCandidates } from "@neat/TrainingCandidates.ts";
import { Creature } from "@creature";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../_rngTestLock.ts";
import { initWasmForTests } from "../_initWasm.ts";
import { __setRustTrainDirEnabledForTests } from "@architecture/training/RustTrainDirBridge.ts";

/** A settings block small enough to run inside a unit test's budget. */
const TINY: StudySettings = {
  ...DEFAULT_STUDY_SETTINGS,
  corpusRecords: 60,
  populationSize: 8,
  generations: 3,
  elitism: 2,
  trainPerGen: 2,
  trainingIterations: 1,
};

/**
 * Run `body` against whichever trainer this checkout actually has.
 *
 * `trainDir` prefers the Rust trainer and refuses to fall back when it is
 * enabled with nothing to run it — the state of a plain checkout, and the state
 * a bare `deno test` inherits because the flag defaults on. The harness is
 * trainer-agnostic, so the WASM loop is forced for the isolate rather than
 * letting an absent binary fail a test about selection. `./quality.sh --next`
 * has the Rust trainer and takes the untouched path.
 */
function withAvailableTrainer<T>(body: () => T): T {
  if (isStudyTrainerAvailable()) return body();
  __setRustTrainDirEnabledForTests(false);
  try {
    return body();
  } finally {
    __setRustTrainDirEnabledForTests(undefined);
  }
}

Deno.test("buildStudyCorpus - the same seed builds the same corpus", () => {
  const first = buildStudyCorpus(TINY);
  const second = buildStudyCorpus(TINY);
  assertEquals(first.length, TINY.corpusRecords);
  assertEquals([...first[0].input], [...second[0].input]);
  assertEquals([...first[17].output], [...second[17].output]);
  const other = buildStudyCorpus({ ...TINY, seed: TINY.seed + 1 });
  assertNotEquals([...first[0].input], [...other[0].input]);
});

Deno.test("scoreExactly - a closer creature scores higher", async () => {
  await initWasmForTests();
  const corpus = buildStudyCorpus(TINY);
  const near = Creature.fromJSON({
    neurons: [{ type: "output", uuid: "out", squash: "IDENTITY", bias: 0 }],
    synapses: [
      { fromUUID: "input-0", toUUID: "out", weight: 0.6 },
      { fromUUID: "input-1", toUUID: "out", weight: 0 },
    ],
    input: 2,
    output: 1,
  });
  const far = Creature.fromJSON({
    neurons: [{ type: "output", uuid: "out", squash: "IDENTITY", bias: 9 }],
    synapses: [
      { fromUUID: "input-0", toUUID: "out", weight: 9 },
      { fromUUID: "input-1", toUUID: "out", weight: 9 },
    ],
    input: 2,
    output: 1,
  });
  const nearScore = scoreExactly(near, corpus);
  const farScore = scoreExactly(far, corpus);
  assert(nearScore > farScore, `${nearScore} should beat ${farScore}`);
  assert(nearScore <= 0, "the score is -MSE, so it can never exceed zero");
});

/** A score-sorted population of stubs; the selectors read only `score`. */
function sortedStubs(scores: readonly number[]): Creature[] {
  return scores.map((score, i) =>
    ({ uuid: `c-${i}`, score }) as unknown as Creature
  );
}

Deno.test("selectUnderPolicy - the top arm is the production rule", () => {
  const population = sortedStubs([-0.1, -0.2, -0.3, -0.4, -0.5]);
  const picked = selectUnderPolicy(
    "top",
    population,
    3,
    createSeededRng(1),
  );
  assertEquals(
    picked.map((p) => p.creature),
    selectTrainingCandidates([...population], 3),
  );
  assertEquals(picked.map((p) => p.rank), [0, 1, 2]);
});

Deno.test("selectUnderPolicy - the random arm draws without replacement", () => {
  const population = sortedStubs([-0.1, -0.2, -0.3, -0.4, -0.5, -0.6]);
  const picked = selectUnderPolicy(
    "random",
    population,
    4,
    createSeededRng(7),
  );
  assertEquals(picked.length, 4);
  assertEquals(new Set(picked.map((p) => p.creature.uuid)).size, 4);
  // The rank is the position it *would* have been selected at.
  for (const entry of picked) {
    assertEquals(population[entry.rank], entry.creature);
  }
});

Deno.test("selectUnderPolicy - the random arm reaches ranks the top rule never sees", () => {
  const population = sortedStubs(
    Array.from({ length: 20 }, (_, i) => -0.1 * (i + 1)),
  );
  const rng = createSeededRng(3934);
  const seen = new Set<number>();
  for (let draw = 0; draw < 40; draw++) {
    for (const entry of selectUnderPolicy("random", population, 2, rng)) {
      seen.add(entry.rank);
    }
  }
  const beyondTop = [...seen].filter((rank) => rank >= 2);
  assert(
    beyondTop.length > 5,
    `the baseline must observe gains past rank 1; saw ${[...seen].join(",")}`,
  );
});

Deno.test("selectUnderPolicy - a non-finite score is never a training target", () => {
  const population = sortedStubs([-0.1, Number.NEGATIVE_INFINITY, -0.3]);
  for (const policy of SELECTION_POLICIES) {
    const picked = selectUnderPolicy(
      policy,
      population,
      3,
      createSeededRng(2),
    );
    assertEquals(picked.length, 2, `${policy} must skip the non-finite score`);
    for (const entry of picked) {
      assert(Number.isFinite(entry.creature.score));
    }
  }
});

Deno.test("selectUnderPolicy - asking for more than exists returns what exists", () => {
  const population = sortedStubs([-0.1, -0.2]);
  assertEquals(
    selectUnderPolicy("random", population, 9, createSeededRng(3)).length,
    2,
  );
});

Deno.test("runMemeticArm - a real arm logs one event per scheduled step", async () => {
  await initWasmForTests();
  await withRngTestLock(() => {
    const arm = withAvailableTrainer(() => runMemeticArm("top", TINY));
    assertEquals(arm.policy, "top");
    assertEquals(arm.seed, TINY.seed);
    assertEquals(
      arm.events.length + arm.skippedAlreadyTrained,
      TINY.generations * TINY.trainPerGen,
      "every offered slot is either a gradient step or a counted refusal",
    );
    assertEquals(arm.bestScorePerGeneration.length, TINY.generations);
    assert(Number.isFinite(arm.finalScore));

    for (const event of arm.events) {
      assert(event.generation >= 1 && event.generation <= TINY.generations);
      assert(event.rank >= 0 && event.rank < event.rankedPopulation);
      assert(Number.isFinite(event.scoreBefore));
      assert(event.wallClockMs >= 0);
      if (event.scoreAfter === undefined) {
        assertEquals(event.gain, undefined);
        continue;
      }
      // Gain is the derived column, and it must agree with the two scores.
      assertEquals(event.gain, event.scoreAfter - event.scoreBefore);
      // A step is only kept when it improved on the creature it trained.
      if (event.kept) assert(event.scoreAfter > event.scoreBefore);
    }
    // The top rule only ever trains the head of the population.
    assert(arm.events.every((event) => event.rank < TINY.trainPerGen));
  });
});

Deno.test("runMemeticArm - the random arm trains past the top rule's reach", async () => {
  await initWasmForTests();
  await withRngTestLock(() => {
    const arm = withAvailableTrainer(() =>
      runMemeticArm("random", { ...TINY, generations: 6 })
    );
    assertEquals(
      arm.events.length + arm.skippedAlreadyTrained,
      6 * TINY.trainPerGen,
    );
    assert(
      arm.events.some((event) => event.rank >= TINY.trainPerGen),
      "the baseline exists to observe ranks the top rule cannot",
    );
  });
});

Deno.test("runMemeticArm - no creature is trained twice in a run (#3553)", async () => {
  await initWasmForTests();
  await withRngTestLock(() => {
    // Long enough for the top rule to keep meeting the elites it already
    // trained: with elitism 2 the head of the population survives generations.
    const arm = withAvailableTrainer(() =>
      runMemeticArm("top", { ...TINY, generations: 8 })
    );
    const trained = new Set(arm.events.map((event) => event.creatureUuid));
    assertEquals(
      trained.size,
      arm.events.length,
      "production dispatches nothing for a creature already trained this run",
    );
    assert(
      arm.skippedAlreadyTrained > 0,
      "the top rule keeps choosing creatures it has already trained, and the " +
        "refused slots are what makes that visible",
    );
    assertEquals(
      arm.events.length + arm.skippedAlreadyTrained,
      8 * TINY.trainPerGen,
    );
  });
});

Deno.test("runMemeticArm - the caller's random generator is restored", async () => {
  await initWasmForTests();
  await withRngTestLock(() => {
    const mine = createSeededRng(99);
    setRandomNumberGenerator(mine);
    try {
      withAvailableTrainer(() => runMemeticArm("top", TINY));
      assertEquals(getRandomNumberGenerator(), mine);
    } finally {
      setRandomNumberGenerator(createSeededRng(1));
    }
  });
});
