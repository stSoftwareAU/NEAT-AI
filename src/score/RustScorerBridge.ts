import { join, resolve } from "@std/path";
import type { Creature } from "@creature";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import type { BuiltInCostName } from "@costs";
import { getLogger } from "@utils/Logger.ts";
import {
  __getBatchRunner,
  __resetInternal,
  __setRunnerInternal,
  buildChildEnv,
  type CommandRunner,
  resolveProbeState,
} from "./RustScorerBridgeInternal.ts";

interface RustScorerResult {
  error: number;
}

let envRustScorerCache: RequiredRustScorerConfig | undefined;

/**
 * In-process (per-isolate) scorer-config override for tests.
 *
 * Tests must NOT drive the enabled/batch flags through process-global
 * `Deno.env`: under `deno test --parallel` every test file runs in its own
 * worker thread but they all share the one OS process environment, so one
 * file's `Deno.env.set`/`delete` races with another's mid-test and
 * intermittently flips the batch path off (Issue #3234 flake). This override
 * lives in module state, which IS isolated per worker, so tests can force a
 * config without touching the shared environment.
 */
let testConfigOverride: Partial<RequiredRustScorerConfig> | undefined;

/** Maximum characters of stdout/stderr preserved in a warning log line. */
const LOG_TRIM_LIMIT = 2000;

function readEnvString(key: string): string | undefined {
  try {
    const v = Deno.env.get(key);
    if (v === undefined || v.trim() === "") return undefined;
    return v;
  } catch {
    return undefined;
  }
}

function parseBoolLike(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const n = value.trim().toLowerCase();
    if (n === "1" || n === "true" || n === "yes") return true;
    if (n === "0" || n === "false" || n === "no") return false;
  }
  return undefined;
}

function parseEnvTimeoutMs(): number {
  const raw = readEnvString("NEAT_AI_RUST_SCORER_TIMEOUT_MS");
  if (raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Trim untrusted child-process output for safe inclusion in a log line.
 * Collapses whitespace and caps total length so large diagnostics do not
 * overwhelm the log.
 */
function trimForLog(value: string, limit: number = LOG_TRIM_LIMIT): string {
  if (!value) return "";
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return collapsed.slice(0, limit) + "…";
}

/**
 * Lazily resolved scorer config from environment (NEAT_AI_RUST_SCORER_*).
 * Cached for the lifetime of the process unless reset by tests.
 *
 * Issue #2422: Exposed so that `Fitness.calculate` can drive batch scoring
 * from the same env-derived config as the per-creature call site.
 */
export function getEnvRustScorerConfig(): RequiredRustScorerConfig {
  if (envRustScorerCache !== undefined) return envRustScorerCache;

  const enabled = parseBoolLike(readEnvString("NEAT_AI_RUST_SCORER_ENABLED")) ??
    false;

  const binaryPath = readEnvString("NEAT_AI_RUST_SCORER_BINARY_PATH") ??
    "rust_scorer";

  const timeoutMs = parseEnvTimeoutMs();

  const env: Record<string, string> = {};
  const envJson = readEnvString("NEAT_AI_RUST_SCORER_ENV");
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") env[k] = v;
      }
    } catch {
      // Ignore malformed JSON from the environment.
    }
  }

  // Issue #2422: Directory/batch mode is preferred when the external scorer
  // is enabled. Operators can opt out with NEAT_AI_RUST_SCORER_BATCH=false to
  // fall back to per-creature invocations.
  const batch = parseBoolLike(readEnvString("NEAT_AI_RUST_SCORER_BATCH")) ??
    true;

  const base: RequiredRustScorerConfig = {
    enabled,
    binaryPath,
    timeoutMs,
    env,
    batch,
  };
  // Apply any in-process test override on top of the env-derived config.
  envRustScorerCache = testConfigOverride === undefined
    ? base
    : { ...base, ...testConfigOverride };
  return envRustScorerCache;
}

function getTmpDiagnostics(): string {
  let context: string;
  try {
    // deno-lint-ignore no-explicit-any
    context = typeof (globalThis as any).WorkerGlobalScope !== "undefined" &&
        // deno-lint-ignore no-explicit-any
        globalThis instanceof (globalThis as any).WorkerGlobalScope
      ? "worker"
      : "main";
  } catch {
    context = "unknown";
  }
  const env = {
    TMPDIR: readEnvString("TMPDIR") ?? "<unset>",
    TMP: readEnvString("TMP") ?? "<unset>",
    TEMP: readEnvString("TEMP") ?? "<unset>",
  };
  return `context=${context}, TMPDIR=${env.TMPDIR}, TMP=${env.TMP}, TEMP=${env.TEMP}`;
}

async function getWritePermissionDiagnostics(path?: string): Promise<string> {
  if (!path) return "writePerm=<no-path>";
  try {
    const status = await Deno.permissions.query({ name: "write", path });
    return `writePerm(${path})=${status.state}`;
  } catch (error) {
    return `writePerm(${path})=<error:${
      error instanceof Error ? error.message : String(error)
    }>`;
  }
}

