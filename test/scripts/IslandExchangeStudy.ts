/**
 * The island-exchange study harness (Issue #4159).
 *
 * The harness is what a research verdict is read from, so its arithmetic is
 * tested rather than trusted: disjoint splits, an equal communication budget,
 * duplicate-free migration, immutable parents, holdout isolation and the
 * pre-declared decision rules.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Mutator } from "@neat/Mutator.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import {
  buildInitialIslands,
  buildSplits,
  comparisonVerdict,
  creatureSize,
  DEFAULT_ISLAND_SETTINGS,
  exchange,
  type IslandStudySettings,
  makeMutantFill,
  pairedBootstrap,
  paretoFront,
  pickDiverseMigrants,
  ringAllocation,
  runArmSeed,
  runStudy,
  transport,
  validateIslandSettings,
  withSeededUuids,
} from "../../scripts/lib/islandExchangeStudy.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

const SMALL: IslandStudySettings = {
  ...DEFAULT_ISLAND_SETTINGS,
  islands: 3,
  islandPopulation: 5,
  elitism: 1,
  generations: 4,
  cadence: 2,
  champions: 1,
  trainRecords: 40,
  calibrationRecords: 20,
  holdoutRecords: 40,
};

function counterClock(): () => number {
  let t = 0;
  return () => ++t;
}

/** A creature with a distinct uuid and the given score. */
function make(hidden: number, score: number | undefined, bias = 0): Creature {
  const c = new Creature(2, 1, { layers: [{ count: hidden }] });
  for (const n of c.neurons) if (n.type === "hidden") n.bias = bias;
  delete c.uuid;
  CreatureUtil.makeUUID(c);
  if (score !== undefined) c.score = score;
  return c;
}

Deno.test("island study — splits have the requested sizes, are disjoint and deterministic", () => {
  const a = buildSplits(SMALL);
  assertEquals(a.train.length, SMALL.trainRecords);
  assertEquals(a.calibration.length, SMALL.calibrationRecords);
  assertEquals(a.holdout.length, SMALL.holdoutRecords);
  const seen = new Set<unknown>();
  for (const r of [...a.train, ...a.calibration, ...a.holdout]) {
    assert(!seen.has(r), "a record is shared between splits");
    seen.add(r);
  }
  const b = buildSplits(SMALL);
  for (let i = 0; i < a.holdout.length; i++) {
    assertEquals(a.holdout[i].target, b.holdout[i].target);
  }
});

Deno.test("island study — ring allocation spends exactly the budget and is fair over a cycle", () => {
  for (let round = 0; round < 6; round++) {
    assertEquals(
      ringAllocation(6, 5, round).reduce((s, v) => s + v, 0),
      5,
    );
  }
  const totals = new Array<number>(6).fill(0);
  for (let round = 0; round < 6; round++) {
    ringAllocation(6, 5, round).forEach((v, i) => totals[i] += v);
  }
  assertEquals(totals, [5, 5, 5, 5, 5, 5]);
  assertEquals(ringAllocation(4, 0, 3), [0, 0, 0, 0]);
  assertThrows(() => ringAllocation(1, 1, 0));
  assertThrows(() => ringAllocation(4, -1, 0));
});

Deno.test("island study — settings validation names the offending field", () => {
  validateIslandSettings(DEFAULT_ISLAND_SETTINGS);
  assertThrows(
    () => validateIslandSettings({ ...SMALL, elitism: SMALL.islandPopulation }),
    Error,
    "elitism",
  );
  assertThrows(
    () => validateIslandSettings({ ...SMALL, islands: 1 }),
    Error,
    "islands",
  );
  assertThrows(
    () => validateIslandSettings({ ...SMALL, cadence: 0 }),
    Error,
    "cadence",
  );
});

Deno.test("island study — the Pareto front drops dominated and unscored creatures", () => {
  const small = make(1, -0.5);
  const big = make(3, -0.1);
  const dominated = make(3, -0.9);
  const unscored = make(1, undefined);
  assert(creatureSize(big) > creatureSize(small));
  const front = paretoFront([dominated, small, unscored, big]);
  assertEquals(front, [big, small]);
});

Deno.test("island study — migrants exclude what the destination already holds", () => {
  const top = make(2, -0.1);
  const other = make(3, -0.5, 0.3);
  const copy = transport(top).copy;
  assertEquals(copy.uuid, top.uuid);
  const picked = pickDiverseMigrants([top, other], [copy], 1);
  assertEquals(picked.length, 1);
  assertEquals(picked[0], other);
  assertEquals(pickDiverseMigrants([top], [copy], 2), []);
});

/**
 * A creature whose hidden neurons carry the named uuids, so its topology
 * distance to another is decided by which names they share.
 */
