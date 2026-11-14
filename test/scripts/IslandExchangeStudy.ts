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
import {
  buildInitialIslands,
  buildSplits,
  comparisonVerdict,
  creatureSize,
  DEFAULT_ISLAND_SETTINGS,
  exchange,
  type IslandStudySettings,
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

    // Holdout isolation. Rather than comparing two runs, isolation is shown
    // by observing WHEN the holdout is first read: only after the last clock
    // tick, i.e. after every training, exchange and calibration decision has
    // been made. (Same-seed runs do reproduce exactly; see the reproduction
    // test below.)
    let ticks = 0;
    const tickClock = () => ++ticks;
    let ticksAtFirstHoldoutRead = -1;
    const spied = {
      ...splits,
      holdout: splits.holdout.map((r) => ({
        input: r.input,
        get target() {
          if (ticksAtFirstHoldoutRead < 0) ticksAtFirstHoldoutRead = ticks;
          return r.target + 10;
        },
      })),
    };
    const observed = runArmSeed("ring", SMALL, spied, initial, tickClock);
    assert(ticksAtFirstHoldoutRead > 0, "the holdout is read for the report");
    assertEquals(ticksAtFirstHoldoutRead, ticks);
    assert(observed.holdoutMse > 10, "the report reflects the holdout targets");
    assert(observed.calibrationMse < 10, "calibration never saw the holdout");
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
