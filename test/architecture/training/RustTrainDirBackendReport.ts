/**
 * Issue #4146 — every training task reports its backend, whether a deadline
 * was sent and the capability version, before the blocking native call.
 *
 * `trainDir` runs for real. The native trainer is a double installed through
 * `__installNativeBackpropLibraryForTests` (the same captures the deadline
 * tests use, test/fixtures/native-backprop/README.md). The CLI path runs in a
 * child process so it is isolated from any FFI library on the host. No test
 * reads a clock or a timing API (#2888).
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { Creature } from "@creature";
import { Costs } from "@costs";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import {
  __resetNativeDeadlineDiagnosticsForTests,
  __setRustTrainDirEnabledForTests,
} from "@architecture/training/RustTrainDirBridge.ts";
import {
  __installNativeBackpropLibraryForTests,
  closeNativeBackpropLibrary,
  type NativeBackpropHandle,
} from "@architecture/training/NativeBackpropLibrary.ts";
import { setTrainDirReporter } from "@architecture/training/TrainDirBackendReport.ts";
import type { TrainingResult } from "@architecture/training/TrainingTypes.ts";

const FIXTURE_DIR = new URL("../../fixtures/native-backprop/", import.meta.url);

function readFixture(name: string): string {
  return Deno.readTextFileSync(new URL(name, FIXTURE_DIR));
}

const CAPABILITIES = readFixture("capabilities-new.json");
const LEGACY_RESPONSE = readFixture("ffi-response-legacy.json");
const COMPLETED_RESPONSE = readFixture("ffi-response-new-completed.json");
const EXPIRED_RESPONSE = readFixture("ffi-response-new-timed-out-expired.json");

/** The input creature the captures were produced from. */
const INPUT_CREATURE_JSON = (JSON.parse(EXPIRED_RESPONSE) as {
  bestCreatureJson: string;
}).bestCreatureJson;

/** A fixed far-future instant (2100-01-01T00:00:00Z). No clock is read. */
const HARD_DEADLINE_TS = 4_102_444_800_000;

/** A `[training-backend]` report at info level, with any task id. */
const BACKEND_LINE = (fields: string): RegExp =>
  new RegExp(`^info\\|\\[training-backend\\] task=\\S+ ${fields}$`);

// Keeps every buffer handed to the native side reachable while a double reads it.
const keepAlive: Uint8Array[] = [];

function writeOwnedBuffer(out: Uint8Array, bytes: Uint8Array): void {
  keepAlive.push(bytes);
  const address = Deno.UnsafePointer.value(Deno.UnsafePointer.of(bytes));
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setBigUint64(0, address, true);
  view.setBigUint64(8, BigInt(bytes.byteLength), true);
  view.setBigUint64(16, BigInt(bytes.byteLength), true);
}

/**
 * A `NativeBackpropHandle` double that answers every train call with
 * `payload` and calls `onTrain` first. `capabilities` omitted means a legacy
 * library: the `neat_backprop_capabilities` symbol is null.
 */
function makeDouble(options: {
  capabilities?: string;
  payload: string;
  onTrain: () => void;
}): NativeBackpropHandle {
  const capabilityBytes = options.capabilities === undefined
    ? null
    : new TextEncoder().encode(`${options.capabilities}\0`);
  if (capabilityBytes !== null) keepAlive.push(capabilityBytes);
  const payloadBytes = new TextEncoder().encode(options.payload);
  const handle = {
    symbols: {
      neat_backprop_abi_version: () => 1,
      neat_backprop_version: () => null,
      neat_backprop_capabilities: capabilityBytes === null
        ? null
        : () => Deno.UnsafePointer.of(capabilityBytes),
      neat_backprop_train: (
        _request: Uint8Array,
        _len: bigint,
        out: Uint8Array,
      ) => {
        options.onTrain();
        writeOwnedBuffer(out, payloadBytes);
        return 0;
      },
      neat_backprop_buffer_free: () => {},
    },
    close: () => {},
  };
  // The double mirrors the C ABI shape only; see NativeBackpropCapabilities.ts.
  return handle as unknown as NativeBackpropHandle;
}

/** Install `double` as the native library for `body`, then restore everything. */
function withNativeLibrary<T>(double: NativeBackpropHandle, body: () => T): T {
  closeNativeBackpropLibrary();
  __setRustTrainDirEnabledForTests(true);
  try {
    assert(
      __installNativeBackpropLibraryForTests(double),
      "the double must pass the ABI check",
    );
    return body();
  } finally {
    closeNativeBackpropLibrary();
    __setRustTrainDirEnabledForTests(undefined);
  }
}