async function writeCreatureTempFile(
  creature: Creature,
  tmpDir?: string,
): Promise<string> {
  const baseDir = tmpDir ?? ".";
  const fileName = `neat-rust-scorer-${crypto.randomUUID()}.json`;
  const tmpPath = join(baseDir, fileName);
  try {
    // Ensure explicit scorer temp dirs are created in worker contexts.
    await Deno.mkdir(baseDir, { recursive: true });
    await Deno.writeTextFile(tmpPath, JSON.stringify(creature.exportJSON()));
    // Return an absolute path so callers can hand it to subprocesses that may
    // run with a different cwd (e.g. worker pools).
    return resolve(Deno.cwd(), tmpPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const perm = await getWritePermissionDiagnostics(baseDir);
    throw new Error(
      `failed to create/write rust scorer temp creature file: ${detail}; ${getTmpDiagnostics()}; ${perm}`,
    );
  }
}

export async function tryScoreWithRustScorer(
  creature: Creature,
  dataDir: string,
  override?: RequiredRustScorerConfig,
  costName?: BuiltInCostName,
): Promise<RustScorerResult | undefined> {
  const config = override ?? getEnvRustScorerConfig();
  if (!config.enabled) return undefined;

  const probe = await resolveProbeState(config);
  if (!probe.available) return undefined;

  // Issue #2745: When a non-MSE cost is configured but the probed binary is
  // too old to advertise `--cost`, fall back to WASM rather than silently
  // letting the Rust side compute MSE. MSE is the binary's historical
  // default so it stays compatible without `--cost`.
  if (
    costName !== undefined && !probe.costSupported && costName !== "MSE"
  ) {
    if (!probe.warned) {
      getLogger().warn(
        `[NEAT-AI] Rust scorer at ${config.binaryPath} does not advertise --cost; ` +
          `falling back to WASM scoring for cost=${costName}.`,
      );
      probe.warned = true;
    }
    return undefined;
  }

  let creaturePath: string | undefined;
  try {
    const tmpDir = readEnvString("NEAT_AI_RUST_SCORER_TMP_DIR") ?? dataDir;
    creaturePath = await writeCreatureTempFile(creature, tmpDir);
    // rust_scorer resolves relative paths against its own process cwd, which
    // may not match the Deno/worker cwd. Always hand it absolute paths.
    const absoluteDataDir = resolve(Deno.cwd(), dataDir);
    // Issue #2745: Prepend `--cost <NAME>` when the configured cost is
    // a built-in and the binary supports the flag. This stops the Rust
    // path from silently computing MSE while the TS layer trains against
    // a different cost.
    const args = costName !== undefined && probe.costSupported
      ? ["--cost", costName, creaturePath, absoluteDataDir]
      : [creaturePath, absoluteDataDir];
    const result = await __getBatchRunner()(
      config.binaryPath,
      args,
      {
        env: buildChildEnv(config.env),
        timeoutMs: config.timeoutMs,
      },
    );

    if (!result.success) {
      if (!probe.warned) {
        const stderrSnippet = trimForLog(result.stderr);
        const suffix = stderrSnippet.length > 0
          ? `; stderr: ${stderrSnippet}`
          : "";
        getLogger().warn(
          `[NEAT-AI] Rust scorer call failed (exit ${result.code})${suffix}; falling back to WASM scoring.`,
        );
        probe.warned = true;
      }
      return undefined;
    }

    let parsed: { error?: unknown };
    try {
      parsed = JSON.parse(result.stdout) as { error?: unknown };
    } catch (parseError) {
      if (!probe.warned) {
        const stdoutSnippet = trimForLog(result.stdout);
        const stderrSnippet = trimForLog(result.stderr);
        const detail = parseError instanceof Error
          ? parseError.message
          : String(parseError);
        const parts = [
          `parse error: ${detail}`,
          stdoutSnippet.length > 0 ? `stdout: ${stdoutSnippet}` : "",
          stderrSnippet.length > 0 ? `stderr: ${stderrSnippet}` : "",
        ].filter((p) => p.length > 0);
        getLogger().warn(
          `[NEAT-AI] Rust scorer returned invalid (non-JSON) output; ${
            parts.join("; ")
          }; falling back to WASM scoring.`,
        );
        probe.warned = true;
      }
      return undefined;
    }

    const error = Number(parsed.error);
    if (!Number.isFinite(error)) {
      if (!probe.warned) {
        const stderrSnippet = trimForLog(result.stderr);
        const suffix = stderrSnippet.length > 0
          ? `; stderr: ${stderrSnippet}`
          : "";
        getLogger().warn(
          `[NEAT-AI] Rust scorer returned invalid error${suffix}; falling back to WASM scoring.`,
        );
        probe.warned = true;
      }
      return undefined;
    }
    return { error };
  } catch (error) {
    if (!probe.warned) {
      getLogger().warn(
        `[NEAT-AI] Rust scorer unavailable (${
          error instanceof Error ? error.message : String(error)
        }); falling back to WASM scoring.`,
      );
      probe.warned = true;
    }
    return undefined;
  } finally {
    if (creaturePath) {
      try {
        await Deno.remove(creaturePath);
      } catch {
        // Ignore temp cleanup errors.
      }
    }
  }
}

export function __resetRustScorerBridgeForTests(): void {
  __resetInternal();
  envRustScorerCache = undefined;
  testConfigOverride = undefined;
}

export function __setRustScorerRunnerForTests(runner: CommandRunner): void {
  __setRunnerInternal(runner);
}

/**
 * Force scorer config in-process for tests (Issue #3234).
 *
 * Prefer this over `Deno.env.set("NEAT_AI_RUST_SCORER_*")`: it mutates only
 * this isolate's module state, so parallel test files can each force their own
 * enabled/batch config without racing on the shared process environment.
 * Cleared by `__resetRustScorerBridgeForTests`.
 */
export function __setRustScorerConfigForTests(
  partial: Partial<RequiredRustScorerConfig>,
): void {
  testConfigOverride = { ...testConfigOverride, ...partial };
  // Drop the cache so the next read recomputes with the override applied.
  envRustScorerCache = undefined;
}
