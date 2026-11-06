/**
 * Deadline forwarding and timed-out results through the native `trainDir`
 * adapter (Issue #4119).
 *
 * `trainDir` runs for real. The native trainer is a double installed through
 * `__installNativeBackpropLibraryForTests`, returning committed captures from
 * the real engines (test/fixtures/native-backprop/README.md). Every deadline is
 * a fixed epoch constant, and no test reads a clock or a timing API (#2888).
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { Creature } from "@creature";
import { Costs } from "@costs";
import { addTag } from "@stsoftware/tags/mod";
import type { TrainOptions } from "@config/TrainOptions.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import {
  __resetNativeDeadlineDiagnosticsForTests,
  __setRustTrainDirEnabledForTests,
  cliDeadlineCapable,
} from "@architecture/training/RustTrainDirBridge.ts";
import {
  __installNativeBackpropLibraryForTests,
  closeNativeBackpropLibrary,
  type NativeBackpropHandle,
} from "@architecture/training/NativeBackpropLibrary.ts";
import { prepareTraining } from "@architecture/training/TrainingSetup.ts";
import type { TrainingResult } from "@architecture/training/TrainingTypes.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

const FIXTURE_DIR = new URL("../../fixtures/native-backprop/", import.meta.url);

function readFixture(name: string): string {
  return Deno.readTextFileSync(new URL(name, FIXTURE_DIR));
}

const CAPABILITIES = readFixture("capabilities-new.json");
const LEGACY_RESPONSE = readFixture("ffi-response-legacy.json");
const COMPLETED_RESPONSE = readFixture("ffi-response-new-completed.json");
const EXPIRED_RESPONSE = readFixture("ffi-response-new-timed-out-expired.json");

/** The input creature the captures were produced from (`bestCreatureJson` of the expired run). */
const INPUT_CREATURE_JSON = (JSON.parse(EXPIRED_RESPONSE) as {
  bestCreatureJson: string;
}).bestCreatureJson;

/** A fixed far-future instant (2100-01-01T00:00:00Z). No clock is read. */
const HARD_DEADLINE_TS = 4_102_444_800_000;

/** Shallow-override fields of a JSON fixture and re-serialise it. */
function withChanges(fixture: string, change: Record<string, unknown>): string {
  return JSON.stringify({ ...JSON.parse(fixture), ...change });
}

/** Run `fn` and return the error it throws; fails the test if it does not throw. */
function captureError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("expected the function to throw");
}

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
 * A `NativeBackpropHandle` double that records each decoded request and
 * answers every train call with `payload`. `capabilities` omitted means a
 * legacy library: the `neat_backprop_capabilities` symbol is null.
 */
