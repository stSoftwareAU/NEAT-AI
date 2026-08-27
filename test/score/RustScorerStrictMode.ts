/**
 * Scorer failures are fatal, not silently reconciled (Issue #3815).
 *
 * The WASM fallback let an entirely dead native scoring path look green:
 * Issue #3810 had `rust_scorer` rejecting every creature carrying a `memetic`
 * block, visible only as a warning buried in hundreds of repeated log lines.
 * Issue #3864 made throwing the default and Issue #3871 deleted the fallback
 * outright, so an exec/parse failure from a scorer that is present always
 * throws a {@link ScorerStrictError} carrying the scorer's stderr **verbatim**.
 *
 * A scorer that was never available is a different case and is asserted here
 * too: it stays a graceful skip, because the TypeScript/WASM engine is still
 * the one that serves an ineligible or unserved request.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import { ScorerStrictError } from "@errors/ScorerStrictError.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerRunnerForTests,
  tryScoreWithRustScorer,
} from "../../src/score/RustScorerBridge.ts";
import { tryBatchScoreWithRustScorer } from "../../src/score/BatchRustScorerBridge.ts";
import { BatchScorerError } from "../../src/score/BatchScorerReconciler.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * A multi-line diagnostic standing in for the real scorer's output. Newlines
 * and indentation matter: the strict error must carry them unchanged, since
 * the whitespace-collapsed log line is what made #3810 hard to find.
 */
const SCORER_STDERR = [
  "Error: failed to deserialise creature 9f1c-4d2a",
  "  caused by: unknown field `memetic`, expected one of `neurons`, `synapses`",
  "  at src/creature.rs:214",
].join("\n");

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
    batch: false,
    ...overrides,
  };
}

/** Answers the `--help` probe, then hands the scoring call to `respond`. */
function runnerWith(
  respond: () => {
    success: boolean;
    code: number;
    stdout: string;
    stderr: string;
  },
): void {
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    return Promise.resolve(respond());
  });
}

function makeCreature(uuid?: string): Creature {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  if (uuid) creature.uuid = uuid;
  return creature;
}

Deno.test("RustScorerStrictMode: per-creature exit failure throws with verbatim stderr", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  runnerWith(() => ({
    success: false,
    code: 101,
    stdout: "",
    stderr: SCORER_STDERR,
  }));

  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const error = await assertRejects(
      () =>
        tryScoreWithRustScorer(
          makeCreature(),
          dataDir,
          buildConfig(),
        ),
      ScorerStrictError,
    );
    assertEquals(error.reason, "EXEC_FAILURE");
    assertEquals(error.exitCode, 101);
    assertEquals(
      error.stderr,
      SCORER_STDERR,
      "stderr is carried verbatim — never trimmed or whitespace-collapsed",
    );
    assert(
      error.message.includes(SCORER_STDERR),
      `the failure message must quote the scorer's stderr; got: ${error.message}`,
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerStrictMode: per-creature non-JSON stdout throws", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  runnerWith(() => ({
    success: true,
    code: 0,
    stdout: "not valid json at all",
    stderr: SCORER_STDERR,
  }));

  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const error = await assertRejects(
      () =>
        tryScoreWithRustScorer(
          makeCreature(),
          dataDir,
          buildConfig(),
        ),
      ScorerStrictError,
    );
    assertEquals(error.reason, "INVALID_OUTPUT");
    assertEquals(error.stderr, SCORER_STDERR);
    assert(
      error.message.includes("not valid json at all"),
      `message should quote the unparseable stdout; got: ${error.message}`,
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerStrictMode: per-creature non-finite error throws", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  runnerWith(() => ({
    success: true,
    code: 0,
    stdout: '{"error":"not-a-number"}',
    stderr: SCORER_STDERR,
  }));

  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const error = await assertRejects(
      () =>
        tryScoreWithRustScorer(
          makeCreature(),
          dataDir,
          buildConfig(),
        ),
      ScorerStrictError,
    );
    assertEquals(error.reason, "INVALID_OUTPUT");
    assertEquals(error.stderr, SCORER_STDERR);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerStrictMode: an unavailable binary stays a graceful skip", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  // The `--help` probe fails, so the binary is treated as absent. A binary
  // that was never there is a skip, not a degradation — the request simply
  // never reached the native engine.
  __setRustScorerRunnerForTests(() =>
    Promise.resolve({
      success: false,
      code: 127,
      stdout: "",
      stderr: "command not found: rust_scorer",
    })
  );

  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const result = await tryScoreWithRustScorer(
      makeCreature(),
      dataDir,
      buildConfig(),
    );
    assertEquals(result, undefined, "absent binary skips, never throws");
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerStrictMode: batch exit failure throws with verbatim stderr", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  runnerWith(() => ({
    success: false,
    code: 101,
    stdout: "",
    stderr: SCORER_STDERR,
  }));

  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const error = await assertRejects(
      () =>
        tryBatchScoreWithRustScorer(
          [makeCreature("creature-1")],
          dataDir,
          buildConfig({ batch: true }),
        ),
      ScorerStrictError,
    );
    assertEquals(error.reason, "EXEC_FAILURE");
    assertEquals(error.exitCode, 101);
    assertEquals(error.stderr, SCORER_STDERR);
    assert(
      error.message.includes(SCORER_STDERR),
      `the failure message must quote the scorer's stderr; got: ${error.message}`,
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerStrictMode: batch reconciliation failure throws with stderr", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  // Process succeeds but returns no results, so every expected stem is missing.
  runnerWith(() => ({
    success: true,
    code: 0,
    stdout: "{}",
    stderr: SCORER_STDERR,
  }));

  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const error = await assertRejects(
      () =>
        tryBatchScoreWithRustScorer(
          [makeCreature("creature-1")],
          dataDir,
          buildConfig({ batch: true }),
        ),
      ScorerStrictError,
    );
    assertEquals(error.reason, "INVALID_OUTPUT");
    assertEquals(error.stderr, SCORER_STDERR);
    assert(
      error.cause instanceof BatchScorerError,
      "the reconciler's typed error is preserved as the cause",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
