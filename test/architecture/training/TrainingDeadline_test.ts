/**
 * Issue #4073 — the per-task training deadline.
 *
 * The Rust `trainDir` path forwards the deadline to the native trainer (ABI 2
 * `deadlineEpochMs` over FFI, `--deadline-epoch-ms` for the CLI). A stop is
 * reported the way the TypeScript loop reports it, through the shared
 * `logTrainingDeadlineStop` line.
 *
 * The FFI cases run against a double of the C ABI, so they need no native
 * build; one case also runs against a real ABI-2 library when one resolves.
 * The CLI cases run `trainDir` in a child process against a stub binary. The
 * doubles name their contract source; neither uses a JS clock.
 */

import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { join } from "@std/path";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { Creature } from "../../../src/Creature.ts";
import { Costs } from "../../../src/Costs.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../../src/architecture/DataSet.ts";
import { trainDir } from "../../../src/architecture/Training.ts";
import { getLogger, setLogger } from "../../../src/utils/Logger.ts";
import { __setRustTrainDirEnabledForTests } from "../../../src/architecture/training/RustTrainDirBridge.ts";
import {
  __installNativeBackpropLibraryForTests,
  closeNativeBackpropLibrary,
  getNativeBackpropAbiVersion,
  isNativeBackpropAvailable,
  type NativeBackpropHandle,
  nativeBackpropSupportsDeadline,
  type NativeBackpropTrainRequest,
  type NativeBackpropTrainResponse,
} from "../../../src/architecture/training/NativeBackpropLibrary.ts";
import {
  createEpochState,
  logTrainingDeadlineStop,
} from "../../../src/architecture/training/TrainingOutcome.ts";
import { runSingleEpoch } from "../../../src/architecture/training/TrainingEpoch.ts";
import {
  dataFiles,
  prepareTraining,
} from "../../../src/architecture/training/TrainingSetup.ts";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface LogLine {
  level: "debug" | "info" | "warn" | "error";
  /** The logged text with ANSI colour codes stripped. */
  text: string;
}

