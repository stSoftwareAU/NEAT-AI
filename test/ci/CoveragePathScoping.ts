import { assert, assertEquals } from "@std/assert";
import { globToRegExp } from "@std/path";
import { parse } from "@std/yaml";

/**
 * Verifies the Test Coverage workflow skips its eight heavy shards on a
 * docs-only PR while the required `merge` check still reports (Issue #4041).
 *
 * A `changes` job runs `dorny/paths-filter` against an explicit include list;
 * the shards run only when it reports a code change, and `merge` always runs
 * so the required status check posts a trivial pass instead of hanging. A
 * failed `changes` job must fail `merge` loudly rather than read as "no code
 * changed".
 *
 * This is a "what" test: it parses the committed workflow, evaluates the
 * filter's globs against sample PR file lists, and asserts on the job graph.
 */

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  "if"?: string;
  with?: Record<string, unknown>;
}

interface Job {
  needs?: string | string[];
  "if"?: string;
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps?: Step[];
}

interface Workflow {
  jobs: Record<string, Job>;
}

const COVERAGE_WORKFLOW = ".github/workflows/coverage.yaml";

async function readWorkflow(): Promise<Workflow> {
  return parse(await Deno.readTextFile(COVERAGE_WORKFLOW)) as Workflow;
}

function needsOf(job: Job): string[] {
  if (job.needs === undefined) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

function filterStep(wf: Workflow): Step {
  const changes = wf.jobs.changes;
  assert(changes, "coverage.yaml must define a `changes` job");
  const step = (changes.steps ?? []).find((s) =>
    s.uses?.startsWith("dorny/paths-filter@")
  );
  assert(step, "`changes` job must run dorny/paths-filter");
  return step;
}

/** The `code` filter's globs, parsed from the action's `filters` input. */
function codeGlobs(wf: Workflow): string[] {
  const raw = filterStep(wf).with?.filters;
  assert(typeof raw === "string", "paths-filter `filters` must be a string");
  const filters = parse(raw) as Record<string, string[]>;
  assert(Array.isArray(filters.code), "filters must define a `code` list");
  return filters.code;
}

/** Whether a PR touching `files` would run the coverage shards. */
function runsShards(globs: string[], files: string[]): boolean {
  const patterns = globs.map((g) =>
    globToRegExp(g, { globstar: true, extended: true })
  );
  return files.some((f) => patterns.some((re) => re.test(f)));
}

Deno.test("paths-filter is pinned to a full commit SHA (Issue #4041)", async () => {
  const uses = filterStep(await readWorkflow()).uses ?? "";
  assert(
    /^dorny\/paths-filter@[0-9a-f]{40}$/.test(uses.trim()),
    `paths-filter must be SHA-pinned, got: ${uses}`,
  );
});

Deno.test("docs-only PRs skip the coverage shards (Issue #4041)", async () => {
  const globs = codeGlobs(await readWorkflow());
  assertEquals(
    runsShards(globs, [
      "README.md",
      "docs/GLOSSARY.md",
      "docs/archive/pr-summaries/pr-summary-4041.md",
      "CHANGELOG.md",
      ".github/workflows/pages.yml",
    ]),
    false,
  );
});

Deno.test("code, test and build-input PRs run the coverage shards (Issue #4041)", async () => {
  const globs = codeGlobs(await readWorkflow());
  for (
    const file of [
      "src/architecture/Creature.ts",
      "test/ci/CoveragePathScoping.ts",
      "bench/ParallelBreeding.ts",
      "wasm_activation/pkg/wasm_activation_bg.wasm",
      "scripts/shard_test_files.ts",
      "scripts/test-timings.json",
      ".github/actions/setup-neat/action.yml",
      "deno.json",
      "deno.lock",
      ".github/workflows/coverage.yaml",
    ]
  ) {
    assert(runsShards(globs, [file]), `${file} must trigger the shards`);
  }
});

Deno.test("the filter is an include list, not an exclude list (Issue #4041)", async () => {
  for (const glob of codeGlobs(await readWorkflow())) {
    assert(!glob.startsWith("!"), `negated glob not allowed: ${glob}`);
    assert(!glob.startsWith("docs/"), `docs glob not allowed: ${glob}`);
  }
});

Deno.test("the changes job holds read-only permissions (Issue #4041)", async () => {
  const perms = (await readWorkflow()).jobs.changes?.permissions ?? {};
  assert(Object.keys(perms).length > 0, "`changes` must set permissions");
  for (const [scope, level] of Object.entries(perms)) {
    assertEquals(level, "read", `changes.permissions.${scope} must be read`);
  }
});

Deno.test("the shards run only when the filter reports code (Issue #4041)", async () => {
  const wf = await readWorkflow();
  const coverage = wf.jobs.coverage;
  assert(needsOf(coverage).includes("changes"));
  assert(
    (coverage.if ?? "").includes("needs.changes.outputs.code == 'true'"),
    `coverage.if must gate on the filter, got: ${coverage.if}`,
  );
  assertEquals(
    wf.jobs.changes.outputs?.code,
    "${{ steps.filter.outputs.code }}",
  );
});

Deno.test("the merge check always runs and fails loud when detection fails (Issue #4041)", async () => {
  const merge = (await readWorkflow()).jobs.merge;
  const needs = needsOf(merge);
  assert(needs.includes("changes") && needs.includes("coverage"));
  assert((merge.if ?? "").includes("!cancelled()"));
  assert(
    !(merge.if ?? "").includes("needs.changes.outputs"),
    "merge must not be skipped on a docs-only PR — it is the required check",
  );

  const steps = merge.steps ?? [];
  const guard = steps[0];
  assert(
    guard?.run?.includes("exit 1") &&
      Object.values(merge.env ?? {}).some((v) =>
        v.includes("needs.changes.result")
      ),
    "merge's first step must fail when the changes job did not succeed",
  );
  assertEquals(guard.if, undefined, "the detection guard must always run");

  // Every other step is either the explicit skip notice or gated on the
  // filter, so a docs-only PR cannot trip the shard-status failure steps.
  for (const step of steps.slice(1)) {
    assert(
      (step.if ?? "").includes("env.RUN_COVERAGE"),
      `merge step "${step.name ?? step.id}" must be gated on RUN_COVERAGE`,
    );
  }
});
