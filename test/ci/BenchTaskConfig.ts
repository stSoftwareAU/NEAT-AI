import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Verifies the benchmark runner wiring added for Issue #3175.
 *
 * The `bench/` directory holds Deno.bench suites, but until #3175 nothing ran
 * them: `deno bench` only auto-discovers `*.bench.ts` files, so the many
 * PascalCase `Deno.bench` files were never executed by any task or CI job.
 *
 * This test locks in the two guarantees that keep the new `deno task bench`
 * entry point honest:
 *
 *   1. The `bench` config discovers the whole `bench/` tree, while every
 *      standalone profiling harness (run via `deno run`, not `deno bench`) is
 *      listed in `exclude` so `deno task bench` never executes its heavy
 *      top-level code. A stale exclude entry (a file that no longer exists)
 *      would silently drift, so we assert each excluded path is real.
 *   2. The benchmark smoke workflow runs `deno task bench:smoke`, so the
 *      benchmarks are actually exercised in CI.
 */

interface DenoConfig {
  tasks?: Record<string, string>;
  bench?: {
    include?: string[];
    exclude?: string[];
  };
}

async function loadDenoConfig(): Promise<DenoConfig> {
  return JSON.parse(await Deno.readTextFile("deno.json")) as DenoConfig;
}

Deno.test("deno.json exposes documented benchmark tasks", async () => {
  const config = await loadDenoConfig();
  const tasks = config.tasks ?? {};

  assert(
    typeof tasks.bench === "string",
    "expected a `bench` task in deno.json",
  );
  assertStringIncludes(
    tasks.bench,
    "deno bench",
    "the `bench` task should invoke `deno bench`",
  );

  assert(
    typeof tasks["bench:smoke"] === "string",
    "expected a `bench:smoke` task in deno.json",
  );
  assertStringIncludes(
    tasks["bench:smoke"],
    "deno bench",
    "the `bench:smoke` task should invoke `deno bench`",
  );
});

Deno.test("bench config discovers the whole bench/ tree", async () => {
  const config = await loadDenoConfig();
  const include = config.bench?.include ?? [];
  assert(
    include.includes("bench/**/*.ts"),
    `bench.include should cover the bench/ tree, got: ${include.join(", ")}`,
  );
});

Deno.test("every excluded profiling harness still exists on disk", async () => {
  const config = await loadDenoConfig();
  const exclude = config.bench?.exclude ?? [];
  assert(
    exclude.length > 0,
    "expected some standalone harnesses to be excluded",
  );

  const stats = await Promise.all(
    exclude.map((path) => Deno.stat(path).catch(() => null)),
  );
  exclude.forEach((path, i) => {
    assert(
      stats[i]?.isFile === true,
      `excluded bench path does not exist (stale exclude?): ${path}`,
    );
  });
});

Deno.test("bench:smoke task references real benchmark files", async () => {
  const config = await loadDenoConfig();
  const smoke = config.tasks?.["bench:smoke"] ?? "";

  // Pull the bench/*.ts arguments off the command line and confirm each exists.
  const files = smoke.split(/\s+/).filter((token) => token.endsWith(".ts"));
  assert(files.length > 0, "bench:smoke should name at least one bench file");

  const stats = await Promise.all(
    files.map((path) => Deno.stat(path).catch(() => null)),
  );
  files.forEach((path, i) => {
    assert(
      stats[i]?.isFile === true,
      `bench:smoke references a missing file: ${path}`,
    );
  });
});

Deno.test("benchmark workflow runs the smoke task", async () => {
  const workflow = parse(
    await Deno.readTextFile(".github/workflows/bench.yaml"),
  ) as {
    jobs?: Record<string, { steps?: Array<{ run?: string }> }>;
  };

  const steps = Object.values(workflow.jobs ?? {}).flatMap((job) =>
    job.steps ?? []
  );
  const runsSmoke = steps.some((step) =>
    step.run?.includes("deno task bench:smoke")
  );
  assertEquals(
    runsSmoke,
    true,
    "bench.yaml should execute `deno task bench:smoke`",
  );
});
