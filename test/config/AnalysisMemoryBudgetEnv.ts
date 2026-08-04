/**
 * Tests for the Discovery analysis memory-budget env resolver (Issue #3565).
 *
 * These exercise the pure env → override mapping with an injected reader, so
 * they are hermetic and never touch the real process environment.
 */
import { assert, assertEquals } from "@std/assert";
import {
  ANALYSIS_MEMORY_BUDGET_ENV,
  mergeAnalysisMemoryBudgetDefault,
  resolveAnalysisMemoryBudgetEnvMb,
} from "@config/AnalysisMemoryBudgetEnv.ts";
import { parseMemoryConfig } from "@config/parsers/RuntimeParsers.ts";
import type { Logger } from "@utils/Logger.ts";

/** Build an env getter from a plain record for hermetic tests. */
function envFrom(
  map: Record<string, string>,
): { get(key: string): string | undefined } {
  return { get: (k) => (k in map ? map[k] : undefined) };
}

/** Minimal recording logger capturing warnings. */
function makeRecordingLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  const logger = {
    debug: () => {},
    info: () => {},
    warn: (message: string) => warnings.push(message),
    error: () => {},
  } as unknown as Logger;
  return { logger, warnings };
}

Deno.test("resolveAnalysisMemoryBudgetEnvMb: unset env yields no budget", () => {
  assertEquals(resolveAnalysisMemoryBudgetEnvMb(envFrom({})), undefined);
});

Deno.test("resolveAnalysisMemoryBudgetEnvMb: positive integer is the budget", () => {
  assertEquals(
    resolveAnalysisMemoryBudgetEnvMb(
      envFrom({ [ANALYSIS_MEMORY_BUDGET_ENV]: " 2048 " }),
    ),
    2048,
  );
});

Deno.test("resolveAnalysisMemoryBudgetEnvMb: invalid values warn and fall back", () => {
  for (const raw of ["0", "-512", "abc", "1024.5", "Infinity"]) {
    const { logger, warnings } = makeRecordingLogger();
    assertEquals(
      resolveAnalysisMemoryBudgetEnvMb(
        envFrom({ [ANALYSIS_MEMORY_BUDGET_ENV]: raw }),
        logger,
      ),
      undefined,
      `${raw} must not activate a budget`,
    );
    assertEquals(warnings.length, 1, `${raw} must warn loudly`);
    assert(
      warnings[0].includes(ANALYSIS_MEMORY_BUDGET_ENV),
      "the warning names the offending variable",
    );
  }
});

Deno.test("resolveAnalysisMemoryBudgetEnvMb: empty value is unconfigured, not invalid", () => {
  const { logger, warnings } = makeRecordingLogger();
  assertEquals(
    resolveAnalysisMemoryBudgetEnvMb(
      envFrom({ [ANALYSIS_MEMORY_BUDGET_ENV]: "   " }),
      logger,
    ),
    undefined,
  );
  assertEquals(warnings, []);
});

Deno.test("mergeAnalysisMemoryBudgetDefault: no env budget leaves overrides untouched", () => {
  assertEquals(
    mergeAnalysisMemoryBudgetDefault(undefined, undefined),
    undefined,
  );
  const user = { maxAnalysisMemoryMb: 128 };
  assertEquals(mergeAnalysisMemoryBudgetDefault(user, undefined), user);
});

Deno.test("mergeAnalysisMemoryBudgetDefault: env seeds the budget when unset", () => {
  assertEquals(mergeAnalysisMemoryBudgetDefault(undefined, 4096), {
    maxAnalysisMemoryMb: 4096,
  });
  assertEquals(
    mergeAnalysisMemoryBudgetDefault({ enabled: false }, 4096),
    { maxAnalysisMemoryMb: 4096, enabled: false },
  );
});

Deno.test("mergeAnalysisMemoryBudgetDefault: explicit option wins over env", () => {
  assertEquals(
    mergeAnalysisMemoryBudgetDefault({ maxAnalysisMemoryMb: 512 }, 4096),
    { maxAnalysisMemoryMb: 512 },
  );
  // An explicit 0 is a deliberate "no budget" and must not be re-seeded.
  assertEquals(
    mergeAnalysisMemoryBudgetDefault({ maxAnalysisMemoryMb: 0 }, 4096),
    { maxAnalysisMemoryMb: 0 },
  );
});

/**
 * Run `createNeatConfig` in a child process so the environment stays hermetic:
 * `deno test --parallel` shares one process environment across test files, so
 * setting the variable in-process would leak into unrelated default assertions.
 *
 * @returns the `memory.maxAnalysisMemoryMb` values the child resolved.
 */
async function budgetsFromChild(
  env: Record<string, string>,
  optionsLiteral: string[],
): Promise<number[]> {
  const code = `import { createNeatConfig } from "@config/NeatConfig.ts";
console.log(JSON.stringify([${
    optionsLiteral.map((o) =>
      `createNeatConfig(${o}).memory.maxAnalysisMemoryMb`
    ).join(",")
  }]));`;
  // A cleared environment (plus the few variables Deno needs to find its cache)
  // guarantees the "unset" case really is unset, whatever the parent carries.
  const passThrough: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "DENO_DIR", "TMPDIR"]) {
    const value = Deno.env.get(key);
    if (value !== undefined) passThrough[key] = value;
  }
  const command = new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config", "./deno.json", code],
    env: { ...passThrough, ...env },
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  });
  const { code: status, stdout, stderr } = await command.output();
  const out = new TextDecoder().decode(stdout).trim();
  assertEquals(
    status,
    0,
    `child failed: ${new TextDecoder().decode(stderr)}`,
  );
  return JSON.parse(out.split("\n").at(-1)!);
}

Deno.test("createNeatConfig: runner-exported budget seeds memory.maxAnalysisMemoryMb", async () => {
  const [seeded, explicitWins] = await budgetsFromChild(
    { [ANALYSIS_MEMORY_BUDGET_ENV]: "4096" },
    ["{}", "{ memory: { maxAnalysisMemoryMb: 512 } }"],
  );
  assertEquals(seeded, 4096, "env budget reaches the parsed config");
  assertEquals(explicitWins, 512, "an explicit option wins over the env value");
});

Deno.test("createNeatConfig: budget stays off when the runner exports nothing", async () => {
  const [unset] = await budgetsFromChild({}, ["{}"]);
  assertEquals(unset, 0, "behaviour is unchanged without the env variable");
});

Deno.test("env budget flows through parseMemoryConfig to the parsed config", () => {
  const parsed = parseMemoryConfig(
    mergeAnalysisMemoryBudgetDefault(
      undefined,
      resolveAnalysisMemoryBudgetEnvMb(
        envFrom({ [ANALYSIS_MEMORY_BUDGET_ENV]: "3072" }),
      ),
    ),
  );
  assertEquals(parsed.maxAnalysisMemoryMb, 3072);
});