/** The input creature the captures were produced from. */
function fixtureCreature(): Creature {
  return Creature.fromJSON(JSON.parse(INPUT_CREATURE_JSON));
}

function makeSingleDataDir(creature: Creature): string {
  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0.5]), output: new Float32Array([1]) },
    { input: new Float32Array([1]), output: new Float32Array([2]) },
  ];
  return makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
}

function trainWith(creature: Creature, dataDir: string): TrainingResult {
  return trainDir(
    creature,
    dataDir,
    {
      iterations: 1,
      disableRandomSamples: true,
      hardDeadlineTS: HARD_DEADLINE_TS,
    },
    Costs.find("MSE"),
  );
}

// --- FFI: a deadline-capable library ----------------------------------------

Deno.test("Issue #4146: a deadline-capable FFI train reports backend=ffi deadlineSent=yes capability=1 before the native call", () => {
  const creature = fixtureCreature();
  const dataDir = makeSingleDataDir(creature);
  const events: string[] = [];
  setTrainDirReporter((level, message) => {
    events.push(`${level}|${message}`);
  });
  try {
    withNativeLibrary(
      makeDouble({
        capabilities: CAPABILITIES,
        payload: COMPLETED_RESPONSE,
        onTrain: () => events.push("native-train"),
      }),
      () => trainWith(creature, dataDir),
    );
    const lines = events.filter((e) => e.includes("[training-backend]"));
    assertEquals(lines.length, 1, "one backend line per task");
    assert(
      BACKEND_LINE("backend=ffi deadlineSent=yes capability=1").test(lines[0]),
      `unexpected backend line: ${lines[0]}`,
    );
    assert(
      events.indexOf(lines[0]) < events.indexOf("native-train"),
      "the backend line must be written before the native call",
    );
  } finally {
    setTrainDirReporter(undefined);
    Deno.removeSync(dataDir, { recursive: true });
  }
});

// --- FFI: a legacy library --------------------------------------------------

Deno.test("Issue #4146: a legacy FFI train reports backend=ffi deadlineSent=no capability=none and relays its warning", () => {
  __resetNativeDeadlineDiagnosticsForTests();
  const creature = fixtureCreature();
  const dataDir = makeSingleDataDir(creature);
  const reports: string[] = [];
  setTrainDirReporter((level, message) => {
    reports.push(`${level}|${message}`);
  });
  try {
    withNativeLibrary(
      makeDouble({
        payload: LEGACY_RESPONSE,
        onTrain: () => reports.push("native-train"),
      }),
      () => trainWith(creature, dataDir),
    );
    const lines = reports.filter((r) => r.includes("[training-backend]"));
    assertEquals(lines.length, 1, "one backend line per task");
    assert(
      BACKEND_LINE("backend=ffi deadlineSent=no capability=none").test(
        lines[0],
      ),
      `unexpected backend line: ${lines[0]}`,
    );
    const warnings = reports.filter((r) => r.startsWith("warn|"));
    assertEquals(
      warnings.filter((w) =>
        w.includes("does not advertise the native deadline capability")
      ).length,
      1,
      "the legacy-deadline warning must reach the reporter",
    );
  } finally {
    setTrainDirReporter(undefined);
    __resetNativeDeadlineDiagnosticsForTests();
    Deno.removeSync(dataDir, { recursive: true });
  }
});

// --- WASM: the TypeScript loop ----------------------------------------------

Deno.test("Issue #4146: the TypeScript loop reports backend=wasm deadlineSent=no capability=none", () => {
  __setRustTrainDirEnabledForTests(false);
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const records: DataRecordInterface[] = [0, 1, 2, 3].map((i) => ({
    input: new Float32Array([i & 1, (i >> 1) & 1]),
    output: new Float32Array([(i & 1) ^ ((i >> 1) & 1)]),
  }));
  const dataDir = makeDataDir(records, records.length, {
    input: creature.input,
    output: creature.output,
  });
  const reports: string[] = [];
  setTrainDirReporter((level, message) => {
    reports.push(`${level}|${message}`);
  });
  try {
    trainDir(creature, dataDir, {
      iterations: 1,
      disableRandomSamples: true,
    }, Costs.find("MSE"));
    const lines = reports.filter((r) => r.includes("[training-backend]"));
    assertEquals(lines.length, 1, "one backend line per task");
    assert(
      BACKEND_LINE("backend=wasm deadlineSent=no capability=none").test(
        lines[0],
      ),
      `unexpected backend line: ${lines[0]}`,
    );
  } finally {
    setTrainDirReporter(undefined);
    __setRustTrainDirEnabledForTests(undefined);
    Deno.removeSync(dataDir, { recursive: true });
  }
});

