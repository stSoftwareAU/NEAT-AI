import { assert, assertEquals, assertRejects } from "@std/assert";
import { isAbsolute } from "@std/path";
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";
import { tryBatchScoreWithRustScorer } from "../../src/score/BatchRustScorerBridge.ts";
import { BatchScorerError } from "../../src/score/BatchScorerReconciler.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Tests for the batch rust scorer bridge (Issue #2422).
 *
 * These cover the directory-mode invocation contract: one scorer process per
 * generation, results mapped back to in-memory creatures by filename stem,
 * with explicit errors on missing/extra keys or malformed output.
 */

function buildDataSet(): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8;
    const b = (8 - i) / 8;
    rows.push({
      input: new Float32Array([a, b]),
      output: new Float32Array([a > b ? 1 : -1]),
    });
  }
  return rows;
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
  // Ensure a deterministic stem for reconciliation — the bridge relies on
  // creature.uuid as the filename stem.
  creature.uuid = uuid;
  return creature;
}

function buildResultPayload(
  entries: Record<
    string,
    { score: number; error: number; recordCount: number }
  >,
): string {
  return JSON.stringify(entries);
}

Deno.test("BatchRustScorer - invokes scorer once for N creatures", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  let scoreCalls = 0;
  let seenArgs: string[] = [];
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
    seenArgs = args;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: buildResultPayload({
        "creature-1": { score: 0.9, error: 0.1, recordCount: 8 },
        "creature-2": { score: 0.8, error: 0.2, recordCount: 8 },
        "creature-3": { score: 0.7, error: 0.3, recordCount: 8 },
      }),
      stderr: "",
    });
  });

  const creatures = [
    makeCreatureWithUuid("creature-1"),
    makeCreatureWithUuid("creature-2"),
    makeCreatureWithUuid("creature-3"),
  ];
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const run = await tryBatchScoreWithRustScorer(
      creatures,
      dataDir,
      buildConfig(),
    );
    assertEquals(
      run.invocations,
      1,
      "exactly one scorer process per N creatures",
    );
    assertEquals(scoreCalls, 1, "scorer runner should be called once");
    assert(run.results !== undefined, "results map should be populated");
    assertEquals(run.results!.size, 3);
    assertEquals(run.results!.get(creatures[0])!.error, 0.1);
    assertEquals(run.results!.get(creatures[1])!.error, 0.2);
    assertEquals(run.results!.get(creatures[2])!.error, 0.3);
    // Directory and data-dir arguments must be absolute so child processes
    // with a different cwd can resolve them.
    assertEquals(seenArgs.length, 2);
    assert(isAbsolute(seenArgs[0]), "creatures dir must be absolute");
    assert(isAbsolute(seenArgs[1]), "data dir must be absolute");
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("BatchRustScorer - maps each entry back to its in-memory creature", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

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
      stdout: buildResultPayload({
        "alpha": { score: 0.5, error: 0.05, recordCount: 8 },
        "beta": { score: 0.25, error: 0.75, recordCount: 8 },
      }),
      stderr: "",
    });
  });

  const alpha = makeCreatureWithUuid("alpha");
  const beta = makeCreatureWithUuid("beta");
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const run = await tryBatchScoreWithRustScorer(
      [alpha, beta],
      dataDir,
      buildConfig(),
    );
    assert(run.results !== undefined);
    assertEquals(run.results!.get(alpha)!.error, 0.05);
    assertEquals(run.results!.get(beta)!.error, 0.75);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("BatchRustScorer - missing key surfaces BatchScorerError", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    // creature-b omitted — reconciliation must fail explicitly.
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: buildResultPayload({
        "creature-a": { score: 0.5, error: 0.5, recordCount: 8 },
      }),
      stderr: "",
    });
  });

  const a = makeCreatureWithUuid("creature-a");
  const b = makeCreatureWithUuid("creature-b");
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const err = await assertRejects(
      () => tryBatchScoreWithRustScorer([a, b], dataDir, buildConfig()),
      BatchScorerError,
    );
    assertEquals(err.reason, "MISSING_KEYS");
    assertEquals(err.missingKeys, ["creature-b"]);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("BatchRustScorer - extra key surfaces BatchScorerError", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

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
      stdout: buildResultPayload({
        "creature-a": { score: 0.5, error: 0.5, recordCount: 8 },
        "creature-b": { score: 0.5, error: 0.5, recordCount: 8 },
        "creature-ghost": { score: 0.5, error: 0.5, recordCount: 8 },
      }),
      stderr: "",
    });
  });

  const a = makeCreatureWithUuid("creature-a");
  const b = makeCreatureWithUuid("creature-b");
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const err = await assertRejects(
      () => tryBatchScoreWithRustScorer([a, b], dataDir, buildConfig()),
      BatchScorerError,
    );
    assertEquals(err.reason, "EXTRA_KEYS");
    assertEquals(err.extraKeys, ["creature-ghost"]);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("BatchRustScorer - disabled config returns undefined results without invoking scorer", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  let calls = 0;
  __setRustScorerRunnerForTests(() => {
    calls++;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: "",
      stderr: "",
    });
  });

  const creature = makeCreatureWithUuid("creature-1");
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const run = await tryBatchScoreWithRustScorer(
      [creature],
      dataDir,
      buildConfig({ enabled: false }),
    );
    assertEquals(run.results, undefined);
    assertEquals(run.invocations, 0);
    assertEquals(calls, 0);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("BatchRustScorer - batch flag off returns undefined results without invoking scorer", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  let calls = 0;
  __setRustScorerRunnerForTests(() => {
    calls++;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: "",
      stderr: "",
    });
  });

  const creature = makeCreatureWithUuid("creature-1");
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const run = await tryBatchScoreWithRustScorer(
      [creature],
      dataDir,
      buildConfig({ batch: false }),
    );
    assertEquals(run.results, undefined);
    assertEquals(run.invocations, 0);
    assertEquals(calls, 0);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("BatchRustScorer - scorer unavailable falls back to per-creature path (undefined results)", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  __setRustScorerRunnerForTests(() => {
    return Promise.reject(new Error("scorer binary missing"));
  });

  const creature = makeCreatureWithUuid("creature-1");
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const run = await tryBatchScoreWithRustScorer(
      [creature],
      dataDir,
      buildConfig(),
    );
    assertEquals(run.results, undefined);
    assertEquals(run.invocations, 0);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("BatchRustScorer - non-zero scorer exit raises BatchScorerError", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

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
      success: false,
      code: 2,
      stdout: "",
      stderr: "scorer failed",
    });
  });

  const creature = makeCreatureWithUuid("creature-1");
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const err = await assertRejects(
      () => tryBatchScoreWithRustScorer([creature], dataDir, buildConfig()),
      BatchScorerError,
    );
    assert(
      err.message.includes("scorer failed"),
      `expected message to include stderr; got: ${err.message}`,
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("BatchRustScorer - cleans up temp creatures directory after run", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  let creaturesDir: string | undefined;
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    creaturesDir = args[0];
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: buildResultPayload({
        "creature-1": { score: 0.5, error: 0.5, recordCount: 8 },
      }),
      stderr: "",
    });
  });

  const creature = makeCreatureWithUuid("creature-1");
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    await tryBatchScoreWithRustScorer([creature], dataDir, buildConfig());
    assert(creaturesDir !== undefined);
    assertEquals(
      await Deno.stat(creaturesDir!).then(() => true).catch(() => false),
      false,
      "batch temp directory should be cleaned up after scoring",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("BatchRustScorer - assigns UUID to creatures without one before batching", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const stem = CreatureUtil.makeUUID(creature);

  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    const payload: Record<
      string,
      { score: number; error: number; recordCount: number }
    > = {};
    payload[stem] = { score: 0.42, error: 0.58, recordCount: 8 };
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: JSON.stringify(payload),
      stderr: "",
    });
  });

  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const run = await tryBatchScoreWithRustScorer(
      [creature],
      dataDir,
      buildConfig(),
    );
    assert(run.results !== undefined);
    assertEquals(run.results!.get(creature)!.error, 0.58);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
