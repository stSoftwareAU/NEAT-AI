/**
 * `previousFittest` keeps its exact cached score (Issue #3928).
 *
 * Within one run of `evolveDir` neither the training data nor `previousFittest`
 * changes, so its score cannot meaningfully change — re-scoring it would buy
 * nothing and, once racing is on, would expose an exact score that elitism
 * depends on to a partial-corpus number.
 *
 * Two mechanisms make that true, and both are asserted here against real code:
 *
 * 1. the champion is carried forward as a `shallowClone` that keeps its score
 *    (`NeatEvolution` copies it onto the clone), and
 * 2. `Fitness.calculate` only evaluates creatures whose `score` is
 *    `undefined`, so anything carrying a score — the elites, and any
 *    already-scored creature — never reaches the scorer at all.
 */

import { assert, assertEquals } from "@std/assert";
import { Fitness } from "@architecture/Fitness.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerConfigForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";
import {
  __resetRacingSessionRunner,
  __setRacingSessionRunnerForTests,
} from "../../src/score/RacingScorerSession.ts";
import { resolveRacingConfig } from "@config/RacingConfig.ts";
import { initWasmForTests } from "../_initWasm.ts";
import {
  buildDataSet,
  buildForwardOnlyPopulation,
  HELP_WITH_RACING,
  MockWorkerHandler,
} from "./_racingFixtures.ts";

Deno.test("previousFittest: shallowClone carries the exact cached score", () => {
  const [creature] = buildForwardOnlyPopulation(1);
  const exact = 0.987_654_321_012_345;
  creature.score = exact;
  // `NeatEvolution` carries the champion forward as a shallow clone; the clone
  // must arrive already holding the score, to the last significant figure.
  // Nothing is assigned to the clone here — that would assert the test's own
  // arithmetic rather than the carry-forward.
  const champion = creature.shallowClone();
  assertEquals(
    champion.score,
    exact,
    "the champion clone keeps the exact score without a re-score",
  );
  assertEquals(champion.uuid, creature.uuid);
});

Deno.test("previousFittest: a scored creature never reaches the scorer", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  __resetRacingSessionRunner();
  __setRustScorerConfigForTests({ enabled: true, batch: true });

  const population = buildForwardOnlyPopulation(3);
  // The carried-forward champion/elite: already scored, with a value that
  // would be recomputed to something else if it were re-scored.
  const carried = population[0];
  const carriedScore = 0.123_456_789;
  carried.score = carriedScore;

  const scoredKeys = new Set(
    population.slice(1).map((c) => c.uuid!),
  );
  let batchCalls = 0;
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: HELP_WITH_RACING,
        stderr: "",
      });
    }
    batchCalls++;
    // Answering for exactly the unscored creatures: had the carried creature
    // been submitted, the reconciler would reject this map as missing a key.
    const entries: Record<string, unknown> = {};
    for (const key of scoredKeys) {
      entries[key] = { score: 0.5, error: 0.5, recordCount: 1000 };
    }
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: JSON.stringify(entries),
      stderr: "",
    });
  });

  // Racing session stand-in: one chunk, everybody continues, so the result is
  // the same full-corpus map the plain path returns.
  __setRacingSessionRunnerForTests((request) => {
    batchCalls++;
    const keys = [...scoredKeys].sort();
    request.onChunk({
      racing: "chunk",
      chunk: 1,
      partials: keys.map((key, index) => ({
        index,
        key,
        partialError: 0.5,
        recordsScored: 1000,
      })),
    });
    const entries: Record<string, unknown> = {};
    for (const key of keys) {
      entries[key] = { score: 0.5, error: 0.5, recordCount: 1000 };
    }
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: JSON.stringify(entries),
      stderr: "",
      chunks: 1,
    });
  });

  const dataDir = makeDataDir(buildDataSet(), 4);
  const worker = new MockWorkerHandler();
  try {
    const fitness = new Fitness(
      [worker as unknown as WorkerHandler],
      0.0001,
      false,
      undefined,
      dataDir,
      "MSE",
      undefined,
      false,
      undefined,
      // Racing on: the exemption must hold on the racing path too.
      resolveRacingConfig({ enabled: true }),
    );
    await fitness.calculate(population);

    assertEquals(batchCalls, 1);
    assertEquals(
      carried.score,
      carriedScore,
      "the carried-forward creature keeps its cached exact score",
    );
    assertEquals(worker.evaluateCallCount, 0);
    for (const creature of population.slice(1)) {
      assert(
        Number.isFinite(creature.score!),
        "the unscored creatures were scored",
      );
      assert(
        creature.score! !== carriedScore,
        "a freshly scored creature is not accidentally reading the cache",
      );
    }
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
    __resetRacingSessionRunner();
  }
});