function shaped(hidden: string[], score: number, bias = 0): Creature {
  const c = new Creature(2, 1, { layers: [{ count: hidden.length }] });
  let k = 0;
  for (const n of c.neurons) {
    if (n.type === "hidden") {
      n.uuid = hidden[k++];
      n.bias = bias;
    }
  }
  delete c.uuid;
  CreatureUtil.makeUUID(c);
  c.score = score;
  return c;
}

Deno.test("island study — the diverse pick prefers distance over score", () => {
  const destination = [shaped(["a", "b"], -1, 0.1)];
  const near = shaped(["a", "b", "c"], -0.1, 0.2);
  const far = shaped(["x"], -0.5, 0.3);
  assertEquals(paretoFront([near, far]), [near, far]);
  assertEquals(pickDiverseMigrants([near, far], destination, 1), [far]);
  assertEquals(pickDiverseMigrants([far, near], destination, 2), [far, near]);
});

Deno.test("island study — the diverse pick takes the front before a dominated member", () => {
  const destination = [shaped(["a", "b"], -1, 0.1)];
  const front = shaped(["a", "b", "c"], -0.1, 0.2);
  const dominated = shaped(["p", "q", "r", "s"], -0.9, 0.3);
  assertEquals(paretoFront([front, dominated]), [front]);
  assertEquals(
    pickDiverseMigrants([dominated, front], destination, 1),
    [front],
  );
});

Deno.test("island study — beyond the front the diverse pick follows in score order", () => {
  const destination = [shaped(["a", "b"], -1, 0.1)];
  const front = shaped(["a", "b", "c"], -0.1, 0.2);
  const low = shaped(["p", "q", "r", "s"], -0.9, 0.3);
  const mid = shaped(["m", "n", "o", "t"], -0.7, 0.4);
  assertEquals(
    pickDiverseMigrants([low, front, mid], destination, 3),
    [front, mid, low],
  );
});

Deno.test("island study — a second pick is chosen for distance from the first", () => {
  const destination = [shaped(["d1", "d2"], -1, 0.1)];
  // Every candidate is equally far from the destination, so the first pick is
  // the best score; the second must then be the one far from that first pick,
  // not the next best score.
  const top = shaped(["y1", "y2", "y3"], -0.1, 0.2);
  const sibling = shaped(["y1", "y2"], -0.3, 0.3);
  const stranger = shaped(["x"], -0.5, 0.4);
  assertEquals(paretoFront([top, sibling, stranger]).length, 3);
  assertEquals(
    pickDiverseMigrants([top, sibling, stranger], destination, 2),
    [top, stranger],
  );
});

Deno.test("island study — transport copies faithfully and never touches the source", () => {
  const source = make(2, -0.25, 0.4);
  const before = JSON.stringify(source.exportJSON());
  const { copy, bytes } = transport(source);
  assertEquals(copy.uuid, source.uuid);
  assertEquals(copy.score, source.score);
  assert(bytes > 0);
  for (const n of copy.neurons) if (n.type === "hidden") n.bias += 5;
  assertEquals(JSON.stringify(source.exportJSON()), before);
});

/** Three score-sorted islands of distinct creatures. */
function fixtureIslands(): Creature[][] {
  return [0, 1, 2].map((island) =>
    [0, 1, 2, 3, 4].map((m) =>
      make(
        1 + ((island + m) % 3),
        -(island * 0.1 + m * 0.01 + 0.05),
        island + m / 10,
      )
    )
  );
}

Deno.test("island study — exchange arms move what they promise", () => {
  const clock = counterClock();
  const islands = fixtureIslands();
  const originals = islands.map((i) => [...i]);

  const none = exchange("none", islands, SMALL, 0, clock);
  assertEquals(none.transfers, 0);
  assertEquals(none.islands, islands);

  const champion = islands.flat().sort((a, b) => b.score! - a.score!)[0];
  const broadcast = exchange("broadcast", islands, SMALL, 0, clock);
  assertEquals(broadcast.transfers, SMALL.islands - 1);
  for (const island of broadcast.islands) {
    assert(island.some((c) => c.uuid === champion.uuid));
    assertEquals(island.length, SMALL.islandPopulation);
  }

  const ring = exchange("ring", islands, SMALL, 0, clock);
  const total = ringAllocation(3, SMALL.champions * (SMALL.islands - 1), 0)
    .reduce((s, v) => s + v, 0);
  assertEquals(ring.transfers, total);
  assert(ring.bytes > 0);
  const allocation = ringAllocation(3, 2, 0);
  for (let i = 0; i < 3; i++) {
    const d = (i + 1) % 3;
    if (allocation[i] === 0) continue;
    const sourceUuids = new Set(islands[i].map((c) => c.uuid));
    assert(ring.islands[d].some((c) => sourceUuids.has(c.uuid)));
  }
  for (const island of ring.islands) {
    assertEquals(island.length, SMALL.islandPopulation);
  }
  // Source members are untouched.
  islands.forEach((island, i) => {
    island.forEach((c, m) => assert(c === originals[i][m]));
  });
});

