/**
 * Deadline behaviour through real native engines (Issue #4119).
 *
 * Each case runs `scripts/native_deadline_probe.ts` in a child process, so the
 * adapter, the library and the environment are fixed before anything loads.
 * The child drives the real `trainDir` (and a real `WorkerHandler` for the
 * worker case) against a deadline-capable engine (NEW) or a legacy one (LEGACY).
 * The probe does all the clock reads and prints one JSON line; this file reads
 * no clock and no timing API (#2888 policy). The outer bound is a `timeout`
 * process guard around the child, not a measurement.
 *
 * Engines come from `NEAT_AI_BACKPROP_DEADLINE_NEW` (default: the library
 * `findNativeBackpropLibrary()` resolves, when it is deadline-capable) and
 * `NEAT_AI_BACKPROP_DEADLINE_LEGACY`. Each directory holds
 * `libneat_ai_backpropagation` and `neat_ai_backpropagation`. A missing NEW
 * engine fails the case when `NEAT_AI_BACKPROP_REQUIRE_FFI=1` and is otherwise
 * reported as ignored; a missing LEGACY engine is always ignored.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  findNativeBackpropLibrary,
  nativeBackpropLibFileName,
  parseNativeBackpropCapabilities,
} from "@architecture/training/NativeBackpropLibrary.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const DRIVER = join(REPO_ROOT, "scripts", "native_deadline_probe.ts");
const CONFIG = join(REPO_ROOT, "deno.json");

/** Hang guard around one probe child. Not a measurement. */
const HANG_GUARD_SECONDS = 120;
/** A run must settle this far past its deadline, or it has ignored the deadline. */
const SETTLE_BOUND_MS = 30_000;

type EngineKind = "new" | "legacy";

interface Engine {
  lib: string;
  binary: string;
}

type Capability = "deadline" | "no-deadline" | "unknown";

/** The JSON line `scripts/native_deadline_probe.ts` prints. */
interface ProbeResult {
  scenario: string;
  adapter: "ffi" | "cli" | "none";
  adapterLog: string | null;
  adapterSource?: string;
  deadlineEpochMs: number | null;
  timedOut: boolean | null;
  bestMeasure: string | null;
  error: number | null;
  errorIsNaN: boolean;
  iteration: number | null;
  weightsChanged: boolean;
  weightsValid: boolean;
  settledAfterDeadlineMs: number | null;
  warnings: string[];
  infos: string[];
  timedOutOnWire?: boolean;
  healthy?: boolean;
  cancelled?: boolean;
  failure?: string | null;
}

const LEGACY_WARNING = "does not advertise the native deadline capability";

function readEnv(name: string): string | undefined {
  try {
    const value = Deno.env.get(name)?.trim();
    return value === undefined || value === "" ? undefined : value;
  } catch {
    return undefined;
  }
}

function requireFfi(): boolean {
  return readEnv("NEAT_AI_BACKPROP_REQUIRE_FFI") === "1";
}

function nativeBinaryName(): string {
  return Deno.build.os === "windows"
    ? "neat_ai_backpropagation.exe"
    : "neat_ai_backpropagation";
}

