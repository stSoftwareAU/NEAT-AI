/**
 * Issue #3681 — the coverage `merge` job runs repo-authored code **before** the
 * steps that hold `secrets.CODECOV_TOKEN`:
 *
 * ```yaml
 * run: deno run --allow-read --allow-write scripts/merge_junit.ts --output=junit.xml junit-*.xml
 * ...
 * with:
 *   token: ${{ secrets.CODECOV_TOKEN }}
 * ```
 *
 * `scripts/merge_junit.ts` is an in-repo file, so a same-repo pull request
 * controls what executes at that step. An unrestricted `--allow-write` reaches
 * `$GITHUB_ENV` and `$GITHUB_PATH` — both honoured by later steps in the same
 * job — which is enough to shim a binary onto `PATH` or set an environment
 * variable the Codecov action reads, and thereby observe or redirect the token.
 *
 * The fix scopes the grant to the merged report the script actually writes, so
 * the step cannot reach the runner files that carry the token forward.
 *
 * These are "what" tests: they parse the committed workflow YAML and assert on
 * the resulting configuration, and they execute the script under exactly the
 * committed permission set to prove that set is both sufficient and binding.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const COVERAGE_WORKFLOW = ".github/workflows/coverage.yaml";
const MERGE_SCRIPT = join(REPO_ROOT, "scripts/merge_junit.ts");

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

interface Job {
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

async function readWorkflow(relPath: string): Promise<Workflow> {
  return parse(await Deno.readTextFile(join(REPO_ROOT, relPath))) as Workflow;
}

/** Drop shell comment lines so prose about a flag is not read as a grant. */
function stripComments(run: string): string {
  return run
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

/** Permission flags granted to a `deno` invocation inside a `run:` block. */
function grantedFlags(run: string): string[] {
  return stripComments(run).match(/--allow-[a-z-]+(?:=[^\s\\]*)?/g) ?? [];
}

function grantsUnrestrictedWrite(run: string): boolean {
  if (/(^|\s)(-A|--allow-all)(\s|$)/.test(stripComments(run))) return true;
  return grantedFlags(run).some((flag) => flag === "--allow-write");
}

/** The `run:` block that invokes the JUnit merge script. */
async function mergeStepRun(): Promise<string> {
  const wf = await readWorkflow(COVERAGE_WORKFLOW);
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (typeof step.run === "string" && /merge_junit\.ts/.test(step.run)) {
        return step.run;
      }
    }
  }
  throw new Error(
    `${COVERAGE_WORKFLOW} must run scripts/merge_junit.ts to consolidate the ` +
      "per-shard JUnit reports",
  );
}

/** Flags between `deno run` and the script path of the merge invocation. */
function mergeInvocationFlags(run: string): string[] {
  const match = stripComments(run).match(
    /deno\s+run\s+([\s\S]*?)scripts\/merge_junit\.ts/,
  );
  assert(match !== null, `no 'deno run … merge_junit.ts' found in: ${run}`);
  return match![1]
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && token !== "\\");
}

Deno.test("the JUnit merge step scopes --allow-write to its output (Issue #3681)", async () => {
  const run = await mergeStepRun();
  const writes = grantedFlags(run).filter((flag) =>
    flag.split("=")[0] === "--allow-write"
  );
  assertEquals(
    writes.length,
    1,
    `expected exactly one --allow-write flag, got '${writes.join(", ")}'`,
  );
  const value = writes[0].split("=")[1];
  assert(
    value !== undefined && value.trim().length > 0,
    "--allow-write must name the merged report path rather than granting " +
      "write access runner-wide — an unrestricted grant reaches $GITHUB_ENV " +
      "and $GITHUB_PATH, which later steps in the same job honour while they " +
      "hold secrets.CODECOV_TOKEN",
  );
  const output = stripComments(run).match(/--output=([^\s\\]+)/)?.[1];
  assertEquals(
    value,
    output,
    "--allow-write must be scoped to exactly the --output path the script " +
      "writes, so the grant stays as narrow as the job's real need",
  );
});

