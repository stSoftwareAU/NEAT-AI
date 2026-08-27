/**
 * A native-scoring fallback is a run-level verdict, not just telemetry
 * (Issue #3866).
 *
 * Since Issue #3234 a batch fallback has been counted and published, but the
 * flag is reset every generation and the **per-creature** `rust_scorer` path
 * set nothing at all — so a run in which every creature quietly scored on WASM
 * finished green. Issue #3810 is what that looks like in production.
 *
 * Two regressions matter and they fail in opposite directions, so both are
 * asserted here:
 *
 * - **False green** — the run aggregate misses a fallback and a fully degraded
 *   run reports success.
 * - **False red** — a *graceful skip* (no binary, or a binary too old to honour
 *   the configured cost) is counted as a fallback and fails the run for every
 *   contributor without `rust_scorer` installed.
 *
 * Every case passes `strict` explicitly: under the default
 * `NEAT_AI_RUST_SCORER_STRICT=1` a degradation throws (Issue #3864) and never
 * reaches the verdict; these cases are the explicit `=0` opt-out, which must
 * still complete the run.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Costs } from "@costs";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerRunnerForTests,
  tryScoreWithRustScorer,
} from "../../src/score/RustScorerBridge.ts";
import { consumeNativeScoringFallback } from "../../src/score/NativeScoringFallbackLedger.ts";
import {
  accumulateScorerUtilisation,
  createScorerUtilisationAccumulator,
  finaliseScorerUtilisationTotals,
} from "@creature/ScorerUtilisationTotals.ts";
import { initWasmForTests } from "../_initWasm.ts";

const SCORER_STDERR = "Error: failed to deserialise creature 9f1c-4d2a";

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
    strict: false,
    ...overrides,
  };
}

/**
 * Answer the `--help` probe with `helpText`, then hand every scoring call to
 * `respond`. A probe that fails makes the binary look absent.
 */
function runnerWith(
  respond: () => {
    success: boolean;
    code: number;
    stdout: string;
    stderr: string;
  },
  helpText = "usage: rust_scorer [--cost <NAME>] <creature> <data_dir>",
): void {
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: helpText,
        stderr: "",
      });
    }
    return Promise.resolve(respond());
  });
}

function makeCreature(): Creature {
  return new Creature(2, 1, { layers: [{ count: 2 }] });
}