Deno.test("island study — arms spend the same records; holdout never influences a decision", async () => {
  await withRngTestLock(() => {
    const splits = buildSplits(SMALL);
    const initial = buildInitialIslands(SMALL);
    const run = (arm: "none" | "ring" | "broadcast", s = splits) =>
      runArmSeed(arm, SMALL, s, initial, counterClock());
    const none = run("none");
    const ring = run("ring");
    const broadcast = run("broadcast");
    assertEquals(none.recordsCharged, ring.recordsCharged);
    assertEquals(none.recordsCharged, broadcast.recordsCharged);
    assertEquals(
      none.trainRecordsCharged,
      SMALL.islands *
        (SMALL.islandPopulation +
          (SMALL.generations - 1) * (SMALL.islandPopulation - SMALL.elitism)) *
        SMALL.trainRecords,
    );
    assertEquals(none.transfers, 0);
    assertEquals(none.bytes, 0);
    assert(ring.transfers > 0 && ring.bytes > 0);
    assert(broadcast.transfers > 0 && broadcast.bytes > 0);

    // Holdout isolation, by outcome: change the holdout targets materially (not
    // by a uniform shift, which could not change a ranking) and everything a
    // decision touches must stay identical; only the reported holdout moves.
    const altered: typeof splits = {
      ...splits,
      holdout: splits.holdout.map((r, i) => ({
        input: r.input,
        target: -r.target + (i % 7) * 0.9 - 2,
      })),
    };
    for (const arm of ["ring", "broadcast"] as const) {
      const real = run(arm);
      const other = run(arm, altered);
      assertEquals(other.reportedUuid, real.reportedUuid);
      assertEquals(other.calibrationMse, real.calibrationMse);
      assertEquals(other.recordsCharged, real.recordsCharged);
      assertEquals(other.transfers, real.transfers);
      assertEquals(other.bytes, real.bytes);
      assertEquals(other.generations, real.generations);
      assertEquals(other.mutationFills, real.mutationFills);
      assertNotEquals(other.holdoutMse, real.holdoutMse);
    }
  });
});

