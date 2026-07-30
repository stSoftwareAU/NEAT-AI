import { assert } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Guards the shard-artifact visibility invariant of
 * `.github/workflows/coverage.yaml` (Issue #3550).
 *
 * `actions/upload-artifact` defaults to `include-hidden-files: false`, so a
 * dot-prefixed path is silently dropped from the artifact. The shards used to
 * write coverage into `.coverage-<shard>/`, which therefore never reached the
 * merge job: the merge glob came back empty, coverage was skipped, and the run
 * still went green. Coverage directories must be non-hidden, and the merge job
 * must fail loud rather than skip when they are missing.
 *
 * These are "what" tests: they parse the committed workflow YAML and assert on
 * the configuration the runner actually executes.
 */

interface Step {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface Job {
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

const COVERAGE_WORKFLOW = ".github/workflows/coverage.yaml";

async function readWorkflow(): Promise<Workflow> {
  return parse(await Deno.readTextFile(COVERAGE_WORKFLOW)) as Workflow;
}

function stepsOf(wf: Workflow, job: string): Step[] {
  const steps = wf.jobs?.[job]?.steps;
  assert(steps && steps.length > 0, `${job} job must declare steps`);
  return steps;
}

/** Any dot-prefixed path segment is hidden and dropped by upload-artifact. */
function hiddenPaths(paths: string[]): string[] {
  return paths.filter((p) =>
    p.split("/").some((segment) => segment.startsWith("."))
  );
}

Deno.test("shard artifact upload lists no hidden paths", async () => {
  const wf = await readWorkflow();
  const upload = stepsOf(wf, "coverage").find((s) =>
    typeof s.uses === "string" && s.uses.includes("upload-artifact")
  );
  assert(upload, "coverage job must upload a per-shard artifact");
  const path = upload.with?.path;
  assert(typeof path === "string", "upload step must declare a `path`");
  const paths = path.split("\n").map((p) => p.trim()).filter((p) => p.length);
  const hidden = hiddenPaths(paths);
  assert(
    hidden.length === 0,
    `upload-artifact drops hidden paths by default; these would be silently lost: ${
      hidden.join(", ")
    }`,
  );
  assert(
    paths.some((p) => /^coverage-\$\{\{\s*matrix\.shard\s*\}\}\/?$/.test(p)),
    `shard artifact must include the non-hidden coverage dir, got: ${
      paths.join(", ")
    }`,
  );
});

Deno.test("shard writes coverage into a non-hidden directory", async () => {
  const wf = await readWorkflow();
  const run = stepsOf(wf, "coverage").find((s) => s.id === "run_shard")?.run;
  assert(typeof run === "string", "coverage job must declare a run_shard step");
  const covDir = run.match(/COV_DIR="([^"]+)"/);
  assert(covDir, "run_shard must set COV_DIR");
  assert(
    !covDir[1].startsWith("."),
    `COV_DIR must not be hidden (upload-artifact drops it), got: ${covDir[1]}`,
  );
});

Deno.test("merge job runs the coverage gate before merging", async () => {
  const wf = await readWorkflow();
  const merge = stepsOf(wf, "merge");
  const covStep = merge.find((s) =>
    typeof s.run === "string" && s.run.includes("deno coverage")
  );
  assert(covStep?.run, "merge job must create the merged coverage report");
  assert(
    covStep.run.includes("scripts/coverage_merge_gate.ts"),
    "merge job must consult the unit-tested coverage merge gate (Issue #3550)",
  );
  assert(
    !/coverage_merge_gate\.ts[^\n]*\|\|\s*true/.test(covStep.run),
    "the gate's failure must not be swallowed with `|| true`",
  );
  assert(
    covStep.run.includes("coverage-*/") &&
      !covStep.run.includes(".coverage-*/"),
    "merge glob must match the non-hidden coverage dirs",
  );
});

Deno.test("merge job fails loud on an empty lcov report", async () => {
  const wf = await readWorkflow();
  const covStep = stepsOf(wf, "merge").find((s) =>
    typeof s.run === "string" && s.run.includes("deno coverage")
  );
  assert(covStep?.run, "merge job must create the merged coverage report");
  // Producing no (or an empty) lcov after a successful merge would silently
  // skip the Codecov upload via its `hashFiles` guard — exactly the silent
  // failure Issue #3550 removes.
  assert(
    /\[\s+!?\s*-s\s+\.coverage\.lcov\s+\]/.test(covStep.run),
    "merge step must assert the lcov report is non-empty and exit non-zero otherwise",
  );
});