/** Strip ANSI colour codes. */
function plain(text: string): string {
  // deno-lint-ignore no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Route the logger into `lines` until `restore()` is called. */
function captureLogs(): { lines: LogLine[]; restore: () => void } {
  const previous = getLogger();
  const lines: LogLine[] = [];
  const at = (level: LogLine["level"]) => (...args: unknown[]) => {
    lines.push({ level, text: plain(args.map(String).join(" ")) });
  };
  setLogger({
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
  });
  return { lines, restore: () => setLogger(previous) };
}

/** A two-record dataset dir for a `Creature(2, 1)`; the caller removes it. */
function twoRecordDataDir(): string {
  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
  return makeDataDir(dataSet, dataSet.length, { input: 2, output: 1 });
}

/**
 * A budget of `1e-9` minutes is already past and below
 * `MIN_TRAINING_BUDGET_MS`, so its deadline-stop line is the
 * implausibly-small-budget warning rather than `timed out after`.
 */
const TINY_BUDGET_MINUTES = 1e-9;

/** 2100-01-01T00:00:00Z: a deadline no test run reaches. */
const FAR_FUTURE_DEADLINE_MS = 4_102_444_800_000;

/** Which deadline-stop line was logged, if any. */
function deadlineStop(
  texts: readonly string[],
): "tiny budget" | "timed out" | "none" {
  if (texts.some((t) => t.includes("had an implausibly small budget"))) {
    return "tiny budget";
  }
  if (texts.some((t) => t.includes("timed out after"))) return "timed out";
  return "none";
}

// ---------------------------------------------------------------------------
// The shared deadline-stop line
// ---------------------------------------------------------------------------

/** Run `fn` with the logger captured. */
function logsOf(fn: () => void): LogLine[] {
  const { lines, restore } = captureLogs();
  try {
    fn();
  } finally {
    restore();
  }
  return lines;
}

Deno.test("deadline stop: a real budget logs timed out after the elapsed time", () => {
  const lines = logsOf(() =>
    logTrainingDeadlineStop("a812440f", 10_000, 15_000, 13_451)
  );
  assertEquals(lines, [
    { level: "info", text: "Training a812440f timed out after 3s 451ms" },
  ]);
});

Deno.test("deadline stop: a sub-second budget is flagged, not timed out", () => {
  const lines = logsOf(() =>
    logTrainingDeadlineStop("d415897d", 10_000, 10_500, 10_520)
  );
  assertEquals(lines, [
    {
      level: "warn",
      text: "Training d415897d had an implausibly small budget of 500ms " +
        "(< 1000ms) — likely a queue delay or misconfiguration; no useful " +
        "training performed.",
    },
  ]);
});

Deno.test({
  name: "deadline stop: the TypeScript loop logs it when its deadline passes",
  fn: () => {
    const creature = new Creature(2, 1);
    const dataDir = twoRecordDataDir();
    try {
      const options = { iterations: 1, disableRandomSamples: true };
      const setup = prepareTraining(creature, options, "ts-deadline");
      // A deadline long past: the loop stops at its first sample.
      const state = { ...createEpochState(setup), timeoutTS: 1 };
      let stopped = false;
      const lines = logsOf(() => {
        stopped = runSingleEpoch(
          creature,
          dataFiles(dataDir, options).files,
          options,
          Costs.find("MSE"),
          setup,
          state,
        ).trainingStopped;
      });
      assertEquals(stopped, true);
      assertEquals(state.timedOut, true);
      assert(
        lines.some((line) =>
          line.level === "warn" &&
          line.text.startsWith(
            "Training ts-deadline had an implausibly small budget",
          )
        ),
        `expected the deadline-stop line, got ${JSON.stringify(lines)}`,
      );
    } finally {
      Deno.removeSync(dataDir, { recursive: true });
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// ---------------------------------------------------------------------------
// FFI: a real ABI-2 library, when one resolves
// ---------------------------------------------------------------------------

Deno.test({
  name: "Rust trainDir FFI: per-task deadline stops the native trainer early",
  fn: () => {
    closeNativeBackpropLibrary();
    if (!isNativeBackpropAvailable() || !nativeBackpropSupportsDeadline()) {
      return;
    }
    const dataDir = twoRecordDataDir();
    __setRustTrainDirEnabledForTests(true);
    const { lines, restore } = captureLogs();
    try {
      // The deadline is already passed, so the native loop stops before
      // epoch 1 and reports max(1, completed) iterations.
      const result = trainDir(
        new Creature(2, 1),
        dataDir,
        {
          iterations: 50,
          disableRandomSamples: true,
          trainingTimeOutMinutes: TINY_BUDGET_MINUTES,
        },
        Costs.find("MSE"),
      );
      assert(
        result.iteration < 50,
        `deadline should stop training early, got ${result.iteration}`,
      );
      assert(
        Number.isFinite(result.error),
        `a stop before epoch 1 must still report a finite error, got ${result.error}`,
      );
      assertEquals(deadlineStop(lines.map((l) => l.text)), "tiny budget");
    } finally {
      restore();
      __setRustTrainDirEnabledForTests(undefined);
      closeNativeBackpropLibrary();
      Deno.removeSync(dataDir, { recursive: true });
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// ---------------------------------------------------------------------------
// FFI: a double of the C ABI
// ---------------------------------------------------------------------------

type FieldKind =
  | "string"
  | "string?"
  | "u64"
  | "u64?"
  | "u32"
  | "f64"
  | "bool"
  | "strategy";

/**
 * `TrainAbiRequest` at ABI 1, camelCase on the wire. It is
 * `deny_unknown_fields`, so any other key is rejected. `trustRegion`,
 * `stepScaleLadder` and `acceptance` are left out: the bridge never sends
 * them, so the double rejects them rather than model their shapes.
 */
const ABI_1_REQUEST_FIELDS: Record<string, FieldKind> = {
  creatureJson: "string",
  trainingData: "string",
  outputDir: "string",
  epochs: "u64",
  maxRecords: "u64?",
  seed: "u64",
  disableRandomSamples: "bool",
  learningRate: "f64",
  learningRateStrategy: "strategy",
  learningRateDecay: "f64",
  normaliseGradients: "bool",
  maximumBiasAdjustmentScale: "f64",
  maximumWeightAdjustmentScale: "f64",
  stepScale: "f64",
  outputsOnly: "bool",
  hiddenOnly: "bool",
  minScoreImprovement: "f64",
  msePreScreen: "bool",
  acceptAlways: "bool",
  maxBacktracks: "u32",
  scorer: "string?",
  traceStore: "string?",
};

/** Fields with no serde default: a request without one is rejected. */
const REQUIRED_REQUEST_FIELDS = ["creatureJson", "trainingData", "outputDir"];

/** `AbiLearningRateStrategy`, serde camelCase. */
const ABI_STRATEGIES = ["fixed", "decay", "adaptive", "warmRestart"];

function fitsKind(kind: FieldKind, value: unknown): boolean {
  const isUint = (max: number) =>
    Number.isSafeInteger(value) && (value as number) >= 0 &&
    (value as number) <= max;
  switch (kind) {
    case "string":
      return typeof value === "string";
    case "string?":
      return value === null || typeof value === "string";
    case "u64":
      return isUint(Number.MAX_SAFE_INTEGER);
    case "u64?":
      return value === null || isUint(Number.MAX_SAFE_INTEGER);
    case "u32":
      return isUint(0xffff_ffff);
    case "f64":
      return typeof value === "number";
    case "bool":
      return typeof value === "boolean";
    case "strategy":
      return ABI_STRATEGIES.includes(value as string);
  }
}

/** Why the real library would reject `request` at `abi`, or undefined. */
function invalidRequestReason(
  abi: number,
  request: Record<string, unknown>,
): string | undefined {
  const fields: Record<string, FieldKind> = abi >= 2
    ? { ...ABI_1_REQUEST_FIELDS, deadlineEpochMs: "u64?" }
    : ABI_1_REQUEST_FIELDS;
  for (const [key, value] of Object.entries(request)) {
    const kind = fields[key];
    if (kind === undefined) return `unknown field \`${key}\``;
    if (!fitsKind(kind, value)) {
      return `invalid type for \`${key}\`: ${JSON.stringify(value)}`;
    }
  }
  for (const key of REQUIRED_REQUEST_FIELDS) {
    if (!(key in request)) return `missing field \`${key}\``;
  }
  return undefined;
}

/** Hand `payload` back through a `NeatBackpropBuffer` (data*, len, capacity). */
function writeOwnedUtf8(out: Uint8Array, payload: Uint8Array): void {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setBigUint64(
    0,
    BigInt(Deno.UnsafePointer.value(Deno.UnsafePointer.of(payload))),
    true,
  );
  view.setBigUint64(8, BigInt(payload.byteLength), true);
  view.setBigUint64(16, BigInt(payload.byteLength), true);
}

/** How one double trains when it is not stopped. */
interface FakeNativeTrain {
  /**
   * The double's clock (epoch ms). Like the real trainer, it stops before an
   * epoch once a deadline was sent and `nowEpochMs >= deadlineEpochMs`.
   */
  nowEpochMs: number;
  /** MSE of the creature before epoch 1. */
  baselineMse: number;
  /**
   * `afterMse` of each epoch; an epoch is accepted when it improves. The run
   * ends at the first rejected epoch, as the real FFI trainer's does.
   */
  epochMses: number[];
}

/**
 * A double of the `libneat_ai_backpropagation` C ABI (Issue #4073).
 *
 * Contract source: stSoftwareAU/NEAT-AI-Backpropagation, branch
 * `issue-neat-ai-4073-train-deadline` (commit 7ec31cc) —
 * `backpropagation/src/ffi.rs` (`TrainAbiRequest`, `deny_unknown_fields`,
 * `deadlineEpochMs: Option<u64>` from ABI 2; `TrainAbiResponse`, which echoes
 * `request.epochs` and, from ABI 2, always carries `timedOut`; the
 * `NEAT_BACKPROP_OK` / `NEAT_BACKPROP_ERR_INVALID_ARGUMENT` (1) statuses; the
 * JSON payload in a `NeatBackpropBuffer`; the NUL-terminated version string)
 * and `backpropagation/src/train.rs` (the baseline MSE is measured before
 * epoch 1; the deadline is checked before each epoch; a stop journals
 * `{"kind":"timedOut","completedEpochs":N,"deadlineEpochMs":D}` after a
 * `runHeader` line and any epoch lines; a rejected epoch ends the run when
 * `sparse_ratio >= 1.0 && disable_random_samples`, which always holds over
 * FFI because `ffi.rs` builds its config from `BackpropConfig::default()`).
 *
 * A request the real library would reject — an unknown field
 * (`deadlineEpochMs` at ABI 1), a missing required field, or a value of the
 * wrong type — gets status 1 and an `invalid train request JSON` message.
 * `closes.count` counts `close()` calls.
 */
function fakeNativeLibrary(
  abi: number,
  train: FakeNativeTrain,
  requests: NativeBackpropTrainRequest[],
  closes: { count: number } = { count: 0 },
): NativeBackpropHandle {
  const keepAlive: Uint8Array[] = [];
  const version = new TextEncoder().encode("0.0.0-test-double\0");
  const answer = (out: Uint8Array, status: number, body: string): number => {
    const payload = new TextEncoder().encode(body);
    keepAlive.push(payload);
    writeOwnedUtf8(out, payload);
    return status;
  };
  const symbols = {
    "neat_backprop_abi_version": () => abi,
    "neat_backprop_version": () => Deno.UnsafePointer.of(version),
    "neat_backprop_train": (
      requestBytes: Uint8Array,
      length: bigint,
      out: Uint8Array,
    ) => {
      const request = JSON.parse(
        new TextDecoder().decode(requestBytes.subarray(0, Number(length))),
      ) as NativeBackpropTrainRequest;
      requests.push(request);
      const invalid = invalidRequestReason(
        abi,
        request as unknown as Record<string, unknown>,
      );
      if (invalid !== undefined) {
        return answer(out, 1, `invalid train request JSON: ${invalid}`);
      }
      const journal: object[] = [{ kind: "runHeader" }];
      let bestMse = train.baselineMse;
      let acceptedEpochs = 0;
      let timedOut = false;
      const epochs = Math.min(request.epochs, train.epochMses.length);
      for (let epoch = 1; epoch <= epochs; epoch++) {
        const deadline = request.deadlineEpochMs;
        if (deadline !== undefined && train.nowEpochMs >= deadline) {
          timedOut = true;
          journal.push({
            kind: "timedOut",
            completedEpochs: epoch - 1,
            deadlineEpochMs: deadline,
          });
          break;
        }
        const afterMse = train.epochMses[epoch - 1];
        const accepted = afterMse < bestMse;
        journal.push({
          kind: "epoch",
          epoch,
          beforeMse: bestMse,
          afterMse,
          accepted,
        });
        if (!accepted) break;
        bestMse = afterMse;
        acceptedEpochs++;
      }
      const journalPath = join(request.outputDir, "journal.jsonl");
      Deno.writeTextFileSync(
        journalPath,
        journal.map((line) => JSON.stringify(line) + "\n").join(""),
      );
      const response: NativeBackpropTrainResponse = {
        abiVersion: abi,
        version: "0.0.0-test-double",
        bestCreatureJson: request.creatureJson,
        baselineMse: train.baselineMse,
        bestMse,
        acceptedEpochs,
        epochs: request.epochs,
        bestPath: join(request.outputDir, "best.json"),
        journalPath,
        ...(abi >= 2 ? { timedOut } : {}),
      };
      return answer(out, 0, JSON.stringify(response));
    },
    "neat_backprop_buffer_free": () => {},
  };
  return {
    symbols,
    close: () => {
      closes.count++;
    },
  } as unknown as NativeBackpropHandle;
}

interface FakeFfiOutcome {
  supportsDeadline: boolean;
  abiVersion: number | undefined;
  requests: NativeBackpropTrainRequest[];
  error: number;
  iteration: number;
  logs: string[];
}

/** Run one Rust `trainDir` (50 iterations) against {@link fakeNativeLibrary}. */
function trainWithFakeLibrary(
  abi: number,
  train: FakeNativeTrain,
  options: TrainOptions,
): FakeFfiOutcome {
  const requests: NativeBackpropTrainRequest[] = [];
  const dataDir = twoRecordDataDir();
  const { lines, restore } = captureLogs();
  __setRustTrainDirEnabledForTests(true);
  try {
    assertEquals(
      __installNativeBackpropLibraryForTests(
        fakeNativeLibrary(abi, train, requests),
      ),
      true,
    );
    const supportsDeadline = nativeBackpropSupportsDeadline();
    const abiVersion = getNativeBackpropAbiVersion();
    const result = trainDir(
      new Creature(2, 1),
      dataDir,
      { iterations: 50, disableRandomSamples: true, ...options },
      Costs.find("MSE"),
    );
    return {
      supportsDeadline,
      abiVersion,
      requests,
      error: result.error,
      iteration: result.iteration,
      logs: lines.map((l) => l.text),
    };
  } finally {
    restore();
    __setRustTrainDirEnabledForTests(undefined);
    closeNativeBackpropLibrary();
    Deno.removeSync(dataDir, { recursive: true });
  }
}

/** The double's clock for runs whose deadline must count as passed. */
const DOUBLE_CLOCK_PAST_EVERY_DEADLINE = Number.MAX_SAFE_INTEGER;

Deno.test({
  name:
    "Rust trainDir FFI double: a stop before epoch 1 keeps the response's finite error",
  fn: () => {
    const outcome = trainWithFakeLibrary(2, {
      nowEpochMs: DOUBLE_CLOCK_PAST_EVERY_DEADLINE,
      baselineMse: 0.3,
      epochMses: [0.2, 0.1],
    }, { trainingTimeOutMinutes: TINY_BUDGET_MINUTES });
    assert(
      outcome.logs.some((line) =>
        line.includes("libneat_ai_backpropagation loaded from (test double)")
      ),
      `expected the library-loaded line, got ${JSON.stringify(outcome.logs)}`,
    );
    assertEquals(outcome.abiVersion, 2);
    assertEquals(outcome.supportsDeadline, true);
    assertEquals(outcome.requests.length, 1);
    const deadline = outcome.requests[0].deadlineEpochMs;
    assert(
      Number.isSafeInteger(deadline) && (deadline as number) > 0,
      `ABI 2 request should carry an integer deadline, got ${deadline}`,
    );
    // No epoch ran: the journal has no MSE, so the error is the baseline.
    assertEquals(outcome.error, 0.3);
    assertEquals(outcome.iteration, 1);
    assertEquals(deadlineStop(outcome.logs), "tiny budget");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name:
    "Rust trainDir FFI double: a future deadline is forwarded exactly and every epoch runs",
  fn: () => {
    const outcome = trainWithFakeLibrary(2, {
      nowEpochMs: FAR_FUTURE_DEADLINE_MS - 1,
      baselineMse: 0.3,
      epochMses: [0.2, 0.15, 0.1],
    }, { hardDeadlineTS: FAR_FUTURE_DEADLINE_MS });
    assertEquals(outcome.requests.length, 1);
    assertEquals(outcome.requests[0].deadlineEpochMs, FAR_FUTURE_DEADLINE_MS);
    assertEquals(outcome.iteration, 3);
    assertEquals(outcome.error, 0.1);
    assertEquals(deadlineStop(outcome.logs), "none");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Rust trainDir FFI double: no deadline sends no deadlineEpochMs",
  fn: () => {
    // The double's clock is past any deadline, so a stray one would stop it.
    const outcome = trainWithFakeLibrary(2, {
      nowEpochMs: DOUBLE_CLOCK_PAST_EVERY_DEADLINE,
      baselineMse: 0.3,
      epochMses: [0.2, 0.1],
    }, {});
    assertEquals(outcome.requests.length, 1);
    assertEquals("deadlineEpochMs" in outcome.requests[0], false);
    assertEquals(outcome.iteration, 2);
    assertEquals(outcome.error, 0.1);
    assertEquals(deadlineStop(outcome.logs), "none");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name:
    "Rust trainDir FFI double: an ABI-1 library trains without the deadline and warns",
  fn: () => {
    // ABI 1 rejects `deadlineEpochMs` as an unknown field, so sending it
    // would fail the train.
    const outcome = trainWithFakeLibrary(1, {
      nowEpochMs: DOUBLE_CLOCK_PAST_EVERY_DEADLINE,
      baselineMse: 0.3,
      epochMses: [0.2, 0.1],
    }, { trainingTimeOutMinutes: TINY_BUDGET_MINUTES });
    assertEquals(outcome.abiVersion, 1);
    assertStrictEquals(outcome.supportsDeadline, false);
    assertEquals(outcome.requests.length, 1);
    assertEquals("deadlineEpochMs" in outcome.requests[0], false);
    assertEquals(outcome.iteration, 2);
    assertEquals(outcome.error, 0.1);
    assert(
      outcome.logs.some((line) =>
        line.includes("(ABI 1) cannot enforce the per-task deadline")
      ),
      `expected the ABI-1 warning, got ${JSON.stringify(outcome.logs)}`,
    );
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test("Rust trainDir FFI double: an ABI outside 1..2 is refused and closed", () => {
  const train: FakeNativeTrain = {
    nowEpochMs: 0,
    baselineMse: 0.3,
    epochMses: [],
  };
  const { lines, restore } = captureLogs();
  try {
    for (const abi of [0, 3]) {
      const accepted = { count: 0 };
      const refused = { count: 0 };
      assertEquals(
        __installNativeBackpropLibraryForTests(
          fakeNativeLibrary(2, train, [], accepted),
        ),
        true,
      );
      assertEquals(
        __installNativeBackpropLibraryForTests(
          fakeNativeLibrary(abi, train, [], refused),
        ),
        false,
        `ABI ${abi} should be refused`,
      );
      assertEquals(accepted.count, 1, "the replaced library is closed");
      assertEquals(refused.count, 1, `the ABI ${abi} library is closed`);
      assert(
        lines.some((line) => line.text.includes(`reports ABI ${abi}`)),
        `expected the ABI ${abi} refusal, got ${JSON.stringify(lines)}`,
      );
    }
  } finally {
    restore();
    closeNativeBackpropLibrary();
  }
});

Deno.test("Rust trainDir FFI: no library supports no deadline", () => {
  closeNativeBackpropLibrary();
  try {
    if (isNativeBackpropAvailable()) return;
    assertStrictEquals(getNativeBackpropAbiVersion(), undefined);
    assertStrictEquals(nativeBackpropSupportsDeadline(), false);
  } finally {
    closeNativeBackpropLibrary();
  }
});

// ---------------------------------------------------------------------------
// CLI: a stub of the `neat_ai_backpropagation` binary
// ---------------------------------------------------------------------------

/**
 * Stub for the `neat_ai_backpropagation train` CLI (Issue #4073).
 *
 * Contract source: `backpropagation/src/main.rs` and
 * `backpropagation/src/train.rs` in stSoftwareAU/NEAT-AI-Backpropagation,
 * branch `issue-neat-ai-4073-train-deadline` (commit 7ec31cc). There
 * `train --help` lists `--deadline-epoch-ms <DEADLINE_EPOCH_MS>`, and a
 * deadline stop appends
 * `{"kind":"timedOut","completedEpochs":N,"deadlineEpochMs":D}` to
 * journal.jsonl.
 *
 * `train --help` lists `--deadline-epoch-ms` only when `supportsDeadline`.
 * Failures mirror the real CLI's clap parsing, which exits 2 on: a subcommand
 * other than `train`; a missing `<CREATURE>` or `<DATA>` positional; an
 * unexpected argument; a value that is not a `u64` (`--epochs`, `--seed`,
 * `--max-records`, `--deadline-epoch-ms`), not an `f64` (`--learning-rate`,
 * `--learning-rate-decay`, `--maximum-*-adjustment-scale`, `--step-scale`) or
 * not a `--learning-rate-strategy` value (`fixed`, `decay`, `adaptive`,
 * `warm-restart`). `--output-dir` defaults to `.backprop`, as the real
 * one does. An unreadable creature file or a data path that is not a
 * directory exits 1.
 *
 * The journal opens with a `runHeader` line. With a deadline already passed
 * the stub, like the real trainer, runs no epoch: it journals only
 * `{"kind":"timedOut","completedEpochs":0,…}` and reports the baseline as the
 * best MSE. Otherwise it journals epochs 1..N for `--epochs N`. Either way
 * stderr carries the CLI's
 * `train: baseline_mse=<B> best_mse=<M> accepted_epochs=<N>` line, rounded to
 * 12 decimals as the real CLI's `{:.12}` is, so a journal MSE with more digits
 * tells the two sources apart.
 *
 * Test instrumentation, not contract: each `train` run (not `--help`) appends
 * its arguments to `$HOME/train-argv.log`, so a test can read the exact
 * deadline the bridge sent.
 */
function cliStubScript(supportsDeadline: boolean): string {
  const usage = [
    "Usage: neat_ai_backpropagation train <CREATURE> <DATA> [OPTIONS]",
    "  --epochs <N>",
    "  --output-dir <DIR>",
  ];
  if (supportsDeadline) {
    usage.push(
      "  --deadline-epoch-ms <DEADLINE_EPOCH_MS>  Absolute deadline (ms since epoch)",
    );
  }
  const helpLines = usage.map((line) => `  echo '${line}'`).join("\n");
  const deadlineCase = supportsDeadline
    ? `    --deadline-epoch-ms) u64_of "$1" "$#" "\${2:-}"; deadline="$2"; shift 2 ;;\n`
    : "";
  return `#!/usr/bin/env bash
set -euo pipefail
value_of() {
  if [ "$2" -lt 2 ]; then
    echo "error: a value is required for '$1' but none was supplied" >&2
    exit 2
  fi
}
invalid() {
  echo "error: invalid value '$2' for '$1'" >&2
  exit 2
}
u64_of() {
  value_of "$1" "$2"
  [[ "$3" =~ ^[0-9]+$ ]] || invalid "$1" "$3"
}
f64_of() {
  value_of "$1" "$2"
  [[ "$3" =~ ^-?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][-+]?[0-9]+)?$ ]] || invalid "$1" "$3"
}
strategy_of() {
  value_of "$1" "$2"
  case "$3" in fixed|decay|adaptive|warm-restart) ;; *) invalid "$1" "$3" ;; esac
}
if [ "\${1:-}" != "train" ]; then
  echo "error: unrecognized subcommand '\${1:-}'" >&2
  exit 2
fi
if [ "\${2:-}" = "--help" ]; then
${helpLines}
  exit 0
fi
printf '%s\n' "$*" >> "$HOME/train-argv.log"
creature="\${2:-}"
data="\${3:-}"
missing=()
case "$creature" in ""|-*) missing+=("<CREATURE>") ;; esac
case "$data" in ""|-*) missing+=("<DATA>") ;; esac
if [ "\${#missing[@]}" -gt 0 ]; then
  echo "error: the following required arguments were not provided:" >&2
  for m in "\${missing[@]}"; do echo "  $m" >&2; done
  exit 2
fi
shift 3
epochs=1
outdir=".backprop"
deadline=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --epochs) u64_of "$1" "$#" "\${2:-}"; epochs="$2"; shift 2 ;;
    --output-dir) value_of "$1" "$#"; outdir="$2"; shift 2 ;;
${deadlineCase}    --seed | --max-records) u64_of "$1" "$#" "\${2:-}"; shift 2 ;;
    --learning-rate | --learning-rate-decay | --maximum-bias-adjustment-scale | --maximum-weight-adjustment-scale | --step-scale) f64_of "$1" "$#" "\${2:-}"; shift 2 ;;
    --learning-rate-strategy) strategy_of "$1" "$#" "\${2:-}"; shift 2 ;;
    --trace-store) value_of "$1" "$#"; shift 2 ;;
    --normalise-gradients | --disable-random-samples) shift ;;
    *) echo "error: unexpected argument '$1' found" >&2; exit 2 ;;
  esac
done
if [ ! -r "$creature" ]; then
  echo "error: creature file '$creature' is not readable" >&2
  exit 1
fi
if [ ! -d "$data" ]; then
  echo "error: data dir '$data' is not a directory" >&2
  exit 1
fi
mkdir -p "$outdir"
cp "$creature" "$outdir/best.json"
journal="$outdir/journal.jsonl"
# Deadlines are compared at whole-second resolution, rounded up to the end of
# the current second, so any deadline set before this stub runs counts as past.
now_ms=$(( $(date +%s) * 1000 + 999 ))
echo '{"kind":"runHeader"}' > "$journal"
if [ -n "$deadline" ] && [ "$deadline" -le "$now_ms" ]; then
  echo '{"kind":"timedOut","completedEpochs":0,"deadlineEpochMs":'"$deadline"'}' >> "$journal"
  echo "train: baseline_mse=0.500000000000 best_mse=0.500000000000 accepted_epochs=0" >&2
  echo "train: timed_out=true (the deadline stopped the run before every epoch ran)" >&2
else
  i=1
  while [ "$i" -le "$epochs" ]; do
    echo '{"kind":"epoch","epoch":'"$i"',"beforeMse":0.5,"afterMse":0.4000000000001,"accepted":true}' >> "$journal"
    i=$((i + 1))
  done
  echo "train: baseline_mse=0.500000000000 best_mse=0.400000000000 accepted_epochs=$epochs" >&2
fi
`;
}

interface CliTrainProbe {
  iteration: number;
  error: number;
  usedCli: boolean;
  /** Which deadline-stop line was logged (see {@link deadlineStop}). */
  stop: "tiny budget" | "timed out" | "none";
  /** How many times the deadline-unsupported warning was logged. */
  deadlineWarnings: number;
  /** The arguments of each `train` run, one line per run. */
  trainArgs: string[];
}

/**
 * Run `runs` `trainDir` calls on `dataDir` in one child process and classify
 * its logs (the result is the last train's). Env is cleared (tests must not
 * mutate it), HOME is the temp dir, and the FFI library path is an empty file
 * so the CLI fallback is the only backend.
 */
async function runCliTrainChild(
  home: string,
  binary: string,
  emptyLib: string,
  dataDir: string,
  options: TrainOptions,
  runs: number,
): Promise<CliTrainProbe> {
  const code = `import { Creature } from "./src/Creature.ts";
import { Costs } from "./src/Costs.ts";
import { trainDir } from "./src/architecture/Training.ts";
import { setLogger } from "./src/utils/Logger.ts";

const logs: string[] = [];
const capture = (...args: unknown[]) => {
  logs.push(args.map(String).join(" "));
};
setLogger({ debug: capture, info: capture, warn: capture, error: capture });

const creature = new Creature(2, 1);
let result;
for (let run = 0; run < ${runs}; run++) {
  result = trainDir(creature, ${JSON.stringify(dataDir)}, ${
    JSON.stringify(options)
  }, Costs.find("MSE"));
}
console.log(JSON.stringify({
  iteration: result!.iteration,
  error: result!.error,
  logs,
}));
`;

  const passThrough: Record<string, string> = {};
  for (const key of ["PATH", "DENO_DIR", "TMPDIR"]) {
    const value = Deno.env.get(key);
    if (value !== undefined) passThrough[key] = value;
  }
  const command = new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config", "./deno.json", code],
    env: {
      ...passThrough,
      HOME: home,
      NEAT_AI_BACKPROP_ENABLED: "1",
      NEAT_AI_BACKPROP_BINARY_PATH: binary,
      NEAT_AI_BACKPROP_LIB_PATH: emptyLib,
    },
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  });
  const { code: status, stdout, stderr } = await command.output();
  const decodedErr = new TextDecoder().decode(stderr);
  assertEquals(status, 0, `child failed: ${decodedErr}`);
  const out = new TextDecoder().decode(stdout).trim();
  const child = JSON.parse(out.split("\n").at(-1)!) as {
    iteration: number;
    error: number;
    logs: string[];
  };
  const texts = child.logs.map(plain);
  return {
    iteration: child.iteration,
    error: child.error,
    usedCli: texts.some((t) => t.includes("trainDir using CLI")),
    stop: deadlineStop(texts),
    deadlineWarnings: texts.filter((t) => t.includes("--deadline-epoch-ms"))
      .length,
    trainArgs: (await Deno.readTextFile(join(home, "train-argv.log"))).trim()
      .split("\n"),
  };
}

async function cliTrainProbe(
  supportsDeadline: boolean,
  options: TrainOptions,
  runs = 1,
): Promise<CliTrainProbe> {
  const dir = await Deno.makeTempDir({ prefix: "neat-ai-cli-deadline-" });
  const dataDir = twoRecordDataDir();
  try {
    const binary = join(dir, "neat_ai_backpropagation");
    await Deno.writeTextFile(binary, cliStubScript(supportsDeadline));
    await Deno.chmod(binary, 0o755);
    const emptyLib = join(dir, "libneat_ai_backpropagation.so");
    await Deno.writeFile(emptyLib, new Uint8Array());
    return await runCliTrainChild(
      dir,
      binary,
      emptyLib,
      dataDir,
      { iterations: 50, disableRandomSamples: true, ...options },
      runs,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(dataDir, { recursive: true });
  }
}

Deno.test({
  name:
    "Rust trainDir CLI: per-task deadline is forwarded and stops training early",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const probe = await cliTrainProbe(true, {
      trainingTimeOutMinutes: TINY_BUDGET_MINUTES,
    });
    assertEquals(probe.usedCli, true);
    assertEquals(probe.iteration, 1);
    // No epoch ran, so the error is the CLI's reported baseline, not Infinity.
    assertEquals(probe.error, 0.5);
    assertEquals(probe.stop, "tiny budget");
    assertEquals(probe.deadlineWarnings, 0);
  },
});

Deno.test({
  name: "Rust trainDir CLI: a future deadline is forwarded exactly",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const probe = await cliTrainProbe(true, {
      hardDeadlineTS: FAR_FUTURE_DEADLINE_MS,
    });
    assertEquals(probe.trainArgs.length, 1);
    assert(
      probe.trainArgs[0].includes(
        `--deadline-epoch-ms ${FAR_FUTURE_DEADLINE_MS}`,
      ),
      `expected the exact deadline, got ${probe.trainArgs[0]}`,
    );
    assertEquals(probe.iteration, 50);
    assertEquals(probe.stop, "none");
  },
});

Deno.test({
  name: "Rust trainDir CLI: no deadline runs every iteration",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const probe = await cliTrainProbe(true, {});
    assertEquals(probe.usedCli, true);
    assertEquals(probe.trainArgs.length, 1);
    assertEquals(probe.trainArgs[0].includes("--deadline-epoch-ms"), false);
    assertEquals(probe.iteration, 50);
    assertEquals(probe.error, 0.4000000000001);
    assertEquals(probe.stop, "none");
    assertEquals(probe.deadlineWarnings, 0);
  },
});

Deno.test({
  name:
    "Rust trainDir CLI: binary without --deadline-epoch-ms trains and warns",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    // Two trains in one process: the warning is logged once, not per train.
    const probe = await cliTrainProbe(false, {
      trainingTimeOutMinutes: TINY_BUDGET_MINUTES,
    }, 2);
    assertEquals(probe.usedCli, true);
    assertEquals(probe.iteration, 50);
    assertEquals(probe.error, 0.4000000000001);
    assertEquals(probe.stop, "none");
    assertEquals(probe.deadlineWarnings, 1);
  },
});
