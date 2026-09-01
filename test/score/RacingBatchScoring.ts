/**
 * Racing wired end to end through `Fitness.calculate` (Issue #3928).
 *
 * The scorer's early-exit hook is reached over its `--race-stdio` protocol, so
 * these tests stand a fake racing session in for the subprocess: it streams
 * per-chunk partial scores exactly as the binary does, honours the verdicts the
 * policy returns, and reports the frozen `recordCount` of every creature the
 * policy abandoned. What is asserted is the *outcome* — which creatures keep an
 * exact score, where the abandoned ones land in the sort, and that racing is
 * skipped rather than faked when the binary cannot do it.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Fitness } from "@architecture/Fitness.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerConfigForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";
import {
  __resetRacingSessionRunner,
  __setRacingSessionRunnerForTests,
  type RacingSessionRequest,
  type RacingSessionResult,
} from "../../src/score/RacingScorerSession.ts";
import { resolveRacingConfig } from "@config/RacingConfig.ts";
import { RACING_ABANDON_RANK_GAP } from "../../src/score/RacingRanking.ts";
import { initWasmForTests } from "../_initWasm.ts";

const CORPUS_RECORDS = 1000;
const CHUNK_RECORDS = 100;

/** Help text of a binary that carries the racing surface. */
const HELP_WITH_RACING =
  "Options:\n      --cost <NAME>\n      --race-stdio\n      --gpu <MODE>\n";
/** Help text of a binary predating NEAT-AI-scorer#308's stdio surface. */
const HELP_WITHOUT_RACING =
  "Options:\n      --cost <NAME>\n      --gpu <MODE>\n";

function buildDataSet(): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < 4; i++) {
    rows.push({
      input: new Float32Array([i, 4 - i]),
      output: new Float32Array([i > 2 ? 1 : -1]),
    });
  }
  return rows;
}

function buildForwardOnlyPopulation(count: number): Creature[] {
  const base: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
    forwardOnly: true,
  };
  const creatures: Creature[] = [];
  for (let i = 0; i < count; i++) {
    const forked = structuredClone(base);
    forked.neurons[0].bias = 0.1 * (i + 1);
    const creature = Creature.fromJSON(forked);
    CreatureUtil.makeUUID(creature);
    creatures.push(creature);
  }
  return creatures;
}

/** Never reached in these tests — a worker call would mean racing leaked. */
class MockWorkerHandler {
  public evaluateCallCount = 0;
  addIdleListener(_callback: () => void): void {}
  isBusy(): boolean {
    return false;
  }
  // deno-lint-ignore require-await
  async evaluate(
    _creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.evaluateCallCount++;
    return { evaluate: { error: 0.5 } };
  }
}

/** `--help` probe answer plus a full-corpus result map for the plain path. */
function stubRunner(help: string, errorByKey: Map<string, number>) {
  return (_command: string, args: string[]) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: help,
        stderr: "",
      });
    }
    const entries: Record<string, unknown> = {};
    for (const [key, error] of errorByKey) {
      entries[key] = {
        score: 1 - error,
        error,
        recordCount: CORPUS_RECORDS,
      };
    }
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: JSON.stringify(entries),
      stderr: "",
    });
  };
}

/**
 * Fake `--race-stdio` session: streams the corpus in chunks, applies the
 * caller's verdicts, and reports each creature's frozen record count — the
 * scorer's own contract, without a subprocess.
 */
function racingSession(
  errorByKey: Map<string, number>,
  observed: { requests: RacingSessionRequest[] },
) {
  return (request: RacingSessionRequest): Promise<RacingSessionResult> => {
    observed.requests.push(request);
    const keys = [...errorByKey.keys()].sort();
    const active = new Set(keys);
    const recordsScored = new Map(keys.map((k) => [k, 0]));
    let chunks = 0;
    for (
      let scored = CHUNK_RECORDS;
      scored <= CORPUS_RECORDS && active.size > 0;
      scored += CHUNK_RECORDS
    ) {
      for (const key of active) recordsScored.set(key, scored);
      chunks++;
      const partials = keys
        .filter((key) => active.has(key))
        .map((key) => ({
          index: keys.indexOf(key),
          key,
          partialError: errorByKey.get(key)!,
          recordsScored: recordsScored.get(key)!,
        }));
      const verdict = request.onChunk({
        racing: "chunk",
        chunk: chunks,
        partials,
      });
      if (verdict.verdict === "abortAll") break;
      if (verdict.verdict === "abort") {
        for (const index of verdict.creatures) active.delete(keys[index]);
      }
    }
    const entries: Record<string, unknown> = {};
    for (const key of keys) {
      const error = errorByKey.get(key)!;
      entries[key] = {
        score: 1 - error,
        error,
        recordCount: recordsScored.get(key)!,
      };
    }
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: JSON.stringify(entries),
      stderr: "",
      chunks,
    });
  };
}

function errorsFor(population: Creature[], errors: number[]): Map<
  string,
  number
> {
  const map = new Map<string, number>();
  population.forEach((creature, i) => map.set(creature.uuid!, errors[i]));
  return map;
}

