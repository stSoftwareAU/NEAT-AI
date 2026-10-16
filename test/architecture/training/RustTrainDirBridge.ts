import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Creature } from "@creature";
import { Costs } from "@costs";
import type { CostInterface } from "@costs/CostInterface.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import { getLogger, setLogger } from "@utils/Logger.ts";
import {
  __closeNativeBackpropLibraryForTests,
  __setRustTrainDirEnabledForTests,
  canUseRustTrainDir,
  findRustTrainDirBinary,
  findRustTrainDirBinaryFromOptions,
  isRustTrainDirEnabled,
  parseRustTrainDirEnabledFlag,
  rustTrainDirRefusalReason,
  rustTrainDirSkipReason,
} from "@architecture/training/RustTrainDirBridge.ts";
import {
  closeNativeBackpropLibrary,
  findNativeBackpropLibrary,
  findNativeBackpropLibraryFromOptions,
  isNativeBackpropAvailable,
  nativeBackpropLibFileName,
  nativeBackpropSupportsDeadline,
} from "@architecture/training/NativeBackpropLibrary.ts";
import { prepareTraining } from "@architecture/training/TrainingSetup.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

class ConstantCost implements CostInterface {
  getName(): string {
    return "ConstantCost";
  }
  calculate(_target: Float32Array, _output: Float32Array): number {
    return 1;
  }
}