Deno.test("no secret-bearing job grants unrestricted write to repo-authored code (Issue #3681)", async () => {
  const wf = await readWorkflow(COVERAGE_WORKFLOW);
  let checkedSecretJobs = 0;
  for (const [jobId, job] of Object.entries(wf.jobs ?? {})) {
    if (!/secrets\./.test(JSON.stringify(job))) continue;
    checkedSecretJobs++;
    for (const step of job.steps ?? []) {
      if (typeof step.run !== "string") continue;
      if (!/\bdeno\s+(run|test|bench|eval)\b/.test(step.run)) continue;
      assert(
        !grantsUnrestrictedWrite(step.run),
        `${COVERAGE_WORKFLOW} job "${jobId}" step "${
          step.name ?? "<unnamed>"
        }" runs repo-authored code with unrestricted write access while the ` +
          "same job holds a secret. Scope the grant to the paths the step " +
          "writes (--allow-write=<path>) so it cannot mutate $GITHUB_ENV or " +
          "$GITHUB_PATH and reach the secret through a later step.",
      );
    }
  }
  assert(
    checkedSecretJobs > 0,
    `${COVERAGE_WORKFLOW} expected at least one job that references a secret`,
  );
});

/**
 * Run the merge script under the exact permission set the workflow grants, in a
 * throwaway working directory, and assert it still produces the merged report.
 * If the grant is narrowed past what the script needs, Deno exits non-zero with
 * a PermissionDenied and this test fails — the same signal CI would give.
 */
async function runMergeScript(
  cwd: string,
  scriptArgs: string[],
): Promise<{ code: number; stderr: string }> {
  const flags = mergeInvocationFlags(await mergeStepRun());
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", ...flags, MERGE_SCRIPT, ...scriptArgs],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await command.output();
  return { code, stderr: new TextDecoder().decode(stderr) };
}

const SHARD_ONE = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="2" failures="0" errors="0" skipped="0" time="1.5">
<testsuite name="shard-0" tests="2" failures="0" errors="0" skipped="0" time="1.5"/>
</testsuites>
`;

const SHARD_TWO = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="3" failures="1" errors="0" skipped="0" time="2.5">
<testsuite name="shard-1" tests="3" failures="1" errors="0" skipped="0" time="2.5"/>
</testsuites>
`;

Deno.test("the committed permission set still merges the shard reports (Issue #3681)", async () => {
  const cwd = await Deno.makeTempDir({ prefix: "merge-junit-perms-" });
  try {
    await Deno.writeTextFile(join(cwd, "junit-0.xml"), SHARD_ONE);
    await Deno.writeTextFile(join(cwd, "junit-1.xml"), SHARD_TWO);
    const { code, stderr } = await runMergeScript(cwd, [
      "--output=junit.xml",
      "junit-0.xml",
      "junit-1.xml",
    ]);
    assertEquals(code, 0, `merge failed under the workflow grant: ${stderr}`);
    const merged = await Deno.readTextFile(join(cwd, "junit.xml"));
    assert(
      merged.includes('tests="5"') && merged.includes('failures="1"'),
      `merged report should aggregate both shards, got:\n${merged}`,
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("the committed permission set blocks writes outside the report (Issue #3681)", async () => {
  const cwd = await Deno.makeTempDir({ prefix: "merge-junit-perms-" });
  try {
    await Deno.writeTextFile(join(cwd, "junit-0.xml"), SHARD_ONE);
    // `$GITHUB_ENV` is the file a compromised merge step would target: writing
    // to it seeds environment variables into every later step of the same job,
    // including the ones that hold secrets.CODECOV_TOKEN.
    const { code, stderr } = await runMergeScript(cwd, [
      "--output=github-env",
      "junit-0.xml",
    ]);
    assert(
      code !== 0,
      "the workflow grant must deny writes to any path other than the merged " +
        "report; a step that can write arbitrary files can seed $GITHUB_ENV " +
        "or $GITHUB_PATH for the token-bearing steps that follow",
    );
    assert(
      /NotCapable|PermissionDenied|Requires write access/i.test(stderr),
      `expected a Deno permission failure, got:\n${stderr}`,
    );
    assertEquals(
      await Deno.stat(join(cwd, "github-env")).catch(() => null),
      null,
      "no file should have been written outside the granted path",
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});
