/**
 * Native-scorer failure classification (Issue #3541).
 *
 * The WASM path is a fallback for backend failures, never for corrupt training
 * data: it reads the same bytes and previously died on a bare
 * `AssertionError: Invalid number of bytes read` one line after the native
 * scorer's genuinely diagnostic `Trailing N bytes (incomplete record)` had been
 * demoted to a warning.
 *
 * Locked in here:
 *   - a data-fault stderr fails loud as a `DatasetError`, preserving the
 *     scorer's message and exit code, with no WASM attempt;
 *   - a backend-fault stderr still falls back to WASM and scores;
 *   - `evaluateDir`'s own length check names the file and the byte counts.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { Costs } from "@costs";
import { DatasetError } from "@errors/DatasetError.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";
import { isCorruptDatasetFailure } from "../../src/score/ScorerFailureClassification.ts";
import { initWasmForTests } from "../_initWasm.ts";

const CORRUPT_STDERR =
  "Error: Trailing 3696 bytes (incomplete record) after reading all training files";

function buildDataSet(): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < 24; i++) {
    const a = i / 24;
    const b = (24 - i) / 24;
    rows.push({
      input: new Float32Array([a, b]),
      output: new Float32Array([a > b ? 1 : -1]),
    });
  }
  return rows;
}

/** Runner that probes successfully then fails scoring with `stderr`. */
function failingRunner(stderr: string, code = 1) {
  return (_command: string, args: string[]) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    return Promise.resolve({ success: false, code, stdout: "", stderr });
  };
}

const RUST_CONFIG = {
  enabled: true,
  binaryPath: "rust_scorer",
  timeoutMs: 0,
  env: {},
  batch: false,
} as const;

Deno.test("isCorruptDatasetFailure: data faults are recognised", () => {
  assert(isCorruptDatasetFailure(CORRUPT_STDERR));
  assert(isCorruptDatasetFailure("incomplete record at offset 12"));
  assert(isCorruptDatasetFailure("truncated training data file A-2007.bin"));
  assert(
    isCorruptDatasetFailure("file length is not a multiple of the record size"),
  );
});

Deno.test("isCorruptDatasetFailure: backend faults stay retryable", () => {
  assertEquals(isCorruptDatasetFailure(""), false);
  assertEquals(
    isCorruptDatasetFailure("No such file or directory (os error 2)"),
    false,
  );
  assertEquals(
    isCorruptDatasetFailure("failed to initialise GPU device"),
    false,
  );
  assertEquals(isCorruptDatasetFailure("Segmentation fault"), false);
});

Deno.test("RustScorerBridge: corrupt training data fails loud instead of falling back", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  __setRustScorerRunnerForTests(failingRunner(CORRUPT_STDERR, 1));

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 24);
  try {
    const error = await assertRejects(
      () =>
        creature.evaluateDir(
          dataDir,
          Costs.find("MSE"),
          false,
          undefined,
          undefined,
          { ...RUST_CONFIG },
        ),
      DatasetError,
    );
    assertEquals(error.reason, "CORRUPT_DATA");
    assert(
      error.message.includes("Trailing 3696 bytes (incomplete record)"),
      `the scorer's own diagnostic must be preserved, got: ${error.message}`,
    );
    assert(
      error.message.includes("exit 1"),
      `the scorer's exit code must be preserved, got: ${error.message}`,
    );
    assert(
      error.message.includes(dataDir),
      `the dataset directory must be named, got: ${error.message}`,
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerBridge: backend failure still falls back to WASM scoring", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  __setRustScorerRunnerForTests(
    failingRunner("rust_scorer: No such file or directory (os error 2)", 127),
  );

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 24);
  try {
    const result = await creature.evaluateDir(
      dataDir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      { ...RUST_CONFIG },
    );
    assert(
      Number.isFinite(result.error),
      `WASM fallback should have scored, got ${result.error}`,
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("evaluateDir: a short final record names the file and the byte counts", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 24);
  try {
    const bin = [...Deno.readDirSync(dataDir)]
      .find((e) => e.name.endsWith(".bin"))!;
    const path = `${dataDir}/${bin.name}`;
    // Truncate the last record by appending a partial one (4 of 12 bytes).
    const existing = Deno.readFileSync(path);
    const padded = new Uint8Array(existing.length + 4);
    padded.set(existing);
    Deno.writeFileSync(path, padded);

    const error = await assertRejects(
      () => creature.evaluateDir(dataDir, Costs.find("MSE"), false),
      DatasetError,
    );
    assertEquals(error.reason, "CORRUPT_DATA");
    assertEquals(error.path, path);
    assert(
      error.message.includes(path),
      `the offending file must be named, got: ${error.message}`,
    );
    assert(
      error.message.includes("Trailing 4 bytes (incomplete record)"),
      `the trailing byte count must be reported, got: ${error.message}`,
    );
    assert(
      error.message.includes("12 bytes/record"),
      `the record size must be reported, got: ${error.message}`,
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