Deno.test("Rust trainDir binary: override file path wins", () => {
  const dir = Deno.makeTempDirSync();
  try {
    const override = join(dir, "neat_ai_backpropagation");
    Deno.writeTextFileSync(override, "");
    const found = findRustTrainDirBinaryFromOptions({
      overridePath: override,
      cwd: join(dir, "missing-cwd"),
      siblingPath: join(dir, "missing-sibling"),
    });
    assertEquals(found, override);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("Rust trainDir binary: missing candidates return null", () => {
  const dir = Deno.makeTempDirSync();
  try {
    const found = findRustTrainDirBinaryFromOptions({
      overridePath: join(dir, "nope"),
      cwd: dir,
      siblingPath: join(dir, "also-nope"),
    });
    assertEquals(found, null);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("Native backprop library: override file path wins", () => {
  const dir = Deno.makeTempDirSync();
  try {
    const override = join(dir, nativeBackpropLibFileName());
    Deno.writeTextFileSync(override, "");
    const found = findNativeBackpropLibraryFromOptions({
      overridePath: override,
      cwd: join(dir, "missing-cwd"),
      siblingDir: join(dir, "missing-sibling"),
      homeDir: join(dir, "missing-home"),
    });
    assertEquals(found, override);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("Native backprop library: missing candidates return null", () => {
  const dir = Deno.makeTempDirSync();
  try {
    const found = findNativeBackpropLibraryFromOptions({
      overridePath: join(dir, "nope"),
      cwd: dir,
      siblingDir: join(dir, "also-nope"),
      homeDir: join(dir, "no-home"),
    });
    assertEquals(found, null);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("Rust trainDir: custom cost stays on the TypeScript loop", () => {
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);
  const setup = prepareTraining(
    creature,
    { iterations: 1, disableRandomSamples: true },
    uuid.substring(Math.max(0, uuid.length - 8)),
  );
  assertEquals(
    canUseRustTrainDir(
      creature,
      { iterations: 1 },
      new ConstantCost(),
      setup,
      true,
    ),
    false,
  );
  assertEquals(
    rustTrainDirSkipReason(
      creature,
      { iterations: 1 },
      new ConstantCost(),
      setup,
    )?.includes("not used by WASM backprop"),
    true,
  );
  assertEquals(
    rustTrainDirRefusalReason(
      creature,
      { iterations: 1 },
      new ConstantCost(),
      setup,
    ),
    undefined,
  );
});

Deno.test("Rust trainDir flag: only explicit off disables a default-on feature", () => {
  assertEquals(parseRustTrainDirEnabledFlag(undefined), true);
  assertEquals(parseRustTrainDirEnabledFlag("0"), false);
  assertEquals(parseRustTrainDirEnabledFlag("false"), false);
  assertEquals(parseRustTrainDirEnabledFlag("NO"), false);
  assertEquals(parseRustTrainDirEnabledFlag("off"), false);
  assertEquals(parseRustTrainDirEnabledFlag("1"), true);
  assertEquals(parseRustTrainDirEnabledFlag("true"), true);
  assertEquals(parseRustTrainDirEnabledFlag("yes"), true);
  assertEquals(parseRustTrainDirEnabledFlag("on"), true);
  assertEquals(parseRustTrainDirEnabledFlag("enabled"), true);
  assertEquals(parseRustTrainDirEnabledFlag("  ON  "), true);
});

Deno.test("Rust trainDir is on by default unless NEAT_AI_BACKPROP_ENABLED=0", () => {
  const raw = Deno.env.get("NEAT_AI_BACKPROP_ENABLED");
  const expected = raw === undefined ||
    !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
  assertEquals(isRustTrainDirEnabled(), expected);
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);
  const setup = prepareTraining(
    creature,
    { iterations: 1, disableRandomSamples: true },
    uuid.substring(Math.max(0, uuid.length - 8)),
  );
  assertEquals(
    canUseRustTrainDir(
      creature,
      { iterations: 1 },
      Costs.find("MSE"),
      setup,
      false,
    ),
    false,
  );
  if (
    findNativeBackpropLibrary() !== null || findRustTrainDirBinary() !== null
  ) {
    assertEquals(
      canUseRustTrainDir(
        creature,
        { iterations: 1 },
        Costs.find("MSE"),
        setup,
        true,
      ),
      true,
    );
  }
});

Deno.test("Rust trainDir: an expired hard deadline stays on TypeScript", () => {
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);
  const options: TrainOptions = {
    iterations: 1,
    disableRandomSamples: true,
    hardDeadlineTS: 1,
  };
  const setup = prepareTraining(
    creature,
    options,
    uuid.substring(Math.max(0, uuid.length - 8)),
  );
  assertEquals(
    rustTrainDirSkipReason(creature, options, Costs.find("MSE"), setup),
    "hardDeadlineTS has already expired",
  );
  assertEquals(
    canUseRustTrainDir(creature, options, Costs.find("MSE"), setup, true),
    false,
  );
});

Deno.test("Rust trainDir: custom cost skips Rust and trains on the TypeScript loop", () => {
  const creature = new Creature(2, 1);
  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
  const dataDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
  __setRustTrainDirEnabledForTests(true);
  try {
    const result = trainDir(
      creature,
      dataDir,
      { iterations: 1, disableRandomSamples: true },
      new ConstantCost(),
    );
    assert(Number.isFinite(result.error), "error should be finite");
    assert(result.iteration >= 1);
  } finally {
    __setRustTrainDirEnabledForTests(undefined);
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("Rust trainDir: dropout skips Rust and trains on the TypeScript loop", () => {
  const creature = new Creature(2, 1);
  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
  const dataDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
  __setRustTrainDirEnabledForTests(true);
  try {
    const result = trainDir(
      creature,
      dataDir,
      { iterations: 1, disableRandomSamples: true, dropoutRate: 0.2 },
      Costs.find("MSE"),
    );
    assert(Number.isFinite(result.error), "error should be finite");
  } finally {
    __setRustTrainDirEnabledForTests(undefined);
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("Rust trainDir: recurrent skips Rust and trains on the TypeScript loop", () => {
  const creature = new Creature(2, 1, { feedbackEnabled: true });
  const uuid = CreatureUtil.makeUUID(creature);
  const setup = prepareTraining(
    creature,
    { iterations: 1, disableRandomSamples: true },
    uuid.substring(Math.max(0, uuid.length - 8)),
  );
  assertEquals(
    rustTrainDirSkipReason(
      creature,
      { iterations: 1, disableRandomSamples: true },
      Costs.find("MSE"),
      setup,
    )?.includes("recurrent"),
    true,
  );

  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
  const dataDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
  __setRustTrainDirEnabledForTests(true);
  try {
    const result = trainDir(
      creature,
      dataDir,
      { iterations: 1, disableRandomSamples: true },
      Costs.find("MSE"),
    );
    assert(Number.isFinite(result.error), "error should be finite");
  } finally {
    __setRustTrainDirEnabledForTests(undefined);
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("Rust trainDir: non-backprop options skip the Rust app", () => {
  const forward = new Creature(2, 1);
  const recurrent = new Creature(2, 1, { feedbackEnabled: true });
  const mse = Costs.find("MSE");
  const cases: Array<{
    name: string;
    creature: Creature;
    options: TrainOptions;
    cost: CostInterface;
    needle: string;
  }> = [
    {
      name: "predictive coding",
      creature: forward,
      options: { iterations: 1, predictiveCoding: { enabled: true } },
      cost: mse,
      needle: "predictive coding",
    },
    {
      name: "custom cost",
      creature: forward,
      options: { iterations: 1 },
      cost: new ConstantCost(),
      needle: "not used by WASM backprop",
    },
    {
      name: "dropout",
      creature: forward,
      options: { iterations: 1, dropoutRate: 0.2 },
      cost: mse,
      needle: "dropout",
    },
    {
      name: "Muon",
      creature: forward,
      options: { iterations: 1, gradientOrthogonalisation: "muon" },
      cost: mse,
      needle: "Muon",
    },
    {
      name: "recurrent",
      creature: recurrent,
      options: { iterations: 1 },
      cost: mse,
      needle: "recurrent",
    },
    {
      name: "feedbackLoop",
      creature: forward,
      options: {
        iterations: 1,
        feedbackLoop: true,
        disableRandomSamples: true,
      },
      cost: mse,
      needle: "feedbackLoop",
    },
  ];

  for (const c of cases) {
    const uuid = CreatureUtil.makeUUID(c.creature);
    const setup = prepareTraining(
      c.creature,
      { ...c.options, disableRandomSamples: true },
      uuid.substring(Math.max(0, uuid.length - 8)),
    );
    const reason = rustTrainDirSkipReason(
      c.creature,
      c.options,
      c.cost,
      setup,
    );
    assert(reason !== undefined, `${c.name} should skip Rust`);
    assert(
      reason.includes(c.needle),
      `${c.name} skip reason should mention ${c.needle}, got ${reason}`,
    );
    assertEquals(
      canUseRustTrainDir(c.creature, c.options, c.cost, setup, true),
      false,
      `${c.name} must not call the Rust app`,
    );
  }
});

Deno.test("Rust trainDir: trainingSampleRate with disableRandomSamples is eligible", () => {
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);
  const setup = prepareTraining(
    creature,
    { iterations: 1, disableRandomSamples: true, trainingSampleRate: 0.5 },
    uuid.substring(Math.max(0, uuid.length - 8)),
  );
  assertEquals(
    rustTrainDirSkipReason(
      creature,
      { iterations: 1, disableRandomSamples: true, trainingSampleRate: 0.5 },
      Costs.find("MSE"),
      setup,
    ),
    undefined,
  );
  if (
    findNativeBackpropLibrary() !== null || findRustTrainDirBinary() !== null
  ) {
    assertEquals(
      canUseRustTrainDir(
        creature,
        { iterations: 1, disableRandomSamples: true, trainingSampleRate: 0.5 },
        Costs.find("MSE"),
        setup,
        true,
      ),
      true,
    );
  }
});

Deno.test("Rust trainDir: random trainingSampleRate is eligible (Backpropagation#77)", () => {
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);
  const setup = prepareTraining(
    creature,
    { iterations: 1, disableRandomSamples: false, trainingSampleRate: 0.5 },
    uuid.substring(Math.max(0, uuid.length - 8)),
  );
  assertEquals(
    rustTrainDirSkipReason(
      creature,
      { iterations: 1, disableRandomSamples: false, trainingSampleRate: 0.5 },
      Costs.find("MSE"),
      setup,
    ),
    undefined,
  );
  if (
    findNativeBackpropLibrary() !== null || findRustTrainDirBinary() !== null
  ) {
    assertEquals(
      canUseRustTrainDir(
        creature,
        { iterations: 1, disableRandomSamples: false, trainingSampleRate: 0.5 },
        Costs.find("MSE"),
        setup,
        true,
      ),
      true,
    );
  }
});

Deno.test({
  name: "Rust trainDir FFI: MSE forward-only trains when library is present",
  fn: () => {
    closeNativeBackpropLibrary();
    __closeNativeBackpropLibraryForTests();
    if (!isNativeBackpropAvailable()) {
      return;
    }
    const creature = new Creature(2, 1);
    const dataSet: DataRecordInterface[] = [
      { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
    ];
    const dataDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });
    __setRustTrainDirEnabledForTests(true);
    try {
      const result = trainDir(
        creature,
        dataDir,
        { iterations: 2, targetError: 0.5, disableRandomSamples: true },
        Costs.find("MSE"),
      );
      assert(Number.isFinite(result.error), "error should be finite");
      assert(result.iteration >= 1);
    } finally {
      __setRustTrainDirEnabledForTests(undefined);
      closeNativeBackpropLibrary();
      Deno.removeSync(dataDir, { recursive: true });
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Rust trainDir FFI: per-task deadline stops the native trainer early",
  fn: () => {
    closeNativeBackpropLibrary();
    __closeNativeBackpropLibraryForTests();
    if (!isNativeBackpropAvailable() || !nativeBackpropSupportsDeadline()) {
      return;
    }
    const creature = new Creature(2, 1);
    const dataSet: DataRecordInterface[] = [
      { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
    ];
    const dataDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });
    __setRustTrainDirEnabledForTests(true);
    const previousLogger = getLogger();
    const logs: string[] = [];
    const capture = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    setLogger({ debug: capture, info: capture, warn: capture, error: capture });
    try {
      // The deadline is already passed, so the native loop stops before
      // epoch 1 and reports max(1, completed) iterations.
      const result = trainDir(
        creature,
        dataDir,
        {
          iterations: 50,
          disableRandomSamples: true,
          trainingTimeOutMinutes: 1e-9,
        },
        Costs.find("MSE"),
      );
      assert(
        result.iteration < 50,
        `deadline should stop training early, got ${result.iteration}`,
      );
      assert(
        logs.some((line) => line.includes("timed out after")),
        `expected a "timed out after" info line, got ${JSON.stringify(logs)}`,
      );
    } finally {
      setLogger(previousLogger);
      __setRustTrainDirEnabledForTests(undefined);
      closeNativeBackpropLibrary();
      Deno.removeSync(dataDir, { recursive: true });
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

/**
 * Stub for the `neat_ai_backpropagation` CLI failure contract (Issue #4073).
 *
 * Contract source: `backpropagation/src/main.rs` in
 * stSoftwareAU/NEAT-AI-Backpropagation, branch
 * `issue-neat-ai-4073-train-deadline` (commit 7ec31cc). There `train --help`
 * lists `--deadline-epoch-ms <DEADLINE_EPOCH_MS>`, and a deadline stop appends
 * `{"kind":"timedOut","completedEpochs":N,"deadlineEpochMs":D}` to
 * journal.jsonl.
 *
 * `train --help` lists `--deadline-epoch-ms` only when `supportsDeadline`.
 * Failures mirror the real CLI: a missing `<CREATURE>` or `<DATA>` positional
 * and a missing `--output-dir` exit 2 with a clap-style message, as does an
 * unexpected argument. An unreadable creature file or a data path that is not
 * a directory exits 1. With a deadline already passed the stub writes one
 * epoch and a `timedOut` line; otherwise it writes epochs 1..N for `--epochs N`.
 */
function cliStubScript(supportsDeadline: boolean): string {
  const usage = [
    "Usage: neat_ai_backpropagation train <CREATURE> <DATA> [OPTIONS]",
    "  --epochs <N>",
    "  --output-dir <DIR>",
  ];
  if (supportsDeadline) {
    usage.push(
      "  --deadline-epoch-ms <MS>  Absolute deadline (ms since epoch)",
    );
  }
  const helpLines = usage.map((line) => `  echo '${line}'`).join("\n");
  const deadlineCase = supportsDeadline
    ? `    --deadline-epoch-ms) value_of "$1" "$#"; deadline="$2"; shift 2 ;;\n`
    : "";
  return `#!/usr/bin/env bash
set -euo pipefail
value_of() {
  if [ "$2" -lt 2 ]; then
    echo "error: a value is required for '$1' but none was supplied" >&2
    exit 2
  fi
}
if [ "\${1:-}" = "train" ] && [ "\${2:-}" = "--help" ]; then
${helpLines}
  exit 0
fi
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
outdir=""
deadline=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --epochs) value_of "$1" "$#"; epochs="$2"; shift 2 ;;
    --output-dir) value_of "$1" "$#"; outdir="$2"; shift 2 ;;
${deadlineCase}    --learning-rate | --learning-rate-strategy | --learning-rate-decay | --maximum-bias-adjustment-scale | --maximum-weight-adjustment-scale | --step-scale | --seed | --max-records | --trace-store) value_of "$1" "$#"; shift 2 ;;
    --normalise-gradients | --disable-random-samples) shift ;;
    *) echo "error: unexpected argument '$1' found" >&2; exit 2 ;;
  esac
done
if [ -z "$outdir" ]; then
  echo "error: the following required arguments were not provided:" >&2
  echo "  --output-dir <DIR>" >&2
  exit 2
fi
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
if [ -n "$deadline" ] && [ "$deadline" -le "$now_ms" ]; then
  echo '{"kind":"epoch","epoch":1,"beforeMse":0.5,"afterMse":0.4,"accepted":true}' > "$journal"
  echo '{"kind":"timedOut","completedEpochs":1,"deadlineEpochMs":'"$deadline"'}' >> "$journal"
else
  : > "$journal"
  i=1
  while [ "$i" -le "$epochs" ]; do
    echo '{"kind":"epoch","epoch":'"$i"',"beforeMse":0.5,"afterMse":0.4,"accepted":true}' >> "$journal"
    i=$((i + 1))
  done
fi
`;
}

interface CliTrainProbe {
  iteration: number;
  usedCli: boolean;
  timedOutLogged: boolean;
  deadlineWarned: boolean;
}

/**
 * Run one `trainDir` in a child process: env is cleared (tests must not mutate
 * it), HOME is the temp dir, and the FFI library path is an empty file so the
 * CLI fallback is the only backend.
 */
async function runCliTrainChild(
  home: string,
  binary: string,
  emptyLib: string,
  iterations: number,
  trainingTimeOutMinutes: number | undefined,
): Promise<CliTrainProbe> {
  const options = JSON.stringify({
    iterations,
    disableRandomSamples: true,
    ...(trainingTimeOutMinutes === undefined ? {} : { trainingTimeOutMinutes }),
  });
  const code = `import { Creature } from "./src/Creature.ts";
import { Costs } from "./src/Costs.ts";
import { trainDir } from "./src/architecture/Training.ts";
import { makeDataDir } from "./src/architecture/DataSet.ts";
import { setLogger } from "./src/utils/Logger.ts";

const logs: string[] = [];
const capture = (...args: unknown[]) => {
  logs.push(args.map(String).join(" "));
};
setLogger({ debug: capture, info: capture, warn: capture, error: capture });

const creature = new Creature(2, 1);
const dataSet = [
  { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
  { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
];
const dataDir = makeDataDir(dataSet, dataSet.length, {
  input: creature.input,
  output: creature.output,
});
const result = trainDir(creature, dataDir, ${options}, Costs.find("MSE"));
console.log(JSON.stringify({
  iteration: result.iteration,
  usedCli: logs.some((l) => l.includes("trainDir using CLI")),
  timedOutLogged: logs.some((l) => l.includes("timed out after")),
  deadlineWarned: logs.some((l) => l.includes("--deadline-epoch-ms")),
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
  return JSON.parse(out.split("\n").at(-1)!) as CliTrainProbe;
}

async function cliTrainProbe(
  supportsDeadline: boolean,
  iterations: number,
  trainingTimeOutMinutes?: number,
): Promise<CliTrainProbe> {
  const dir = await Deno.makeTempDir({ prefix: "neat-ai-cli-deadline-" });
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
      iterations,
      trainingTimeOutMinutes,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test({
  name:
    "Rust trainDir CLI: per-task deadline is forwarded and stops training early",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const probe = await cliTrainProbe(true, 50, 1e-9);
    assertEquals(probe.usedCli, true);
    assertEquals(probe.iteration, 1);
    assertEquals(probe.timedOutLogged, true);
    assertEquals(probe.deadlineWarned, false);
  },
});

Deno.test({
  name: "Rust trainDir CLI: no deadline runs every iteration",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const probe = await cliTrainProbe(true, 50);
    assertEquals(probe.usedCli, true);
    assertEquals(probe.iteration, 50);
    assertEquals(probe.timedOutLogged, false);
    assertEquals(probe.deadlineWarned, false);
  },
});

Deno.test({
  name:
    "Rust trainDir CLI: binary without --deadline-epoch-ms trains and warns",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const probe = await cliTrainProbe(false, 50, 1e-9);
    assertEquals(probe.usedCli, true);
    assertEquals(probe.iteration, 50);
    assertEquals(probe.timedOutLogged, false);
    assertEquals(probe.deadlineWarned, true);
  },
});

Deno.test("Rust trainDir: MSE forward-only still trains when Rust is unused", () => {
  const creature = new Creature(2, 1);
  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
  const dataDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
  __setRustTrainDirEnabledForTests(false);
  try {
    const result = trainDir(
      creature,
      dataDir,
      { iterations: 2, targetError: 0.5, disableRandomSamples: true },
      Costs.find("MSE"),
    );
    assert(Number.isFinite(result.error), "error should be finite");
    assert(result.iteration >= 1);
  } finally {
    __setRustTrainDirEnabledForTests(undefined);
    Deno.removeSync(dataDir, { recursive: true });
  }
});
