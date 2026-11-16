/**
 * The admission-persistence study harness (Issue #4163).
 *
 * The harness answers a research question, so its arithmetic is tested rather
 * than trusted: the product-limit estimate, the parent weights, the
 * persistence summary, the settings validation and the leakage policy (holdout
 * never guides a decision).
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  type AdmissionSettings,
  DEFAULT_ADMISSION_SETTINGS,
  type IndividualRecord,
  kaplanMeier,
  parentWeights,
  persistenceSummary,
  runArm,
  validateSettings,
} from "../../scripts/lib/admissionPersistenceStudy.ts";
import {
  buildStratifiedCorpus,
  type Split,
  type StudyRecord,
} from "../../scripts/lib/lineageTargetingStudy.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

const SMALL: AdmissionSettings = {
  ...DEFAULT_ADMISSION_SETTINGS,
  recordsPerSplit: 16,
  populationSize: 4,
  offspringPerGeneration: 4,
  generations: 24,
  horizons: [2, 8],
  diversityEvery: 8,
};

Deno.test("admission study - kaplanMeier without censoring", () => {
  const lifetimes = [1, 2, 2, 3].map((time) => ({ time, event: true }));
  assertEquals(kaplanMeier(lifetimes, [0, 1, 2, 3]), [1, 0.75, 0.25, 0]);
});

Deno.test("admission study - kaplanMeier with censoring", () => {
  const lifetimes = [
    { time: 1, event: true },
    { time: 2, event: false },
    { time: 3, event: true },
    { time: 3, event: false },
  ];
  assertEquals(kaplanMeier(lifetimes, [0, 1, 2, 3]), [1, 0.75, 0.75, 0.375]);
});

Deno.test("admission study - kaplanMeier of nothing is 1 everywhere", () => {
  assertEquals(kaplanMeier([], [0, 5, 100]), [1, 1, 1]);
});

Deno.test("admission study - uniform parent weights are all 1", () => {
  assertEquals(parentWeights("uniform", [0.3, 0.1, 0.2], 2), [1, 1, 1]);
});

Deno.test("admission study - biased weights give the best exactly the cap", () => {
  const weights = parentWeights("biased", [0.3, 0.1, 0.2], 2);
  assertEquals(weights, [1, 2, 2 ** 0.5]);
  assertEquals(Math.max(...weights) / Math.min(...weights), 2);
  assertEquals(parentWeights("biased", [5], 2), [2]);
});

Deno.test("admission study - tied errors share a weight", () => {
  const weights = parentWeights("biased", [0.1, 0.1, 0.3], 2);
  assertEquals(weights, [2 ** 0.75, 2 ** 0.75, 1]);
});

Deno.test("admission study - an oddsCap below 1 is refused by name", () => {
  assertThrows(
    () => parentWeights("biased", [1, 2], 0.5),
    Error,
    "oddsCap",
  );
  assertThrows(
    () => parentWeights("uniform", [1, 2], Infinity),
    Error,
    "oddsCap",
  );
});

Deno.test("admission study - validateSettings names the bad setting", () => {
  const bad = (change: Partial<AdmissionSettings>, name: string) =>
    assertThrows(
      () => validateSettings({ ...SMALL, ...change }),
      Error,
      name,
    );
  bad({ horizons: [8, 2] }, "horizons");
  bad({ horizons: [2, 2] }, "horizons");
  bad({ horizons: [0, 2] }, "horizons");
  bad({ horizons: [] }, "horizons");
  bad({ oddsCap: 0.9 }, "oddsCap");
  bad({ oddsCap: Number.NaN }, "oddsCap");
  bad({ populationSize: 0 }, "populationSize");
  bad({ generations: 1.5 }, "generations");
  validateSettings(SMALL);
});

function rec(
  fields: Partial<IndividualRecord> & { id: number; birth: number },
): IndividualRecord {
  return {
    parent: fields.id === 0 ? null : 0,
    founder: 0,
    depth: 1,
    admitted: true,
    admissionRank: null,
    removed: null,
    survival: {},
    descendants: {},
    ...fields,
  };
}

Deno.test("admission study - persistenceSummary on a hand-built run", () => {
  const records: IndividualRecord[] = [
    rec({ id: 0, birth: 0, depth: 0 }),
    rec({
      id: 1,
      birth: 1,
      admissionRank: 0,
      survival: { 2: true, 5: true },
      descendants: { 2: 3, 5: 2 },
    }),
    rec({
      id: 2,
      birth: 2,
      admissionRank: 3,
      removed: 4,
      survival: { 2: false, 5: false },
      descendants: { 2: 1, 5: 0 },
    }),
    rec({
      id: 3,
      birth: 3,
      founder: 1,
      admitted: false,
      removed: 3,
      survival: { 2: false, 5: false },
      descendants: { 2: 0, 5: 0 },
    }),
    rec({
      id: 4,
      birth: 7,
      admissionRank: 1,
      survival: { 2: true, 5: null },
      descendants: { 2: 1, 5: null },
    }),
    rec({
      id: 5,
      birth: 9,
      admissionRank: 2,
      survival: { 2: null, 5: null },
      descendants: { 2: null, 5: null },
    }),
  ];
  const summary = persistenceSummary(records, {
    generations: 10,
    populationSize: 4,
    horizons: [2, 5],
  });
  assertEquals(summary.offspring, 5);
  assertEquals(summary.admitted, 4);
  assertEquals(summary.admissionRate, 0.8);

  const [h2, h5] = summary.horizons;
  assertEquals(h2.eligible, 4);
  assertEquals(h2.censored, 1);
  assertEquals(h2.admittedEligible, 3);
  assertEquals(h2.survivalRate, 0.5);
  assertEquals(h2.survivalRateGivenAdmitted, 2 / 3);
  assertAlmostEquals(h2.kmSurvivalGivenAdmitted!, 2 / 3, 1e-12);
  assertEquals(h2.contributionRate, 0.75);
  assertEquals(h2.contributionRateGivenAdmitted, 1);
  assertEquals(h2.meanDescendantShare, 5 / 12);
  assertEquals(h2.byAdmissionQuartile, [
    { quartile: 0, eligible: 1, contributionRate: 1 },
    { quartile: 1, eligible: 1, contributionRate: 1 },
    { quartile: 2, eligible: 0, contributionRate: null },
    { quartile: 3, eligible: 1, contributionRate: 1 },
  ]);

  assertEquals(h5.eligible, 3);
  assertEquals(h5.censored, 2);
  assertEquals(h5.survivalRate, 1 / 3);
  assertEquals(h5.survivalRateGivenAdmitted, 0.5);
  assertEquals(h5.contributionRateGivenAdmitted, 0.5);
  assertEquals(h5.meanDescendantShare, 0.25);
  assertEquals(h5.byAdmissionQuartile[3], {
    quartile: 3,
    eligible: 1,
    contributionRate: 0,
  });
  assertEquals(h5.byFounder, [
    { founder: 0, offspring: 2, admitted: 2, contributors: 1 },
    { founder: 1, offspring: 1, admitted: 0, contributors: 0 },
  ]);
});

Deno.test("admission study - persistenceSummary has no NaN with no offspring", () => {
  const summary = persistenceSummary([rec({ id: 0, birth: 0, depth: 0 })], {
    generations: 10,
    populationSize: 4,
    horizons: [2],
  });
  assertEquals(summary.admissionRate, null);
  assertEquals(summary.horizons[0].survivalRate, null);
  assertEquals(summary.horizons[0].kmSurvivalGivenAdmitted, null);
  assertEquals(summary.horizons[0].meanDescendantShare, null);
});

const corpusFor = (seed: number) =>
  buildStratifiedCorpus({ seed, recordsPerSplit: SMALL.recordsPerSplit });

Deno.test("admission study - a run is deterministic", async () => {
  await withRngTestLock(() => {
    const corpus = corpusFor(SMALL.seed);
    const a = runArm("uniform", SMALL, corpus);
    const b = runArm("uniform", SMALL, corpus);
    assertEquals(a, b);
    assert(a.offspring > 0);
    assertEquals(a.recordsScored, a.evaluations * 2 * SMALL.recordsPerSplit);
    assertEquals(
      a.holdoutRecords,
      SMALL.populationSize * SMALL.recordsPerSplit,
    );
  });
});

Deno.test("admission study - the caller's generator is restored", async () => {
  await withRngTestLock(() => {
    const mine = createSeededRng(99);
    setRandomNumberGenerator(mine);
    runArm("biased", SMALL, corpusFor(SMALL.seed));
    assertStrictEquals(getRandomNumberGenerator(), mine);
  });
});

Deno.test("admission study - holdout never guides a decision", async () => {
  await withRngTestLock(() => {
    const corpus = corpusFor(SMALL.seed);
    const shifted: Record<Split, StudyRecord[]> = {
      ...corpus,
      holdout: corpus.holdout.map((r) => ({ ...r, target: r.target + 1 })),
    };
    for (const arm of ["uniform", "biased"] as const) {
      const a = runArm(arm, SMALL, corpus);
      const b = runArm(arm, SMALL, shifted);
      assertEquals(a.trace, b.trace);
      assertEquals(a.persistence, b.persistence);
      assertEquals(a.finalTrainMse, b.finalTrainMse);
      // Positive control: the reported holdout really did move.
      assertNotEquals(a.finalHoldoutMse, b.finalHoldoutMse);
      assertNotEquals(a.populationHoldoutMse, b.populationHoldoutMse);
    }
  });
});

Deno.test("admission study - persistence bookkeeping is consistent", async () => {
  await withRngTestLock(() => {
    const result = runArm("uniform", SMALL, corpusFor(SMALL.seed), {
      keepIndividuals: true,
    });
    const individuals = result.individuals!;
    // Parents are cloned before mutation, never modified.
    assertEquals(result.modifiedParents, 0);
    const seeds = individuals.filter((i) => i.birth === 0);
    assertEquals(seeds.length, SMALL.populationSize);
    assert(seeds.every((s) => s.parent === null && s.depth === 0));
    for (const person of individuals) {
      for (const h of SMALL.horizons) {
        const censored = person.birth + h > SMALL.generations;
        assertEquals(person.survival[h] === null, censored);
        assertEquals(person.descendants[h] === null, censored);
        if (!censored) {
          assert(
            person.descendants[h]! >= (person.survival[h] ? 1 : 0),
            `individual ${person.id} horizon ${h}`,
          );
          assert(person.descendants[h]! <= SMALL.populationSize);
        }
        if (!person.admitted && !censored) {
          assertEquals(person.survival[h], false);
          assertEquals(person.descendants[h], 0);
        }
      }
    }
    const offspring = individuals.filter((i) => i.birth >= 1);
    assertEquals(offspring.length, result.offspring);
    assertEquals(offspring.filter((i) => i.admitted).length, result.admitted);
    for (const [index, h] of SMALL.horizons.entries()) {
      assertEquals(
        result.persistence.horizons[index].censored,
        offspring.filter((i) => i.birth > SMALL.generations - h).length,
      );
    }
    // Every generation keeps between one and N founder clades alive.
    assert(
      result.trace.every((t) =>
        t.founderCladesAlive >= 1 &&
        t.founderCladesAlive <= SMALL.populationSize
      ),
    );
  });
});

Deno.test("admission study - the bias reaches selection", async () => {
  await withRngTestLock(() => {
    const corpus = corpusFor(SMALL.seed);
    const uniform = runArm("uniform", SMALL, corpus);
    const biased = runArm("biased", SMALL, corpus);
    assertNotEquals(uniform.trace, biased.trace);
  });
});