Deno.test("NativeScoringFallbackVerdict: a live scorer that fails records a fallback", async () => {
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
    const result = await tryScoreWithRustScorer(
      makeCreature(),
      dataDir,
      buildConfig({ strict: false }),
    );
    assertEquals(result, undefined, "strict off still degrades to WASM");
    assert(
      consumeNativeScoringFallback(),
      "an available scorer that failed must be recorded as a fallback",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("NativeScoringFallbackVerdict: unparseable scorer output records a fallback", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  runnerWith(() => ({
    success: true,
    code: 0,
    stdout: "not json at all",
    stderr: "",
  }));

  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const result = await tryScoreWithRustScorer(
      makeCreature(),
      dataDir,
      buildConfig({ strict: false }),
    );
    assertEquals(result, undefined);
    assert(
      consumeNativeScoringFallback(),
      "garbage from a live scorer is a degradation, not a skip",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("NativeScoringFallbackVerdict: an unresolvable binary is a graceful skip", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  // The `--help` probe fails, so the binary is treated as absent. Contributors
  // without `rust_scorer` must keep a clean `deno test` — counting this as a
  // fallback is the false-red regression.
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
      buildConfig({ binaryPath: "/nonexistent/rust_scorer", strict: false }),
    );
    assertEquals(result, undefined, "absent binary skips");
    assertEquals(
      consumeNativeScoringFallback(),
      false,
      "an uninstalled scorer never ran, so nothing degraded",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("NativeScoringFallbackVerdict: a too-old binary is a graceful skip", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  // Help text without `--cost`: the binary cannot honour the configured cost,
  // so the caller skips it rather than accepting a number computed under
  // different rules. That is availability, not degradation.
  runnerWith(
    () => ({ success: true, code: 0, stdout: '{"error":0.25}', stderr: "" }),
    "usage: rust_scorer <creature> <data_dir>",
  );

  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const result = await tryScoreWithRustScorer(
      makeCreature(),
      dataDir,
      buildConfig({ strict: false }),
      "MAE",
    );
    assertEquals(result, undefined, "too-old binary skips");
    assertEquals(
      consumeNativeScoringFallback(),
      false,
      "a binary that cannot serve the cost is a skip, not a fallback",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("NativeScoringFallbackVerdict: evaluateDir records the per-creature fallback", async () => {
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
    // The path the issue names: `evaluateDir` asks the native scorer, gets
    // nothing back, and silently scores on WASM. The error is still finite —
    // the run completes — but the degradation is now on the record.
    const { error } = await makeCreature().evaluateDir(
      dataDir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      buildConfig({ strict: false }),
    );
    assert(Number.isFinite(error), "WASM still produced a usable error");
    assert(
      consumeNativeScoringFallback(),
      "the per-creature path must set the verdict, not only the batch catch",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("NativeScoringFallbackVerdict: per-creature fallbacks survive the per-generation reset", () => {
  // False green: each generation recovered on WASM, so every per-generation
  // flag was cleared before the next one read it. The run-level aggregate is
  // the only thing that can still see the degradation.
  const acc = createScorerUtilisationAccumulator();
  for (let generation = 0; generation < 2; generation++) {
    accumulateScorerUtilisation(acc, {
      batchScorerInvocations: 0,
      creaturesBatchScored: 0,
      creaturesPerCreatureScored: 4,
      // The batch path was never used, so the pre-#3866 flag stays false …
      batchFallbackOccurred: false,
      // … while the per-creature path degraded in every generation.
      nativeFallbackOccurred: true,
    });
  }

  const totals = finaliseScorerUtilisationTotals(acc);
  assertEquals(totals.generations, 2);
  assertEquals(
    totals.batchFallbackGenerations,
    0,
    "the batch flag alone reports clean — the regression this closes",
  );
  assertEquals(totals.nativeFallbackGenerations, 2);
  assert(
    totals.nativeScoringFallback,
    "a run that scored entirely on WASM cannot report success",
  );
});

Deno.test("NativeScoringFallbackVerdict: a batch fallback still counts as a native fallback", () => {
  // Callers that predate #3866 publish only `batchFallbackOccurred`; the
  // aggregate must not lose their degradation.
  const acc = createScorerUtilisationAccumulator();
  accumulateScorerUtilisation(acc, {
    batchScorerInvocations: 1,
    creaturesBatchScored: 0,
    creaturesPerCreatureScored: 4,
    batchFallbackOccurred: true,
  });

  const totals = finaliseScorerUtilisationTotals(acc);
  assertEquals(totals.batchFallbackGenerations, 1);
  assertEquals(totals.nativeFallbackGenerations, 1);
  assert(totals.nativeScoringFallback);
});

Deno.test("NativeScoringFallbackVerdict: a clean run reports no fallback verdict", () => {
  // False red: a run with no native scoring at all (no binary installed) must
  // finish with an unset verdict.
  const acc = createScorerUtilisationAccumulator();
  for (let generation = 0; generation < 3; generation++) {
    accumulateScorerUtilisation(acc, {
      batchScorerInvocations: 0,
      creaturesBatchScored: 0,
      creaturesPerCreatureScored: 4,
      batchFallbackOccurred: false,
      nativeFallbackOccurred: false,
    });
  }

  const totals = finaliseScorerUtilisationTotals(acc);
  assertEquals(totals.nativeFallbackGenerations, 0);
  assertEquals(
    totals.nativeScoringFallback,
    false,
    "no rust_scorer installed is a graceful skip, never a failed run",
  );
});