// --- CLI: a fake binary in a child process ----------------------------------

const LEGACY_CLI_STDERR = `error: unrecognized subcommand 'capabilities'
Usage: neat_ai_backpropagation <COMMAND>
For more information, try '--help'.
`;

/**
 * Run the CLI driver in a child process with a fake `neat_ai_backpropagation`
 * shell script, and return the child's stdout. The FFI library is pointed at an
 * invalid file so the CLI path is taken.
 */
function runCliChild(script: string): string {
  const dir = Deno.makeTempDirSync({ prefix: "backend-report-cli-" });
  try {
    const binary = join(dir, "neat_ai_backpropagation");
    const invalidLib = join(dir, "invalid-lib");
    Deno.writeTextFileSync(invalidLib, "not a library");
    Deno.writeTextFileSync(binary, `#!/bin/sh\n${script}\n`);
    Deno.chmodSync(binary, 0o755);
    const root = fromFileUrl(new URL("../../../", import.meta.url));
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        "--config",
        join(root, "deno.json"),
        "--preload",
        join(root, "test/_preload.ts"),
        join(
          root,
          "test/architecture/training/fixtures/CliBackendReportDriver.ts",
        ),
      ],
      cwd: dir,
      env: {
        NEAT_AI_BACKPROP_ENABLED: "1",
        NEAT_AI_BACKPROP_REQUIRE_FFI: "0",
        NEAT_AI_BACKPROP_LIB_PATH: invalidLib,
        NEAT_AI_BACKPROP_BINARY_PATH: binary,
      },
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    const stderr = new TextDecoder().decode(child.stderr);
    assert(child.success, stderr);
    return new TextDecoder().decode(child.stdout);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

Deno.test({
  name:
    "Issue #4146: a deadline-capable CLI train reports backend=cli deadlineSent=yes capability=1 (POSIX shell fake CLI)",
  ignore: Deno.build.os === "windows",
  fn() {
    const script = `if [ "$1" = capabilities ]; then
  cat <<'CAPABILITIES'
${CAPABILITIES}
CAPABILITIES
  exit 0
fi
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output-dir ]; then shift; output="$1"; fi
  shift
done
cat > "$output/result.json" <<'RESULT'
${COMPLETED_RESPONSE}
RESULT`;
    const lines = runCliChild(script).split("\n").filter((l) =>
      l.includes("[training-backend]")
    );
    assertEquals(lines.length, 1, "one backend line per task");
    assert(
      BACKEND_LINE("backend=cli deadlineSent=yes capability=1").test(lines[0]),
      `unexpected backend line: ${lines[0]}`,
    );
  },
});

Deno.test({
  name:
    "Issue #4146: a legacy CLI train reports backend=cli deadlineSent=no capability=none (POSIX shell fake CLI)",
  ignore: Deno.build.os === "windows",
  fn() {
    const fixtures = fromFileUrl(
      new URL(
        "../../fixtures/native-backprop/cli-train-legacy/",
        import.meta.url,
      ),
    );
    const script = `if [ "$1" = capabilities ]; then
  cat >&2 <<'EOF'
${LEGACY_CLI_STDERR}EOF
  exit 2
fi
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output-dir ]; then shift; output="$1"; fi
  shift
done
cp "${fixtures}best.json" "${fixtures}journal.jsonl" "$output/"`;
    const stdout = runCliChild(script);
    const lines = stdout.split("\n").filter((l) =>
      l.includes("[training-backend]")
    );
    assertEquals(lines.length, 1, "one backend line per task");
    assert(
      BACKEND_LINE("backend=cli deadlineSent=no capability=none").test(
        lines[0],
      ),
      `unexpected backend line: ${lines[0]}`,
    );
    assert(
      stdout.includes("warn|") &&
        stdout.includes("does not advertise the native deadline capability"),
      "the legacy-deadline warning must reach the reporter",
    );
  },
});
