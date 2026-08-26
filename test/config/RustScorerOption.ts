/**
 * `NeatOptions.rustScorer` precedence (Issue #3865).
 *
 * The Rust scorer used to be reachable only through `NEAT_AI_RUST_SCORER_*`.
 * Now it is an option, and the rule the resolver must hold is:
 * **an explicit option beats the environment, and the environment beats the
 * built-in default.**
 *
 * The dangerous direction is the first one. If the environment could override
 * an explicit `rustScorer: { enabled: false }`, the native path would switch on
 * for an embedder who asked for it off — and every score it produced would
 * still look plausible. Both directions are therefore asserted independently,
 * plus the no-op case: with no `rustScorer` key the resolved config must equal
 * `getEnvRustScorerConfig()` exactly.
 *
 * The resolver reads the real process environment, and `deno test --parallel`
 * shares one environment across every test file, so each case is resolved in a
 * child process whose environment starts cleared (Issue #3234). That also makes
 * the "unset" case genuinely unset whatever the parent lane exported —
 * `quality.sh` exports `NEAT_AI_RUST_SCORER_ENABLED` on the native lane.
 */
import { assert, assertEquals } from "@std/assert";

/** Everything one child process resolves, in a single round trip. */
interface ResolvedCases {
  /** No env, no option — the built-in default. */
  defaultEnabled: boolean;
  /** No option at all returns the very object `getEnvRustScorerConfig()` does. */
  absentIsEnvConfig: boolean;
  /** No env, explicit `enabled: true` — option over default. */
  optionOverDefault: boolean;
  /** `NEAT_AI_RUST_SCORER_ENABLED=1`, no option — env over default. */
  envOverDefault: boolean;
  /** `NEAT_AI_RUST_SCORER_ENABLED=1` plus explicit `enabled: false`. */
  optionOverEnv: boolean;
  /** Same, through `createNeatConfig`. */
  configOptionOverEnv: boolean;
  /** `createNeatConfig` with no option, env on. */
  configEnvOverDefault: boolean;
  /** `createNeatConfig` with no option resolves to the env config verbatim. */
  configAbsentMatchesEnv: boolean;
  /** A partial option leaves untouched fields on their env values. */
  partialKeepsEnvBinaryPath: string;
  /** The process-level env cache must not absorb a per-run option. */
  envCacheStillEnabled: boolean;
  /** A string `timeoutMs` (CLI shape) is coerced, not carried through. */
  coercedTimeoutMs: number;
}

/**
 * Resolve every case in one child process with a cleared environment.
 *
 * Mutating `Deno.env` is safe there precisely because the process is
 * disposable and single-threaded.
 */
async function resolveCases(): Promise<ResolvedCases> {
  const code = `import {
  __resetRustScorerBridgeForTests,
  getEnvRustScorerConfig,
  resolveRustScorerConfig,
} from "./src/score/RustScorerBridge.ts";
import { createNeatConfig } from "./mod.ts";

const ENABLED = "NEAT_AI_RUST_SCORER_ENABLED";
const BINARY = "NEAT_AI_RUST_SCORER_BINARY_PATH";

// ── layer 1: nothing set anywhere ─────────────────────────────────────────
Deno.env.delete(ENABLED);
Deno.env.delete(BINARY);
__resetRustScorerBridgeForTests();

const out = {};
out.defaultEnabled = resolveRustScorerConfig().enabled;
out.absentIsEnvConfig = resolveRustScorerConfig() === getEnvRustScorerConfig();
out.optionOverDefault = resolveRustScorerConfig({ enabled: true }).enabled;
out.coercedTimeoutMs = resolveRustScorerConfig({ timeoutMs: "1500" }).timeoutMs;

// ── layer 2: environment set ──────────────────────────────────────────────
Deno.env.set(ENABLED, "1");
Deno.env.set(BINARY, "/opt/env/rust_scorer");
__resetRustScorerBridgeForTests();

out.envOverDefault = resolveRustScorerConfig().enabled;
out.optionOverEnv = resolveRustScorerConfig({ enabled: false }).enabled;
out.partialKeepsEnvBinaryPath =
  resolveRustScorerConfig({ enabled: true }).binaryPath;

out.configOptionOverEnv =
  createNeatConfig({ rustScorer: { enabled: false } }).rustScorer.enabled;
out.configEnvOverDefault = createNeatConfig({}).rustScorer.enabled;
out.configAbsentMatchesEnv =
  JSON.stringify(createNeatConfig({}).rustScorer) ===
    JSON.stringify(getEnvRustScorerConfig());

// A per-run option must never be written back into the process-level env
// cache — the next run would inherit it.
out.envCacheStillEnabled = getEnvRustScorerConfig().enabled;

console.log(JSON.stringify(out));`;

  const passThrough: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "DENO_DIR", "TMPDIR"]) {
    const value = Deno.env.get(key);
    if (value !== undefined) passThrough[key] = value;
  }
  const command = new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config", "./deno.json", code],
    env: passThrough,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  });
  const { code: status, stdout, stderr } = await command.output();
  const out = new TextDecoder().decode(stdout).trim();
  assertEquals(status, 0, `child failed: ${new TextDecoder().decode(stderr)}`);
  return JSON.parse(out.split("\n").at(-1)!);
}

const cases = await resolveCases();

Deno.test("rustScorer: an explicit option beats the environment", () => {
  assertEquals(
    cases.optionOverEnv,
    false,
    "rustScorer.enabled:false must survive NEAT_AI_RUST_SCORER_ENABLED=1",
  );
  assertEquals(
    cases.configOptionOverEnv,
    false,
    "createNeatConfig must resolve the option, not the environment",
  );
});

Deno.test("rustScorer: the environment beats the built-in default", () => {
  assertEquals(cases.defaultEnabled, false, "the built-in default is off");
  assertEquals(
    cases.envOverDefault,
    true,
    "NEAT_AI_RUST_SCORER_ENABLED=1 still enables the scorer",
  );
  assertEquals(
    cases.configEnvOverDefault,
    true,
    "createNeatConfig with no option still honours the environment",
  );
});

Deno.test("rustScorer: an absent option resolves to the env config unchanged", () => {
  assert(
    cases.absentIsEnvConfig,
    "resolveRustScorerConfig() must return getEnvRustScorerConfig() itself",
  );
  assert(
    cases.configAbsentMatchesEnv,
    "config.rustScorer must equal getEnvRustScorerConfig() when unset",
  );
});

Deno.test("rustScorer: a partial option leaves the other fields on env", () => {
  assertEquals(
    cases.partialKeepsEnvBinaryPath,
    "/opt/env/rust_scorer",
    "binaryPath was not overridden, so it keeps its env value",
  );
  assertEquals(
    cases.coercedTimeoutMs,
    1500,
    "a CLI-shaped string timeoutMs is coerced to a number",
  );
});

Deno.test("rustScorer: a per-run option never pollutes the env cache", () => {
  assertEquals(
    cases.envCacheStillEnabled,
    true,
    "resolving an option must not write back into the memoised env layer",
  );
});