function makeFitness(
  worker: MockWorkerHandler,
  dataDir: string,
  racing?: { enabled: boolean; minCorpusFraction?: number },
): Fitness {
  return new Fitness(
    [worker as unknown as WorkerHandler],
    0.0001,
    false,
    undefined,
    dataDir,
    "MSE",
    undefined,
    false,
    undefined,
    racing ? resolveRacingConfig(racing) : undefined,
  );
}

Deno.test("Racing: disabled by default — no --race-stdio and unchanged scores", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  __resetRacingSessionRunner();
  __setRustScorerConfigForTests({ enabled: true, batch: true });

  const population = buildForwardOnlyPopulation(3);
  const errors = errorsFor(population, [0.05, 0.6, 0.9]);
  let seenArgs: string[] = [];
  const runner = stubRunner(HELP_WITH_RACING, errors);
  __setRustScorerRunnerForTests((command, args) => {
    if (!(args.length === 1 && args[0] === "--help")) seenArgs = args;
    return runner(command, args);
  });
  let racingSessions = 0;
  __setRacingSessionRunnerForTests(() => {
    racingSessions++;
    throw new Error("racing must not run when it is disabled");
  });

  const dataDir = makeDataDir(buildDataSet(), 4);
  const worker = new MockWorkerHandler();
  try {
    const fitness = makeFitness(worker, dataDir);
    await fitness.calculate(population);
    assertEquals(racingSessions, 0);
    assert(
      !seenArgs.includes("--race-stdio"),
      `the disabled path must not ask the scorer to race, got: ${seenArgs}`,
    );
    assertEquals(fitness.lastRacingSummary, undefined);
    for (const creature of population) {
      assert(Number.isFinite(creature.score!), "every creature is full-scored");
      assert(!getTag(creature, "racing"), "no creature is tagged as abandoned");
    }
    // Scores are the plain full-corpus scores: strictly ordered by error.
    assert(population[0].score! > population[1].score!);
    assert(population[1].score! > population[2].score!);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
    __resetRacingSessionRunner();
  }
});

Deno.test("Racing: a binary without --race-stdio full-scores instead of pretending", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  __resetRacingSessionRunner();
  __setRustScorerConfigForTests({ enabled: true, batch: true });

  const population = buildForwardOnlyPopulation(3);
  const errors = errorsFor(population, [0.05, 0.6, 0.9]);
  __setRustScorerRunnerForTests(stubRunner(HELP_WITHOUT_RACING, errors));
  __setRacingSessionRunnerForTests(() => {
    throw new Error("a binary without --race-stdio must never be raced");
  });

  const dataDir = makeDataDir(buildDataSet(), 4);
  const worker = new MockWorkerHandler();
  try {
    const fitness = makeFitness(worker, dataDir, { enabled: true });
    await fitness.calculate(population);
    assertEquals(fitness.lastRacingSummary, undefined);
    for (const creature of population) {
      assert(!getTag(creature, "racing"), "no creature is tagged as abandoned");
      assert(Number.isFinite(creature.score!));
    }
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
    __resetRacingSessionRunner();
  }
});

Deno.test("Racing: the first generation full-scores because the corpus size is unknown", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  __resetRacingSessionRunner();
  __setRustScorerConfigForTests({ enabled: true, batch: true });

  const population = buildForwardOnlyPopulation(3);
  const errors = errorsFor(population, [0.05, 0.9, 0.95]);
  __setRustScorerRunnerForTests(stubRunner(HELP_WITH_RACING, errors));
  const observed = { requests: [] as RacingSessionRequest[] };
  __setRacingSessionRunnerForTests(racingSession(errors, observed));

  const dataDir = makeDataDir(buildDataSet(), 4);
  const worker = new MockWorkerHandler();
  try {
    const fitness = makeFitness(worker, dataDir, { enabled: true });
    await fitness.calculate(population);
    assert(
      observed.requests[0].args.includes("--race-stdio"),
      "the scorer is still driven through the racing protocol",
    );
    assertEquals(
      fitness.lastRacingSummary!.abandoned,
      0,
      "no corpus size yet, so the floor cannot be enforced and nobody is dropped",
    );
    for (const creature of population) {
      assert(!getTag(creature, "racing"), "no creature is tagged as abandoned");
    }
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
    __resetRacingSessionRunner();
  }
});