function fileExists(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

/** What the CLI at `binary` advertises, probed through its `capabilities` subcommand. */
function capabilityOf(binary: string): Capability {
  try {
    const out = new Deno.Command(binary, {
      args: ["capabilities"],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    if (out.success) {
      const parsed = parseNativeBackpropCapabilities(
        new TextDecoder().decode(out.stdout),
      );
      return parsed.deadline === undefined ? "no-deadline" : "deadline";
    }
    // A legacy CLI has no `capabilities` subcommand and exits with clap's error.
    return new TextDecoder().decode(out.stderr).includes(
        "unrecognized subcommand",
      )
      ? "no-deadline"
      : "unknown";
  } catch {
    return "unknown";
  }
}

/** Resolve one engine, or say what is missing. Runs once at load, to register cases. */
function locateEngine(
  kind: EngineKind,
): { engine: Engine } | { missing: string } {
  const envName = kind === "new"
    ? "NEAT_AI_BACKPROP_DEADLINE_NEW"
    : "NEAT_AI_BACKPROP_DEADLINE_LEGACY";
  const wanted = kind === "new"
    ? "a deadline-capable libneat_ai_backpropagation"
    : "a legacy libneat_ai_backpropagation (no deadline capability)";

  let dir = readEnv(envName);
  if (dir === undefined && kind === "new") {
    const resolved = findNativeBackpropLibrary();
    if (resolved !== null) dir = dirname(resolved);
  }
  if (dir === undefined) {
    return { missing: `${wanted}; set ${envName} to its directory` };
  }

  const lib = join(dir, nativeBackpropLibFileName());
  const binary = join(dir, nativeBinaryName());
  if (!fileExists(lib) || !fileExists(binary)) {
    return {
      missing:
        `${wanted}; ${dir} must hold ${nativeBackpropLibFileName()} and ${nativeBinaryName()}`,
    };
  }
  const capability = capabilityOf(binary);
  const expected: Capability = kind === "new" ? "deadline" : "no-deadline";
  if (capability !== expected) {
    return {
      missing:
        `${wanted}; ${binary} reports capability "${capability}", expected "${expected}"`,
    };
  }
  return { engine: { lib, binary } };
}

const warnedKinds = new Set<EngineKind>();

/**
 * Register a case that needs an engine. An absent NEW engine fails the case
 * under `NEAT_AI_BACKPROP_REQUIRE_FFI=1` and is otherwise ignored; an absent
 * LEGACY engine is always ignored. Either way the name says what is required.
 */
function nativeTest(
  kind: EngineKind,
  name: string,
  body: (engine: Engine) => Promise<void>,
): void {
  const located = locateEngine(kind);
  if ("engine" in located) {
    const engine = located.engine;
    Deno.test(name, () => body(engine));
    return;
  }
  const what = kind === "new" ? "NEW engine" : "LEGACY engine";
  const label = `[REQUIRES native engine: ${what}] ${name}`;
  if (kind === "new" && requireFfi()) {
    Deno.test(label, () => {
      throw new Error(
        `native deadline prerequisite missing (${what}): ${located.missing}`,
      );
    });
    return;
  }
  if (!warnedKinds.has(kind)) {
    warnedKinds.add(kind);
    const envName = kind === "new"
      ? "NEAT_AI_BACKPROP_DEADLINE_NEW"
      : "NEAT_AI_BACKPROP_DEADLINE_LEGACY";
    console.warn(
      `[NativeDeadlineIntegration] ${what} not found: ${located.missing}. ` +
        `These cases are reported as ignored (${envName} unset or wrong).`,
    );
  }
  Deno.test({ name: label, ignore: true, fn: () => {} });
}

/** The cache directory the parent would use, so the child need not fetch modules. */
function denoCacheEnv(): Record<string, string> {
  const explicit = readEnv("DENO_DIR");
  if (explicit !== undefined) return { DENO_DIR: explicit };
  const xdg = readEnv("XDG_CACHE_HOME");
  if (xdg !== undefined) return { DENO_DIR: join(xdg, "deno") };
  const home = readEnv("HOME");
  return home === undefined ? {} : { DENO_DIR: join(home, ".cache", "deno") };
}

/** One probe run: the scenario, the adapter it forces, and the engine it runs against. */
interface ProbeCase {
  scenario: string;
  adapter: "ffi" | "cli";
  engine: Engine;
}

/**
 * Run one probe child with a cleared environment and an empty HOME, and parse
 * its JSON line. FFI cases refuse the CLI (`REQUIRE_FFI=1`). CLI cases point the
 * library override at a directory that does not exist, so the bridge spawns the
 * engine's binary.
 */
async function runProbe(probe: ProbeCase): Promise<ProbeResult> {
  const sandbox = Deno.makeTempDirSync({ prefix: "native-deadline-probe-" });
  try {
    const home = join(sandbox, "home");
    const workDir = join(sandbox, "cwd");
    Deno.mkdirSync(home);
    Deno.mkdirSync(workDir);

    const forced: Record<string, string> = probe.adapter === "ffi"
      ? {
        NEAT_AI_BACKPROP_LIB_PATH: probe.engine.lib,
        NEAT_AI_BACKPROP_REQUIRE_FFI: "1",
      }
      : {
        NEAT_AI_BACKPROP_LIB_PATH: join(sandbox, "no-such-lib-dir"),
        NEAT_AI_BACKPROP_BINARY_PATH: probe.engine.binary,
      };
    const env: Record<string, string> = {
      PATH: readEnv("PATH") ?? "",
      HOME: home,
      ...denoCacheEnv(),
      NEAT_AI_BACKPROP_ENABLED: "1",
      ...forced,
    };

    const guard = Deno.build.os === "darwin" ? "gtimeout" : "timeout";
    const out = await new Deno.Command(guard, {
      args: [
        "--kill-after=5",
        String(HANG_GUARD_SECONDS),
        Deno.execPath(),
        "run",
        "-A",
        "--config",
        CONFIG,
        DRIVER,
        probe.scenario,
      ],
      cwd: workDir,
      env,
      clearEnv: true,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();

    const stdout = new TextDecoder().decode(out.stdout);
    const stderr = new TextDecoder().decode(out.stderr).trim();
    if (!out.success) {
      const cause = out.code === 124
        ? `exceeded the ${HANG_GUARD_SECONDS} s hang guard`
        : `exit ${out.code}`;
      throw new Error(`${probe.scenario}: ${cause}; stderr: ${stderr}`);
    }
    const lastLine = stdout.trimEnd().split("\n").at(-1) ?? "";
    return JSON.parse(lastLine) as ProbeResult;
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
}

function settledWithinBound(result: ProbeResult): boolean {
  const settled = result.settledAfterDeadlineMs;
  return typeof settled === "number" && settled < SETTLE_BOUND_MS;
}

function legacyWarningsIn(result: ProbeResult): string[] {
  return result.warnings.filter((message) => message.includes(LEGACY_WARNING));
}

// --- (1) and (2) a productive run stops at the deadline, keeping its learning ---

nativeTest(
  "new",
  "native deadline: FFI productive run stops at the deadline and keeps its learning",
  async (engine) => {
    const result = await runProbe({
      scenario: "ffi-productive",
      adapter: "ffi",
      engine,
    });
    assertEquals(result.adapter, "ffi");
    assertStringIncludes(result.adapterLog ?? "", "using FFI");
    assertEquals(result.timedOut, true);
    assertEquals(result.weightsChanged, true);
    assertEquals(result.weightsValid, true);
    assert(
      settledWithinBound(result),
      `settled ${result.settledAfterDeadlineMs} ms after the deadline; bound is ${SETTLE_BOUND_MS} ms`,
    );
    assert(
      result.bestMeasure === "partial" || result.bestMeasure === "full",
      `bestMeasure must be partial or full for a run that learned, got ${result.bestMeasure}`,
    );
    if (result.error !== null) {
      assertEquals(
        result.bestMeasure,
        "full",
        "a finite error may come only from a full measure",
      );
    }
    assertEquals(legacyWarningsIn(result).length, 0);
  },
);

nativeTest(
  "new",
  "native deadline: CLI productive run stops at the deadline and keeps its learning",
  async (engine) => {
    const result = await runProbe({
      scenario: "cli-productive",
      adapter: "cli",
      engine,
    });
    assertEquals(result.adapter, "cli");
    assertStringIncludes(result.adapterLog ?? "", "using CLI");
    assertEquals(result.timedOut, true);
    assertEquals(result.weightsChanged, true);
    assertEquals(result.weightsValid, true);
    assert(
      settledWithinBound(result),
      `settled ${result.settledAfterDeadlineMs} ms after the deadline; bound is ${SETTLE_BOUND_MS} ms`,
    );
    assert(
      result.bestMeasure === "partial" || result.bestMeasure === "full",
      `bestMeasure must be partial or full for a run that learned, got ${result.bestMeasure}`,
    );
    if (result.error !== null) {
      assertEquals(
        result.bestMeasure,
        "full",
        "a finite error may come only from a full measure",
      );
    }
    assertEquals(legacyWarningsIn(result).length, 0);
  },
);

// --- (3) a run that is out of time before any useful work -------------------

nativeTest(
  "new",
  "native deadline: FFI run already out of time stops unmeasured with the weights unchanged",
  async (engine) => {
    const result = await runProbe({
      scenario: "ffi-expired",
      adapter: "ffi",
      engine,
    });
    assertEquals(result.adapter, "ffi");
    assertEquals(result.timedOut, true);
    assertEquals(result.bestMeasure, "unmeasured");
    assertEquals(result.error, null, "no measure, so no error");
    assertEquals(result.errorIsNaN, true);
    assertEquals(result.weightsChanged, false);
    assertEquals(result.weightsValid, true);
  },
);

nativeTest(
  "new",
  "native deadline: CLI run already out of time stops unmeasured with the weights unchanged",
  async (engine) => {
    const result = await runProbe({
      scenario: "cli-expired",
      adapter: "cli",
      engine,
    });
    assertEquals(result.adapter, "cli");
    assertEquals(result.timedOut, true);
    assertEquals(result.bestMeasure, "unmeasured");
    assertEquals(result.error, null, "no measure, so no error");
    assertEquals(result.errorIsNaN, true);
    assertEquals(result.weightsChanged, false);
    assertEquals(result.weightsValid, true);
  },
);

// --- (4) a legacy engine is warned about, never stopped natively ------------

nativeTest(
  "legacy",
  "native deadline: a legacy FFI engine is warned and not stopped natively",
  async (engine) => {
    const result = await runProbe({
      scenario: "legacy-ffi",
      adapter: "ffi",
      engine,
    });
    assertEquals(result.adapter, "ffi");
    assertEquals(result.timedOut, null, "a legacy engine reports no timeout");
    assertEquals(result.errorIsNaN, false);
    assert(result.error !== null, "a legacy run returns a finite error");
    const warnings = legacyWarningsIn(result);
    assertEquals(warnings.length, 1);
    assertStringIncludes(warnings[0], "NOT enforced natively");
    assert(
      !result.infos.some((message) =>
        message.includes("stopped by the native deadline")
      ),
      "a legacy engine must not be reported as stopped by the native deadline",
    );
  },
);

nativeTest(
  "legacy",
  "native deadline: a legacy CLI engine is warned and not stopped natively",
  async (engine) => {
    const result = await runProbe({
      scenario: "legacy-cli",
      adapter: "cli",
      engine,
    });
    assertEquals(result.adapter, "cli");
    assertEquals(result.timedOut, null, "a legacy engine reports no timeout");
    assertEquals(result.errorIsNaN, false);
    assert(result.error !== null, "a legacy run returns a finite error");
    const warnings = legacyWarningsIn(result);
    assertEquals(warnings.length, 1);
    assertStringIncludes(warnings[0], "NOT enforced natively");
    assert(
      !result.infos.some((message) =>
        message.includes("stopped by the native deadline")
      ),
      "a legacy engine must not be reported as stopped by the native deadline",
    );
  },
);

// --- (5) the same run through a real worker boundary ------------------------

nativeTest(
  "new",
  "native deadline: a productive run through a real worker settles at the deadline on a healthy worker",
  async (engine) => {
    const result = await runProbe({
      scenario: "worker-productive",
      adapter: "ffi",
      engine,
    });
    assertEquals(result.adapter, "ffi");
    assertEquals(result.failure, null, "the worker must answer, not reject");
    assertEquals(result.cancelled, false);
    assertEquals(result.healthy, true, "the worker must stay in service");
    assert(
      settledWithinBound(result),
      `settled ${result.settledAfterDeadlineMs} ms after the deadline; bound is ${SETTLE_BOUND_MS} ms`,
    );
    assertEquals(result.weightsChanged, true);
    assertEquals(result.weightsValid, true);
  },
);
