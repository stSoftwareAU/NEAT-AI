/**
 * @module
 *
 * Bridge to the optional external `rust_scorer` binary — an out-of-process
 * scorer that can evaluate a creature (or a directory of creatures) faster than
 * the WASM path for large datasets.
 *
 * The boundary is a subprocess, not FFI: the creature is written to a temporary
 * JSON file and the binary is invoked with absolute paths, because it resolves
 * relative paths against its own cwd. {@link tryScoreWithRustScorer} returns
 * `undefined` — meaning "caller should score with WASM" — whenever the scorer
 * is disabled, absent, or too old to honour the configured cost function
 * (Issue #2745); a genuinely corrupt dataset still throws rather than being
 * downgraded to a silent fallback.
 *
 * Issue #3815: an exec or parse failure throws a {@link ScorerStrictError}
 * carrying the scorer's stderr verbatim instead of logging a warning and
 * falling back. Issue #3864 made that strict behaviour the default;
 * `NEAT_AI_RUST_SCORER_STRICT=0` opts back out to the degrading path. A missing
 * or too-old binary remains a graceful skip in either mode.
 *
 * Issue #3866: when strict is off and the degrading path is taken, the
 * fallback is recorded in the {@link module:NativeScoringFallbackLedger} so the
 * run-level verdict on `EvolveResult.scorerUtilisation` reports it. A graceful
 * skip records nothing — "not installed" is not "degraded".
 *
 * Configuration comes from `NeatOptions.rustScorer` layered over the
 * `NEAT_AI_RUST_SCORER_*` environment variables — see
 * {@link resolveRustScorerConfig} for the precedence rule. Only the env layer
 * ({@link getEnvRustScorerConfig}) is cached for the process. The `__`-prefixed
 * exports are test seams: under `deno test --parallel` every test file shares
 * one OS environment, so tests must override module state rather than
 * `Deno.env` (Issue #3234).
 */
import { join, resolve } from "@std/path";
import type { Creature } from "@creature";
import type {
  RequiredRustScorerConfig,
  RustScorerConfig,
} from "@config/RustScorerConfig.ts";
import { parseNumber } from "@config/ParseOptions.ts";
import type { BuiltInCostName } from "@costs";
import { DatasetError } from "@errors/DatasetError.ts";
import {
  ScorerStrictError,
  toScorerStrictError,
} from "@errors/ScorerStrictError.ts";
import { getLogger } from "@utils/Logger.ts";
import { assertNotCorruptDataset } from "./ScorerFailureClassification.ts";
import {
  recordNativeScoringFallback,
  resetNativeScoringFallback,
} from "./NativeScoringFallbackLedger.ts";
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

  // Issue #3864: Strict mode is on by default — a scorer exec/parse failure
  // throws instead of degrading to WASM, so a dead native scoring path cannot
  // reconcile to a green run (Issue #3810). `NEAT_AI_RUST_SCORER_STRICT=0` is
  // the escape hatch for an operator who prefers a degraded run to a failed
  // one. A missing or too-old binary is a graceful skip in either mode.
  const strict = parseBoolLike(readEnvString("NEAT_AI_RUST_SCORER_STRICT")) ??
    true;

  const base: RequiredRustScorerConfig = {
    enabled,
    binaryPath,
    timeoutMs,
    env,
    batch,
    strict,
  };
  // Apply any in-process test override on top of the env-derived config.
  envRustScorerCache = testConfigOverride === undefined
    ? base
    : { ...base, ...testConfigOverride };
  return envRustScorerCache;
}

