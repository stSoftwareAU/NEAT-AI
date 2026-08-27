import { assert, assertEquals, assertRejects } from "@std/assert";
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";
import { tryBatchScoreWithRustScorer } from "../../src/score/BatchRustScorerBridge.ts";
import { ScorerStrictError } from "@errors/ScorerStrictError.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * GRQ #4418: a `rust_scorer` batch call that never returns wedged a whole
 * evolve unit — GRQ-7 for 10h 52m, GRQ-26 for 2h 42m past a bound the
 * hard-deadline watchdog had already breached. The batch bridge must honour
 * the run's abort signal itself rather than trusting the child process (or the
 * injected runner) to notice.
 */

function buildDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([0]) },
  ];
}

function buildConfig(
  overrides?: Partial<RequiredRustScorerConfig>,
): RequiredRustScorerConfig {
  return {
    enabled: true,
    binaryPath: "rust_scorer",
    timeoutMs: 0,
    env: {},
    batch: true,
    ...overrides,
  };
}

function makeCreatureWithUuid(uuid: string): Creature {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.uuid = uuid;
  return creature;
}

Deno.test("BatchRustScorer - a wedged scorer call fails loud when the run aborts", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  const controller = new AbortController();
  let sawSignal = false;
  __setRustScorerRunnerForTests((_command, args, options) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    // The signal must reach the runner so the real runner can kill the child.
    sawSignal = options.signal !== undefined;
    // A runner that ignores the signal is exactly the GRQ-26 wedge; the
    // bridge must not depend on its cooperation.
    return new Promise(() => {});
  });

  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const pending = tryBatchScoreWithRustScorer(
      [makeCreatureWithUuid("wedged-1")],
      dataDir,
      buildConfig(),
      undefined,
      controller.signal,
    );
    controller.abort();

    const error = await assertRejects(() => pending, ScorerStrictError);
    assertEquals(error.reason, "ABORTED");
    assert(
      error.message.includes("aborted"),
      `message must say the call was aborted, got: ${error.message}`,
    );
    assert(sawSignal, "the abort signal must be handed to the command runner");
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("BatchRustScorer - an already-aborted run never spawns the scorer", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  const controller = new AbortController();
  controller.abort();

  let scoreCalls = 0;
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    scoreCalls++;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: "{}",
      stderr: "",
    });
  });

  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const error = await assertRejects(
      () =>
        tryBatchScoreWithRustScorer(
          [makeCreatureWithUuid("never-spawned")],
          dataDir,
          buildConfig(),
          undefined,
          controller.signal,
        ),
      ScorerStrictError,
    );
    assertEquals(error.reason, "ABORTED");
    assertEquals(scoreCalls, 0, "no scorer process past the hard deadline");
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("BatchRustScorer - an un-aborted run is unaffected by the signal", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  const controller = new AbortController();
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: JSON.stringify({
        "healthy-1": { score: 0.9, error: 0.1, recordCount: 2 },
      }),
      stderr: "",
    });
  });

  const dataDir = makeDataDir(buildDataSet(), 8);
  const creature = makeCreatureWithUuid("healthy-1");
  try {
    const run = await tryBatchScoreWithRustScorer(
      [creature],
      dataDir,
      buildConfig(),
      undefined,
      controller.signal,
    );
    assertEquals(run.invocations, 1);
    assertEquals(run.results!.get(creature)!.error, 0.1);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