Deno.test("island study — a mutation-only fill is always a new creature", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      const config = createNeatConfig({
        mutationRate: 1,
        rng: createSeededRng(7),
      });
      const mutator = new Mutator(config);
      for (const hidden of [1, 2, 3]) {
        const parent = make(hidden, -0.2, 0.1);
        const parentBefore = JSON.stringify(parent.exportJSON());
        const { fill, redraws } = makeMutantFill(parent, mutator);
        assertNotEquals(CreatureUtil.makeUUID(fill), parent.uuid);
        assertEquals(fill.score, undefined);
        assert(redraws >= 0);
        assertEquals(JSON.stringify(parent.exportJSON()), parentBefore);
      }
      // A mutator that never mutates cannot make a fill that differs, and the
      // refusal is loud rather than a clone handed back to be scored again.
      const idle = new Mutator({ ...config, mutationRate: 0 });
      assertThrows(
        () => makeMutantFill(make(2, -0.2), idle),
        Error,
        "unmutated clone",
      );
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

Deno.test("island study — a collapsed start is refilled with mutants and still charges the same records", async () => {
  await withRngTestLock(() => {
    const splits = buildSplits(SMALL);
    const first = buildInitialIslands(SMALL);
    // Every island starts as clones of one creature, so crossover refuses every
    // pair and each offspring slot is a mutation-only fill.
    const clones = first.map((island) => island.map(() => island[0]));
    const result = (arm: "none" | "ring" | "broadcast") =>
      runArmSeed(arm, SMALL, splits, clones, counterClock());
    const none = result("none");
    const ring = result("ring");
    assert(none.mutationFills > 0, "the clone islands force fills");
    assert(ring.mutationFills > 0);
    // Not a count the fill path computes for itself: every train evaluation is
    // checked against what its island had already scored, and the ones that
    // were a fill are counted apart. The clone start is its own positive
    // control: the first generation scores islandPopulation identical creatures
    // per island, so at least islandPopulation - 1 of them are re-scores (a
    // crossover child can add more, so this is a floor). A fill that came back
    // as a clone of a parent would show up in `rescoredFills`.
    const startClones = SMALL.islands * (SMALL.islandPopulation - 1);
    for (const arm of ["none", "ring", "broadcast"] as const) {
      const run = result(arm);
      assert(
        run.rescoredEvaluations >= startClones,
        `${arm}: the duplicated start is counted as re-scored`,
      );
      assertEquals(run.rescoredFills, 0, `${arm}: no fill is scored twice`);
      // Distinct starting creatures are never re-scored by any arm.
      assertEquals(
        runArmSeed(arm, SMALL, splits, first, counterClock()).rescoredFills,
        0,
      );
    }
    assertEquals(none.recordsCharged, ring.recordsCharged);
    assertEquals(
      none.trainRecordsCharged,
      SMALL.islands *
        (SMALL.islandPopulation +
          (SMALL.generations - 1) * (SMALL.islandPopulation - SMALL.elitism)) *
        SMALL.trainRecords,
    );
  });
});

Deno.test("island study — paired bootstrap brackets the mean and is reproducible", () => {
  assert(pairedBootstrap([-1, -2, -1.5, -1, -2], 500, 1).upper < 0);
  const symmetric = Array.from(
    { length: 20 },
    (_, i) => (i % 2 === 0 ? -1 : 1),
  );
  const interval = pairedBootstrap(symmetric, 500, 1);
  assert(interval.lower < 0 && interval.upper > 0);
  assertEquals(pairedBootstrap(symmetric, 500, 1), interval);
  assertThrows(() => pairedBootstrap([], 10, 1));
});

Deno.test("island study — verdict rules are applied as pre-declared", () => {
  const good = Array.from({ length: 10 }, () => -1);
  const base = { armCollapseRate: 0, controlCollapseRate: 0, bytesRatio: 1 };
  assertEquals(comparisonVerdict({ ...base, diffs: good }).verdict, "better");
  assertEquals(
    comparisonVerdict({ ...base, diffs: good.map((d) => -d) }).verdict,
    "worse",
  );
  const mixed = Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? -1 : 1));
  assertEquals(
    comparisonVerdict({ ...base, diffs: mixed }).verdict,
    "no-benefit",
  );
  const few = comparisonVerdict({ ...base, diffs: [-1, -1, -1, -1] });
  assertEquals(few.verdict, "insufficient-data");
  assertEquals(few.n, 4);
  assertEquals(
    comparisonVerdict({ ...base, diffs: good, bytesRatio: 2 }).verdict,
    "no-benefit",
  );
  assertEquals(
    comparisonVerdict({ ...base, diffs: good, armCollapseRate: 0.5 }).verdict,
    "no-benefit",
  );
  assertEquals(
    comparisonVerdict({
      ...base,
      diffs: good,
      bytesRatio: Number.NaN,
      ignoreTransport: true,
    }).verdict,
    "better",
  );
});

Deno.test("island study — a small study completes every planned run", async () => {
  await withRngTestLock(() => {
    const study = runStudy(SMALL, [4159, 4160], counterClock());
    assertEquals(study.coverage, { plannedRuns: 6, completedRuns: 6 });
    assertEquals(study.failures, []);
    assertEquals(study.comparisons.ringVsBroadcast.n, 2);
    assertEquals(study.comparisons.noneVsBroadcast.n, 2);
    assertEquals(
      study.comparisons.ringVsBroadcast.verdict,
      "insufficient-data",
    );
    assertEquals(study.summary.length, 3);
  });
});

Deno.test("island study — one arm and seed reproduce exactly", async () => {
  await withRngTestLock(() => {
    const splits = buildSplits(SMALL);
    for (const arm of ["none", "ring", "broadcast"] as const) {
      const a = runArmSeed(
        arm,
        SMALL,
        splits,
        buildInitialIslands(SMALL),
        counterClock(),
      );
      const b = runArmSeed(
        arm,
        SMALL,
        splits,
        buildInitialIslands(SMALL),
        counterClock(),
      );
      assertEquals(a.holdoutMse, b.holdoutMse);
      assertEquals(a.reportedUuid, b.reportedUuid);
      assertEquals(a.recordsCharged, b.recordsCharged);
    }
  });
});

Deno.test("island study — seeded uuids are v4-shaped and always restored", () => {
  const original = crypto.randomUUID;
  const seen = withSeededUuids(
    1,
    () => [crypto.randomUUID(), crypto.randomUUID()],
  );
  for (const u of seen) {
    assert(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        .test(u),
      u,
    );
  }
  assertNotEquals(seen[0], seen[1]);
  assertEquals(
    withSeededUuids(1, () => [crypto.randomUUID(), crypto.randomUUID()]),
    seen,
  );
  assert(crypto.randomUUID === original);
  assertNotEquals(crypto.randomUUID(), crypto.randomUUID());
  assertThrows(
    () =>
      withSeededUuids(2, () => {
        throw new Error("boom");
      }),
    Error,
    "boom",
  );
  assert(crypto.randomUUID === original);
  assertNotEquals(crypto.randomUUID(), crypto.randomUUID());
});
