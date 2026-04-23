import { join, resolve } from "@std/path";
import type { Creature } from "@creature";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import { getLogger } from "@utils/Logger.ts";

interface RustScorerResult {
  error: number;
}

interface RustScorerProbeState {
  available: boolean;
  binaryPath: string;
  warned: boolean;
}

type CommandRunner = (
  command: string,
  args: string[],
  options: {
    /**
     * Environment variables to pass to the child process. When `undefined`,
     * the child inherits the parent process environment. When provided, the
     * mapping is passed verbatim to `Deno.Command` (callers are responsible
     * for merging parent env if they want inheritance plus overrides).
     */
    env?: Record<string, string>;
    timeoutMs: number;
  },
) => Promise<{
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}>;

const probeCache = new Map<string, RustScorerProbeState>();

let envRustScorerCache: RequiredRustScorerConfig | undefined;

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
 */
function getEnvRustScorerConfig(): RequiredRustScorerConfig {
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

  envRustScorerCache = { enabled, binaryPath, timeoutMs, env };
  return envRustScorerCache;
}

/**
 * Build the env argument for a child process call.
 *
 * Returns `undefined` when no overrides are configured so the child inherits
 * the parent environment verbatim (avoids the `env: {}` foot-gun where the
 * child gets an empty environment). When overrides exist, merges them over
 * the parent env snapshot.
 */
function buildChildEnv(
  overrides: Record<string, string>,
): Record<string, string> | undefined {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return undefined;
  let parent: Record<string, string> = {};
  try {
    parent = Deno.env.toObject();
  } catch {
    // Fall through with an empty parent snapshot; overrides still applied.
  }
  return { ...parent, ...overrides };
}

async function defaultRunner(
  command: string,
  args: string[],
  options: {
    env?: Record<string, string>;
    timeoutMs: number;
  },
): Promise<{
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}> {
  // Omit `env` from Deno.Command when the caller did not provide overrides so
  // the child inherits the full parent environment (PATH, HOME, locale, etc.).
  const cmdOptions: Deno.CommandOptions = options.env !== undefined
    ? { args, env: options.env, stdout: "piped", stderr: "piped" }
    : { args, stdout: "piped", stderr: "piped" };
  const cmd = new Deno.Command(command, cmdOptions);

  const output = options.timeoutMs > 0
    ? await Promise.race([
      cmd.output(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("rust scorer timeout")),
          options.timeoutMs,
        );
      }),
    ])
    : await cmd.output();

  return {
    success: output.success,
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

let runCommand: CommandRunner = defaultRunner;

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

function makeProbeKey(config: RequiredRustScorerConfig): string {
  const envKeys = Object.keys(config.env).sort();
  const envPairs = envKeys.map((k) => `${k}=${config.env[k]}`);
  return `${config.binaryPath}|${config.timeoutMs}|${envPairs.join(",")}`;
}

async function resolveProbeState(
  config: RequiredRustScorerConfig,
): Promise<RustScorerProbeState> {
  const key = makeProbeKey(config);
  const cached = probeCache.get(key);
  if (cached) return cached;

  let available = false;
  try {
    const probe = await runCommand(config.binaryPath, ["--help"], {
      env: buildChildEnv(config.env),
      timeoutMs: config.timeoutMs,
    });
    available = probe.success || probe.code === 0 || probe.code === 1;
  } catch {
    available = false;
  }

  const state = {
    available,
    binaryPath: config.binaryPath,
    warned: false,
  };
  probeCache.set(key, state);
  return state;
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
): Promise<RustScorerResult | undefined> {
  const config = override ?? getEnvRustScorerConfig();
  if (!config.enabled) return undefined;

  const probe = await resolveProbeState(config);
  if (!probe.available) return undefined;

  let creaturePath: string | undefined;
  try {
    const tmpDir = readEnvString("NEAT_AI_RUST_SCORER_TMP_DIR") ?? dataDir;
    creaturePath = await writeCreatureTempFile(creature, tmpDir);
    // rust_scorer resolves relative paths against its own process cwd, which
    // may not match the Deno/worker cwd. Always hand it absolute paths.
    const absoluteDataDir = resolve(Deno.cwd(), dataDir);
    const result = await runCommand(
      config.binaryPath,
      [creaturePath, absoluteDataDir],
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
  probeCache.clear();
  envRustScorerCache = undefined;
  runCommand = defaultRunner;
}

export function __setRustScorerRunnerForTests(runner: CommandRunner): void {
  runCommand = runner;
}