/**
 * Resolve the scorer configuration for one run (Issue #3865).
 *
 * **Precedence: an explicit option beats the environment, and the environment
 * beats the built-in default.** A field supplied on `NeatOptions.rustScorer`
 * wins outright; a field left out falls through to `NEAT_AI_RUST_SCORER_*`, and
 * then to the default baked into {@link getEnvRustScorerConfig}. The direction
 * that matters is the first one — an explicit `enabled: false` must survive
 * `NEAT_AI_RUST_SCORER_ENABLED=1`, because failing open turns the native path
 * on for an embedder who asked for it off and every resulting score still looks
 * plausible.
 *
 * Only the **env layer** is memoised (`envRustScorerCache`, process-lifetime).
 * The merged result belongs to one run and is deliberately never written back
 * into that cache, so a per-run option cannot leak into another run.
 *
 * `env` is replaced wholesale rather than merged key by key: the supplied map
 * is the complete set of extra variables the caller wants the scorer child
 * process to see.
 *
 * @param overrides - Caller-supplied partial config; `undefined` yields the
 *   env-derived config unchanged.
 */
export function resolveRustScorerConfig(
  overrides?: RustScorerConfig,
): RequiredRustScorerConfig {
  const base = getEnvRustScorerConfig();
  if (overrides === undefined) return base;

  return {
    enabled: overrides.enabled ?? base.enabled,
    binaryPath: overrides.binaryPath ?? base.binaryPath,
    timeoutMs: parseNumber(
      "Rust scorer timeoutMs",
      overrides.timeoutMs,
      base.timeoutMs,
      { integer: true, min: 0 },
    ),
    env: overrides.env ?? base.env,
    batch: overrides.batch ?? base.batch,
    strict: overrides.strict ?? base.strict,
  };
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
      // Issue #3541: a rejected *dataset* is not retryable on another backend.
      // Fail loud with the scorer's own diagnostic instead of demoting it to a
      // warning and letting the WASM re-read die on a bare assertion.
      assertNotCorruptDataset(result.stderr, result.code, dataDir);
      // Issue #3815: strict mode makes a dead native path fatal rather than
      // letting the WASM fallback reconcile the run to green.
      if (config.strict) {
        throw new ScorerStrictError(
          `Rust scorer call failed (exit ${result.code}) for data dir ${dataDir}`,
          "EXEC_FAILURE",
          { exitCode: result.code, stderr: result.stderr },
        );
      }
      // Issue #3866: the scorer was present and failed — a real degradation,
      // not a graceful skip. Record it so the run-level verdict can see it.
      recordNativeScoringFallback();
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
      if (config.strict) {
        const detail = parseError instanceof Error
          ? parseError.message
          : String(parseError);
        throw new ScorerStrictError(
          `Rust scorer returned invalid (non-JSON) output (parse error: ${detail}); stdout: ${
            trimForLog(result.stdout)
          }`,
          "INVALID_OUTPUT",
          { exitCode: result.code, stderr: result.stderr, cause: parseError },
        );
      }
      // Issue #3866: unparseable output from a live scorer is a degradation.
      recordNativeScoringFallback();
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
      if (config.strict) {
        throw new ScorerStrictError(
          `Rust scorer returned a non-finite error value: ${
            JSON.stringify(parsed.error)
          }`,
          "INVALID_OUTPUT",
          { exitCode: result.code, stderr: result.stderr },
        );
      }
      // Issue #3866: a live scorer that answered with garbage is a degradation.
      recordNativeScoringFallback();
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
    // Issue #3541: a data fault must not be absorbed into "scorer unavailable"
    // — no backend can read a corrupt dataset, so it propagates.
    if (error instanceof DatasetError) throw error;
    // Issue #3815: strict-mode failures propagate with their verbatim stderr.
    if (error instanceof ScorerStrictError) throw error;
    if (config.strict) {
      throw toScorerStrictError(
        error,
        "Rust scorer invocation failed",
        "EXEC_FAILURE",
      );
    }
    // Issue #3866: the probe said the binary was there, so an invocation that
    // blew up mid-flight degraded a working native path — record the fallback.
    recordNativeScoringFallback();
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
  // Issue #3866: a fallback recorded by a previous test must not leak into the
  // next one's run-level verdict.
  resetNativeScoringFallback();
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