function makeDouble(options: {
  capabilities?: string;
  payload: string;
  received: Record<string, unknown>[];
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
        request: Uint8Array,
        _len: bigint,
        out: Uint8Array,
      ) => {
        options.received.push(
          JSON.parse(new TextDecoder().decode(request)) as Record<
            string,
            unknown
          >,
        );
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

/** Collect every `warn` message emitted while `body` runs; restores the logger. */
function captureWarnings<T>(
  body: () => T,
): { result: T; warnings: string[] } {
  const previous = getLogger();
  const warnings: string[] = [];
  const recorder: Logger = {
    debug() {},
    info() {},
    warn(...args: unknown[]) {
      warnings.push(args.map((arg) => String(arg)).join(" "));
    },
    error() {},
  };
  setLogger(recorder);
  try {
    return { result: body(), warnings };
  } finally {
    setLogger(previous);
  }
}

/** The trained creature: the fixture's input (input 1, output 1, identity chain). */
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

function trainWith(
  creature: Creature,
  dataDir: string,
  extra: Partial<TrainOptions> = {},
): TrainingResult {
  return trainDir(
    creature,
    dataDir,
    {
      iterations: 1,
      disableRandomSamples: true,
      hardDeadlineTS: HARD_DEADLINE_TS,
      ...extra,
    },
    Costs.find("MSE"),
  );
}

/** Biases and synapse weights, the parts a training run can change. */
function weightsOf(creature: Creature): string {
  const json = creature.exportJSON();
  return JSON.stringify({
    biases: json.neurons.map((n) => [n.uuid, n.bias]),
    weights: json.synapses.map((s) => [s.fromUUID, s.toUUID, s.weight]),
  });
}

// --- (a) a deadline-capable library receives the one absolute deadline -----

Deno.test("Rust trainDir deadline: a capable library receives the hard deadline unchanged", () => {
  const received: Record<string, unknown>[] = [];
  const creature = fixtureCreature();
  const dataDir = makeSingleDataDir(creature);
  try {
    const expected = JSON.parse(COMPLETED_RESPONSE) as { bestMse: number };
    const results = withNativeLibrary(
      makeDouble({
        capabilities: CAPABILITIES,
        payload: COMPLETED_RESPONSE,
        received,
      }),
      () => [
        trainWith(creature, dataDir),
        // A relative budget far beyond 2100 leaves the absolute deadline the earlier limit.
        trainWith(creature, dataDir, {
          trainingTimeOutMinutes: 1_000_000_000,
        }),
      ],
    );

    assertEquals(received.length, 2);
    for (const request of received) {
      assertEquals(request.deadlineEpochMs, HARD_DEADLINE_TS);
    }
    for (const result of results) {
      assertEquals(result.timedOut, false);
      assertEquals(result.bestMeasure, "full");
      assertEquals(result.error, expected.bestMse);
    }
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

for (const hardDeadline of [true, false]) {
  Deno.test(`Rust trainDir deadline: a relative budget is forwarded ${hardDeadline ? "with" : "without"} a hard deadline`, () => {
    const received: Record<string, unknown>[] = [];
    const creature = fixtureCreature();
    const dataDir = makeSingleDataDir(creature);
    try {
      withNativeLibrary(
        makeDouble({
          capabilities: CAPABILITIES,
          payload: COMPLETED_RESPONSE,
          received,
        }),
        () =>
          trainWith(creature, dataDir, {
            trainingTimeOutMinutes: 1,
            hardDeadlineTS: hardDeadline ? HARD_DEADLINE_TS : undefined,
          }),
      );
      assertEquals(received.length, 1);
      for (const request of received) {
        const deadline = request.deadlineEpochMs;
        assert(typeof deadline === "number" && Number.isSafeInteger(deadline));
        assert(deadline > 0 && deadline < HARD_DEADLINE_TS);
      }
    } finally {
      Deno.removeSync(dataDir, { recursive: true });
    }
  });
}

// --- (b) a timed-out run returns on the normal result path -------------------

Deno.test("Rust trainDir deadline: a timed-out run without a pre-training error tag yields NaN", () => {
  const creature = fixtureCreature();
  const before = weightsOf(creature);
  const dataDir = makeSingleDataDir(creature);
  try {
    const result = withNativeLibrary(
      makeDouble({
        capabilities: CAPABILITIES,
        payload: EXPIRED_RESPONSE,
        received: [],
      }),
      () => trainWith(creature, dataDir),
    );

    assertEquals(result.timedOut, true);
    assertEquals(result.bestMeasure, "unmeasured");
    assert(result.iteration >= 1);
    assert(
      Number.isNaN(result.error),
      "error must be NaN, got " + result.error,
    );
    assertEquals(weightsOf(creature), before);
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("Rust trainDir deadline: a timed-out run carries the pre-training error tag", () => {
  const creature = fixtureCreature();
  addTag(creature, "error", "0.37");
  const dataDir = makeSingleDataDir(creature);
  try {
    const result = withNativeLibrary(
      makeDouble({
        capabilities: CAPABILITIES,
        payload: EXPIRED_RESPONSE,
        received: [],
      }),
      () => trainWith(creature, dataDir),
    );

    assertEquals(result.timedOut, true);
    assertEquals(result.bestMeasure, "unmeasured");
    assertEquals(result.error, 0.37);
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("Rust trainDir deadline: a timed-out run carries the untrained-error tag the worker sends", () => {
  const creature = fixtureCreature();
  addTag(creature, "untrained-error", "0.25");
  const dataDir = makeSingleDataDir(creature);
  try {
    const result = withNativeLibrary(
      makeDouble({
        capabilities: CAPABILITIES,
        payload: EXPIRED_RESPONSE,
        received: [],
      }),
      () => trainWith(creature, dataDir),
    );

    assertEquals(result.timedOut, true);
    assertEquals(result.bestMeasure, "unmeasured");
    assertEquals(result.error, 0.25);
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("Rust trainDir deadline: the error tag wins over the untrained-error tag", () => {
  const creature = fixtureCreature();
  addTag(creature, "error", "0.5");
  addTag(creature, "untrained-error", "0.25");
  const dataDir = makeSingleDataDir(creature);
  try {
    const result = withNativeLibrary(
      makeDouble({
        capabilities: CAPABILITIES,
        payload: EXPIRED_RESPONSE,
        received: [],
      }),
      () => trainWith(creature, dataDir),
    );

    assertEquals(result.timedOut, true);
    assertEquals(result.bestMeasure, "unmeasured");
    assertEquals(result.error, 0.5);
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test('Rust trainDir deadline: the literal "undefined" untrained-error tag yields NaN', () => {
  const creature = fixtureCreature();
  // What the worker dispatch sends when the creature had no `error` tag.
  addTag(creature, "untrained-error", "undefined");
  const dataDir = makeSingleDataDir(creature);
  try {
    const result = withNativeLibrary(
      makeDouble({
        capabilities: CAPABILITIES,
        payload: EXPIRED_RESPONSE,
        received: [],
      }),
      () => trainWith(creature, dataDir),
    );

    assertEquals(result.timedOut, true);
    assertEquals(result.bestMeasure, "unmeasured");
    assert(
      Number.isNaN(result.error),
      "error must be NaN, got " + result.error,
    );
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

// --- (c) the error comes only from a full measure ----------------------------

Deno.test("Rust trainDir deadline: a partial measure never supplies the error", () => {
  const partialPayload = withChanges(EXPIRED_RESPONSE, {
    timedOut: true,
    timeout: {
      phase: "baselineEvaluation",
      completedEpochs: 0,
      weightsChanged: false,
      deadlineEpochMs: HARD_DEADLINE_TS,
    },
    baselineMeasure: { kind: "partial", mse: 123.456, records: 40 },
    bestMeasure: { kind: "partial", mse: 123.456, records: 40 },
  });
  const plain = fixtureCreature();
  const withTag = fixtureCreature();
  addTag(withTag, "error", "0.5");
  const dataDirs = [makeSingleDataDir(plain), makeSingleDataDir(withTag)];
  try {
    const results = withNativeLibrary(
      makeDouble({
        capabilities: CAPABILITIES,
        payload: partialPayload,
        received: [],
      }),
      () => [
        trainWith(plain, dataDirs[0]),
        trainWith(withTag, dataDirs[1]),
      ],
    );

    assertEquals(results[0].timedOut, true);
    assertEquals(results[0].bestMeasure, "partial");
    assert(Number.isNaN(results[0].error), "no tag: error must be NaN");
    assertEquals(results[1].bestMeasure, "partial");
    assertEquals(results[1].error, 0.5);
    assert(results[1].error !== 123.456, "the partial mse must never be used");
  } finally {
    for (const dir of dataDirs) Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("Rust trainDir deadline: a full measure on a timed-out run is the error", () => {
  const fullPayload = withChanges(EXPIRED_RESPONSE, {
    timedOut: true,
    timeout: {
      phase: "candidateEvaluation",
      completedEpochs: 1,
      weightsChanged: true,
      deadlineEpochMs: HARD_DEADLINE_TS,
    },
    completedEpochs: 1,
    baselineMeasure: { kind: "full", mse: 0.6, records: 100 },
    baselineMse: 0.6,
    bestMeasure: { kind: "full", mse: 0.42, records: 100 },
    bestMse: 0.42,
  });
  const creature = fixtureCreature();
  // A pre-training tag must not override a full measure.
  addTag(creature, "error", "0.9");
  const dataDir = makeSingleDataDir(creature);
  try {
    const result = withNativeLibrary(
      makeDouble({
        capabilities: CAPABILITIES,
        payload: fullPayload,
        received: [],
      }),
      () => trainWith(creature, dataDir),
    );

    assertEquals(result.timedOut, true);
    assertEquals(result.bestMeasure, "full");
    assertEquals(result.error, 0.42);
    assertEquals(result.iteration, 1);
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

// --- (d) a capable library with a legacy-shaped response is refused ----------

Deno.test("Rust trainDir deadline: a capable library's legacy-shaped response is refused", () => {
  const creature = fixtureCreature();
  const dataDir = makeSingleDataDir(creature);
  try {
    const error = captureError(() =>
      withNativeLibrary(
        makeDouble({
          capabilities: CAPABILITIES,
          payload: LEGACY_RESPONSE,
          received: [],
        }),
        () => trainWith(creature, dataDir),
      )
    );
    // The first missing deadline field is named; nothing fell back to WASM.
    assertStringIncludes(error.message, '"timedOut"');
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

// --- (e) a legacy library is never sent the deadline, and is warned once ---

Deno.test("Rust trainDir deadline: a legacy library never receives the deadline and is warned once", () => {
  __resetNativeDeadlineDiagnosticsForTests();
  const received: Record<string, unknown>[] = [];
  const creature = fixtureCreature();
  const dataDir = makeSingleDataDir(creature);
  try {
    const { result: results, warnings } = captureWarnings(() =>
      withNativeLibrary(
        makeDouble({ payload: LEGACY_RESPONSE, received }),
        () => [trainWith(creature, dataDir), trainWith(creature, dataDir)],
      )
    );

    assertEquals(received.length, 2);
    for (const request of received) {
      assertEquals(
        "deadlineEpochMs" in request,
        false,
        "a legacy library must not receive deadlineEpochMs",
      );
    }
    for (const result of results) {
      assertEquals("timedOut" in result, false);
      assertEquals("bestMeasure" in result, false);
      assertEquals(
        result.error,
        (JSON.parse(LEGACY_RESPONSE) as { bestMse: number }).bestMse,
      );
    }

    const deadlineWarnings = warnings.filter((message) =>
      message.includes("does not advertise the native deadline capability")
    );
    assertEquals(deadlineWarnings.length, 1);
    assertStringIncludes(
      deadlineWarnings[0],
      "libneat_ai_backpropagation at ",
    );
    assertStringIncludes(
      deadlineWarnings[0],
      "the per-task deadline is NOT enforced natively",
    );
    assertStringIncludes(
      deadlineWarnings[0],
      "stuck-task watchdog (deadline + 30 s) is the only stop",
    );
    assertStringIncludes(
      deadlineWarnings[0],
      "upgrade NEAT-AI-Backpropagation (issue #214)",
    );
  } finally {
    __resetNativeDeadlineDiagnosticsForTests();
    Deno.removeSync(dataDir, { recursive: true });
  }
});

// --- (e) the CLI capability probe, against tiny fake CLIs ------------------

/**
 * The stderr and exit code of `neat_ai_backpropagation capabilities` from a
 * legacy CLI, copied verbatim. Observed from NEAT-AI-Backpropagation f444bc4
 * / v0.1.49: clap rejects the unknown subcommand with exit 2.
 */
const LEGACY_CLI_STDERR = `error: unrecognized subcommand 'capabilities'

Usage: neat_ai_backpropagation <COMMAND>

For more information, try '--help'.
`;

const POSIX_ONLY = { ignore: Deno.build.os === "windows" };
const POSIX_SUFFIX = " (POSIX shell fake CLI; skipped on Windows)";

/** Writes an executable `#!/bin/sh` fake CLI, runs `fn` with its path, then removes it. */
function withFakeCli(script: string, fn: (binary: string) => void): void {
  const dir = Deno.makeTempDirSync({ prefix: "fake-cli-" });
  try {
    const binary = join(dir, "neat_ai_backpropagation");
    Deno.writeTextFileSync(binary, `#!/bin/sh\n${script}\n`);
    Deno.chmodSync(binary, 0o755);
    fn(binary);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

Deno.test(
  "Rust trainDir deadline: a legacy CLI without the capabilities subcommand is not deadline-capable" +
    POSIX_SUFFIX,
  POSIX_ONLY,
  () => {
    const script = `cat >&2 <<'EOF'
${LEGACY_CLI_STDERR}EOF
exit 2`;
    withFakeCli(script, (binary) => {
      assertEquals(cliDeadlineCapable(binary), false);
    });
  },
);

Deno.test(
  "Rust trainDir deadline: a CLI printing the new capability JSON is deadline-capable" +
    POSIX_SUFFIX,
  POSIX_ONLY,
  () => {
    const script = `cat <<'EOF'
${CAPABILITIES}
EOF
exit 0`;
    withFakeCli(script, (binary) => {
      assertEquals(cliDeadlineCapable(binary), true);
    });
  },
);

Deno.test(
  "Rust trainDir deadline: a failing capabilities probe throws and quotes its cause" +
    POSIX_SUFFIX,
  POSIX_ONLY,
  () => {
    withFakeCli(`echo "error: boom: disk full" >&2\nexit 1`, (binary) => {
      assertThrows(
        () => cliDeadlineCapable(binary),
        Error,
        "boom: disk full",
      );
    });
  },
);

Deno.test(
  "Rust trainDir deadline: a zero-exit capabilities probe with non-JSON output throws, not legacy" +
    POSIX_SUFFIX,
  POSIX_ONLY,
  () => {
    withFakeCli(`echo "this is not json"\nexit 0`, (binary) => {
      assertThrows(
        () => cliDeadlineCapable(binary),
        Error,
        "not valid JSON",
      );
    });
  },
);

// A child isolates backend selection from any library installed on the host.
for (const hardDeadline of [true, false]) {
  Deno.test({
    name: `Rust trainDir deadline: CLI forwards a relative budget ${
      hardDeadline ? "with" : "without"
    } a hard deadline${POSIX_SUFFIX}`,
    ...POSIX_ONLY,
    fn() {
      const dir = Deno.makeTempDirSync({ prefix: "deadline-cli-" });
      try {
        const binary = join(dir, "neat_ai_backpropagation");
        const argv = join(dir, "argv");
        const invalidLib = join(dir, "invalid-lib");
        Deno.writeTextFileSync(invalidLib, "not a library");
        Deno.writeTextFileSync(
          binary,
          `#!/bin/sh
if [ "$1" = capabilities ]; then
  cat <<'CAPABILITIES'
${CAPABILITIES}
CAPABILITIES
  exit 0
fi
printf '%s\n' "$@" > "$FAKE_ARGV"
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output-dir ]; then shift; output="$1"; fi
  shift
done
cat > "$output/result.json" <<'RESULT'
${EXPIRED_RESPONSE}
RESULT
`,
        );
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
              "test/architecture/training/fixtures/CliDeadlineDriver.ts",
            ),
            hardDeadline ? String(HARD_DEADLINE_TS) : "none",
          ],
          cwd: dir,
          env: {
            NEAT_AI_BACKPROP_ENABLED: "1",
            NEAT_AI_BACKPROP_REQUIRE_FFI: "0",
            NEAT_AI_BACKPROP_LIB_PATH: invalidLib,
            NEAT_AI_BACKPROP_BINARY_PATH: binary,
            FAKE_ARGV: argv,
          },
          stdout: "piped",
          stderr: "piped",
        }).outputSync();
        assert(child.success, new TextDecoder().decode(child.stderr));
        const args = Deno.readTextFileSync(argv).trimEnd().split("\n");
        const index = args.indexOf("--deadline-epoch-ms");
        assert(index >= 0, "CLI must receive --deadline-epoch-ms");
        const value = Number(args[index + 1]);
        assert(
          Number.isSafeInteger(value) && value > 0 && value < HARD_DEADLINE_TS,
        );
      } finally {
        Deno.removeSync(dir, { recursive: true });
      }
    },
  });
}

// The legacy CLI `train` contract: the argument list and output directory a
// real legacy `neat_ai_backpropagation train` (f444bc4 / v0.1.49) was given and
// wrote, replayed by a fake CLI. See test/fixtures/native-backprop/README.md.
Deno.test(
  "Rust trainDir deadline: a legacy CLI train run gets no deadline flag, runs as before and is warned" +
    POSIX_SUFFIX,
  POSIX_ONLY,
  () => {
    const fixtures = fromFileUrl(
      new URL(
        "../../fixtures/native-backprop/cli-train-legacy/",
        import.meta.url,
      ),
    );
    const dir = Deno.makeTempDirSync({ prefix: "legacy-cli-train-" });
    try {
      const binary = join(dir, "neat_ai_backpropagation");
      const argv = join(dir, "argv");
      const invalidLib = join(dir, "invalid-lib");
      Deno.writeTextFileSync(invalidLib, "not a library");
      Deno.writeTextFileSync(
        binary,
        `#!/bin/sh
if [ "$1" = capabilities ]; then
  cat >&2 <<'EOF'
${LEGACY_CLI_STDERR}EOF
  exit 2
fi
printf '%s\n' "$@" > "$FAKE_ARGV"
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output-dir ]; then shift; output="$1"; fi
  shift
done
cp "${fixtures}best.json" "${fixtures}journal.jsonl" "$output/"
`,
      );
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
            "test/architecture/training/fixtures/CliLegacyTrainDriver.ts",
          ),
        ],
        cwd: dir,
        env: {
          NEAT_AI_BACKPROP_ENABLED: "1",
          NEAT_AI_BACKPROP_REQUIRE_FFI: "0",
          NEAT_AI_BACKPROP_LIB_PATH: invalidLib,
          NEAT_AI_BACKPROP_BINARY_PATH: binary,
          FAKE_ARGV: argv,
        },
        stdout: "piped",
        stderr: "piped",
      }).outputSync();
      assert(child.success, new TextDecoder().decode(child.stderr));
      const lines = new TextDecoder().decode(child.stdout).trim().split("\n");
      const observed = JSON.parse(lines[lines.length - 1]) as {
        error: number | null;
        iteration: number;
        timedOut: boolean | null;
        bestMeasure: string | null;
        weightsChanged: boolean;
        warnings: string[];
      };

      // Prior execution behaviour: the arguments are the captured real ones,
      // with the per-run paths replaced, and nothing more.
      const sent = Deno.readTextFileSync(argv).trimEnd().split("\n");
      assert(
        !sent.includes("--deadline-epoch-ms"),
        "a legacy CLI must not receive --deadline-epoch-ms",
      );
      const flagsOf = (args: string[]) =>
        args.filter((arg) => arg.startsWith("--") || arg === "train");
      const captured = Deno.readTextFileSync(`${fixtures}argv.txt`).trimEnd()
        .split("\n");
      assertEquals(flagsOf(sent), flagsOf(captured));

      // The result comes from the journal and best.json, as before.
      assertEquals(observed.timedOut, null);
      assertEquals(observed.bestMeasure, null);
      assertEquals(observed.iteration, 3);
      assertEquals(observed.error, 0.3834493141684288);
      assertEquals(observed.weightsChanged, true);

      const warnings = observed.warnings.filter((message) =>
        message.includes("does not advertise the native deadline capability")
      );
      assertEquals(warnings.length, 1);
      assertStringIncludes(warnings[0], "NOT enforced natively");
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
);

// --- (f) prepareTraining computes the one timeout ---------------------------

Deno.test("prepareTraining: timeoutTS is the hard deadline when it is the earlier limit", () => {
  const creature = new Creature(1, 1);
  const setup = prepareTraining(
    creature,
    { iterations: 1, trainingTimeOutMinutes: 5, hardDeadlineTS: 1 },
    "deadln01",
  );
  assertEquals(setup.timeoutTS, 1);
});

Deno.test("prepareTraining: timeoutTS is 0 when there is no budget and no deadline", () => {
  const creature = new Creature(1, 1);
  const setup = prepareTraining(creature, { iterations: 1 }, "deadln02");
  assertEquals(setup.timeoutTS, 0);
});

Deno.test("prepareTraining: timeoutTS is the hard deadline when there is no relative budget", () => {
  const creature = new Creature(1, 1);
  const setup = prepareTraining(
    creature,
    { iterations: 1, hardDeadlineTS: HARD_DEADLINE_TS },
    "deadln03",
  );
  assertEquals(setup.timeoutTS, HARD_DEADLINE_TS);
});

Deno.test("prepareTraining: a far relative budget leaves the hard deadline as timeoutTS", () => {
  const creature = new Creature(1, 1);
  const setup = prepareTraining(
    creature,
    {
      iterations: 1,
      trainingTimeOutMinutes: 1_000_000_000,
      hardDeadlineTS: HARD_DEADLINE_TS,
    },
    "deadln04",
  );
  assertEquals(setup.timeoutTS, HARD_DEADLINE_TS);
});

Deno.test("prepareTraining: a relative budget earlier than the hard deadline sets timeoutTS", () => {
  const setup = prepareTraining(
    new Creature(1, 1),
    {
      iterations: 1,
      trainingTimeOutMinutes: 5,
      hardDeadlineTS: HARD_DEADLINE_TS,
    },
    "deadln05",
  );
  assert(Number.isSafeInteger(setup.timeoutTS));
  assert(setup.timeoutTS > 0 && setup.timeoutTS < HARD_DEADLINE_TS);
});