Deno.test("Racing: abandoned creatures rank below every fully-scored creature", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  __resetRacingSessionRunner();
  __setRustScorerConfigForTests({ enabled: true, batch: true });

  const dataDir = makeDataDir(buildDataSet(), 4);
  const worker = new MockWorkerHandler();
  try {
    const fitness = makeFitness(worker, dataDir, { enabled: true });

    // Generation 1 — full sweep, which is where the corpus size is learnt.
    const first = buildForwardOnlyPopulation(3);
    const firstErrors = errorsFor(first, [0.05, 0.06, 0.07]);
    __setRustScorerRunnerForTests(stubRunner(HELP_WITH_RACING, firstErrors));
    const observed = { requests: [] as RacingSessionRequest[] };
    __setRacingSessionRunnerForTests(racingSession(firstErrors, observed));
    await fitness.calculate(first);
    assertEquals(fitness.lastRacingSummary!.abandoned, 0);

    // Generation 2 — two hopeless offspring against one clear leader.
    const second = buildForwardOnlyPopulation(4);
    const secondErrors = errorsFor(second, [0.05, 0.08, 0.90, 0.95]);
    __setRustScorerRunnerForTests(stubRunner(HELP_WITH_RACING, secondErrors));
    __setRacingSessionRunnerForTests(racingSession(secondErrors, observed));
    await fitness.calculate(second);

    const summary = fitness.lastRacingSummary!;
    assertEquals(summary.abandoned, 2, "both hopeless creatures are abandoned");
    assertEquals(summary.raced, 4);
    assert(
      summary.meanAbandonFraction >= 0.2,
      `abandonment must respect the corpus floor, got ${summary.meanAbandonFraction}`,
    );
    assert(
      summary.recordsSavedFraction > 0,
      "abandoning creatures must remove record-scoring work",
    );

    const abandoned = second.filter((c) => Boolean(getTag(c, "racing")));
    const fullyScored = second.filter((c) => !getTag(c, "racing"));
    assertEquals(abandoned.length, 2);
    assertEquals(fullyScored.length, 2);

    const worstFullyScored = Math.min(...fullyScored.map((c) => c.score!));
    for (const creature of abandoned) {
      assert(
        creature.score! < worstFullyScored,
        `an abandoned creature (${creature.score}) must rank below every ` +
          `fully-scored creature (worst ${worstFullyScored})`,
      );
    }
    // Ordered among themselves by partial error at abandonment.
    const [betterAbandoned, worseAbandoned] = abandoned;
    assert(
      betterAbandoned.score! > worseAbandoned.score!,
      "abandoned creatures are ordered by their partial error",
    );
    assertAlmostEquals(
      betterAbandoned.score! - worseAbandoned.score!,
      RACING_ABANDON_RANK_GAP,
      RACING_ABANDON_RANK_GAP * 1e-6,
    );

    // The generation's fittest — what elitism and export would pick — is a
    // fully-scored creature, never an abandoned one.
    const fittest = [...second].sort((a, b) => b.score! - a.score!)[0];
    assert(!getTag(fittest, "racing"), "the fittest creature is fully scored");
    assertEquals(fittest.uuid, second[0].uuid);
    assertEquals(worker.evaluateCallCount, 0);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
    __resetRacingSessionRunner();
  }
});

Deno.test("Racing: an elite carrying a score is never re-scored or raced", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  __resetRacingSessionRunner();
  __setRustScorerConfigForTests({ enabled: true, batch: true });

  const dataDir = makeDataDir(buildDataSet(), 4);
  const worker = new MockWorkerHandler();
  try {
    const fitness = makeFitness(worker, dataDir, { enabled: true });

    // Generation 1 establishes the corpus size so generation 2 can race.
    const first = buildForwardOnlyPopulation(2);
    const firstErrors = errorsFor(first, [0.05, 0.06]);
    __setRustScorerRunnerForTests(stubRunner(HELP_WITH_RACING, firstErrors));
    const observed = { requests: [] as RacingSessionRequest[] };
    __setRacingSessionRunnerForTests(racingSession(firstErrors, observed));
    await fitness.calculate(first);

    // Generation 2: an elite carried forward with an exact score, plus two
    // fresh creatures — one of them hopeless.
    const elite = first[0];
    const eliteScore = elite.score!;
    const eliteUuid = elite.uuid!;
    const offspring = buildForwardOnlyPopulation(3).slice(1);
    const secondErrors = errorsFor(offspring, [0.07, 0.97]);
    __setRustScorerRunnerForTests(stubRunner(HELP_WITH_RACING, secondErrors));
    const scoredKeys: string[][] = [];
    __setRacingSessionRunnerForTests((request) => {
      scoredKeys.push(
        request.args.filter((a) => a.startsWith("-")),
      );
      return racingSession(secondErrors, observed)(request);
    });

    const generation = [elite, ...offspring];
    await fitness.calculate(generation);

    assertEquals(
      elite.score,
      eliteScore,
      "an elite's exact cached score is carried forward, never recomputed",
    );
    assertEquals(elite.uuid, eliteUuid);
    assert(!getTag(elite, "racing"), "an elite is never raced");
    // The elite never even reached the scorer: only the unscored creatures did.
    const raced = observed.requests.at(-1)!;
    assert(raced.args.includes("--race-stdio"));
    assertEquals(fitness.lastRacingSummary!.raced, 2);
    assertEquals(fitness.lastRacingSummary!.abandoned, 1);

    const abandoned = generation.filter((c) => Boolean(getTag(c, "racing")));
    assertEquals(abandoned.length, 1);
    assert(
      abandoned[0].score! < elite.score!,
      "an abandoned creature can never outrank an elite",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
    __resetRacingSessionRunner();
  }
});
