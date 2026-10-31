import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/yaml";
import { join } from "@std/path";

/**
 * The Test Coverage workflow is the PR test gate (quality.yml does not run
 * tests). Runner crashes fail their required shard check; assertion failures
 * stay green on shards and fail in the merge job after results are published.
 * An exit-1 fatal OOM that survives the retry is a runner crash (Issue #4124).
 * Partition-verification failures (`error:partition`) and a missing
 * `coverage-<shard>/` dir after a recorded status (`error:no-coverage`) also
 * fail the required shard check (Issue #4125), because the merge job that
 * repeats those gates is not a required check.
 *
 * These tests parse the committed workflow YAML and execute the shard's actual
 * shell block with a controlled Deno runner to verify exit and artifact effects.
 */

interface Step {
  name?: string;
  "if"?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface Job {
  if?: string;
  steps?: Step[];
  strategy?: { "fail-fast"?: boolean };
  needs?: string[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

const COVERAGE_WORKFLOW = ".github/workflows/coverage.yaml";

async function readWorkflow(): Promise<Workflow> {
  return parse(await Deno.readTextFile(COVERAGE_WORKFLOW)) as Workflow;
}

interface ShardOptions {
  /** Exit code of the fake `shard_test_files.ts --verify` (default 0). */
  verifyExit?: number;
  /** When true, the fake `deno test` does not create `coverage-<shard>/`. */
  skipCoverage?: boolean;
}

interface ShardResult {
  code: number;
  status: string;
  junit: string;
  hasCoverage: boolean;
  /** Number of times the fake `deno test` ran. */
  runs: number;
}

async function runShard(
  codes: number[],
  /** 1-based `deno test` runs that log the fatal-OOM signature. */
  oomRuns: number[] = [],
  opts: ShardOptions = {},
): Promise<ShardResult> {
  const wf = await readWorkflow();
  const step = wf.jobs?.coverage?.steps?.find((s) =>
    s.name === "Run test shard"
  );
  assert(step?.run, "coverage job must declare a runnable test shard step");

  const dir = await Deno.makeTempDir();
  try {
    const bin = join(dir, "bin");
    await Deno.mkdir(bin);
    await Deno.writeTextFile(join(dir, "meminfo"), "MemTotal: 16777216 kB\n");
    const deno = join(bin, "deno");
    await Deno.writeTextFile(
      deno,
      `#!/bin/sh
case "$*" in
*scripts/shard_test_files.ts*)
  case "$*" in *--verify*) if [ "\${RUNNER_VERIFY_EXIT:-0}" -ne 0 ]; then echo 'unassigned files: test/x.ts' >&2; fi; exit "\${RUNNER_VERIFY_EXIT:-0}" ;; esac
  echo test/example.ts
  exit 0
  ;;
*scripts/coverage_run_plan.ts*)
  printf 'HEAP_MB=1024\\nDENO_JOBS=4\\nPARALLEL=true\\n'
  exit 0
  ;;
esac
if [ "$1" = test ]; then
  for arg do
    case "$arg" in --coverage=*) [ "\${RUNNER_NO_COVERAGE:-0}" = 1 ] || mkdir -p "\${arg#--coverage=}" ;; esac
  done
  count=0
  [ ! -f .runner-count ] || count=$(cat .runner-count)
  count=$((count + 1))
  echo "$count" > .runner-count
  code=$(printf '%s' "$RUNNER_CODES" | cut -d, -f "$count")
  case ",\${RUNNER_OOM_RUNS:-}," in
    *",$count,"*) echo 'Fatal JavaScript out of memory: Ineffective mark-compacts near heap limit' >&2 ;;
  esac
  if [ "$code" -eq 0 ] || [ "$code" -eq 1 ]; then
    printf '<?xml version="1.0"?>\\n<testsuites></testsuites>\\n'
  else
    printf '<?xml version="1.0"?>\\n<testsuites>'
  fi
  exit "$code"
fi
echo "unexpected deno invocation: $*" >&2
exit 90
`,
    );
    await Deno.chmod(deno, 0o755);

    const run = step.run.replaceAll("${{ matrix.shard }}", "0")
      .replaceAll("$(nproc)", "4")
      .replaceAll("/proc/meminfo", join(dir, "meminfo"));
    const result = await new Deno.Command("bash", {
      args: ["-euo", "pipefail", "-c", run],
      cwd: dir,
      clearEnv: true,
      env: {
        PATH: `${bin}:${Deno.env.get("PATH") ?? ""}`,
        RUNNER_CODES: codes.join(","),
        RUNNER_OOM_RUNS: oomRuns.join(","),
        RUNNER_VERIFY_EXIT: String(opts.verifyExit ?? 0),
        RUNNER_NO_COVERAGE: opts.skipCoverage ? "1" : "0",
        SHARD_TOTAL: "8",
      },
    }).output();
    if (!(await exists(join(dir, "shard-status-0.txt")))) {
      throw new Error(
        `shard command exited ${result.code}; stdout=${
          new TextDecoder().decode(result.stdout)
        }; stderr=${new TextDecoder().decode(result.stderr)}`,
      );
    }
    const status = await Deno.readTextFile(join(dir, "shard-status-0.txt"));
    // The JUnit file is absent when the shard stops before running tests
    // (e.g. a partition-verification failure).
    const junitPath = join(dir, "junit-0.xml");
    const junit = (await exists(junitPath))
      ? await Deno.readTextFile(junitPath)
      : "";
    const countPath = join(dir, ".runner-count");
    const runs = (await exists(countPath))
      ? Number((await Deno.readTextFile(countPath)).trim())
      : 0;
    return {
      code: result.code,
      status: status.trim(),
      junit,
      hasCoverage: await isDirectory(join(dir, "coverage-0")),
      runs,
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  if (!(await exists(path))) return false;
  return (await Deno.stat(path)).isDirectory;
}

function mergeSteps(wf: Workflow): Step[] {
  const steps = wf.jobs?.merge?.steps;
  assert(
    Array.isArray(steps) && steps.length > 0,
    "coverage.yaml merge job must declare steps",
  );
  return steps;
}

Deno.test("coverage merge job fails when tests fail", async () => {
  const steps = mergeSteps(await readWorkflow());
  const failTests = steps.find((s) => s.name === "Fail build if tests failed");
  assert(
    failTests,
    "merge job must declare a step named 'Fail build if tests failed'",
  );
  assert(
    typeof failTests["if"] === "string" &&
      failTests["if"].includes("failed") &&
      failTests["if"].includes("0"),
    "Fail build if tests failed must run when the gate reports failed shards; " +
      `got if=${failTests["if"]}`,
  );
  assert(
    typeof failTests.run === "string" && failTests.run.includes("exit 1"),
    "Fail build if tests failed must exit 1 so the PR check fails",
  );
});

Deno.test("coverage merge job fails when a shard crashed", async () => {
  const steps = mergeSteps(await readWorkflow());
  const failCrash = steps.find((s) =>
    s.name === "Fail build if any shard crashed"
  );
  assert(
    failCrash,
    "merge job must declare a step named 'Fail build if any shard crashed'",
  );
  assert(
    typeof failCrash["if"] === "string" &&
      (failCrash["if"].includes("errored") ||
        failCrash["if"].includes("missing")),
    "Fail build if any shard crashed must run when shards error or vanish; " +
      `got if=${failCrash["if"]}`,
  );
  assert(
    typeof failCrash.run === "string" && failCrash.run.includes("exit 1"),
    "Fail build if any shard crashed must exit 1 so the PR check fails",
  );
});

Deno.test("coverage shard job runs deno test", async () => {
  const wf = await readWorkflow();
  const steps = wf.jobs?.coverage?.steps ?? [];
  const runShard = steps.find((s) => s.name === "Run test shard");
  assert(runShard, "coverage job must declare a 'Run test shard' step");
  assert(
    typeof runShard.run === "string" && runShard.run.includes("deno test"),
    "coverage shard must invoke deno test so PRs actually execute the suite",
  );
});

Deno.test("coverage shard exits successfully after a passing test run", async () => {
  const result = await runShard([0]);
  assertEquals(result.code, 0);
  assertEquals(result.status, "passed");
  assert(result.junit.includes("</testsuites>"));
  assert(result.hasCoverage);
});

Deno.test("ordinary test failures retain results and leave shard aggregation to merge", async () => {
  const result = await runShard([1]);
  assertEquals(result.code, 0);
  assertEquals(result.status, "failed");
  assert(result.junit.includes("</testsuites>"));
  assert(result.hasCoverage);
});

Deno.test("unexpected runner crashes fail the shard after writing artifacts", async () => {
  const result = await runShard([139]);
  assertEquals(result.status, "error:139");
  assertEquals(result.code, 139);
  assert(result.junit.length > 0);
  assert(!result.junit.includes("</testsuites>"));
  assert(result.hasCoverage);
});

Deno.test("successful OOM recovery leaves the shard green", async () => {
  const result = await runShard([133, 0]);
  assertEquals(result.code, 0);
  assertEquals(result.status, "passed");
  assert(result.junit.includes("</testsuites>"));
  assert(result.hasCoverage);
});

Deno.test("an exhausted OOM retry fails after retaining final shard artifacts", async () => {
  const result = await runShard([133, 137]);
  assertEquals(result.status, "error:137");
  assertEquals(result.code, 137);
  assert(result.junit.length > 0);
  assert(!result.junit.includes("</testsuites>"));
  assert(result.hasCoverage);
});

Deno.test("a failed partition check fails the shard before any test runs (Issue #4125)", async () => {
  const result = await runShard([0], [], { verifyExit: 1 });
  assertEquals(result.status, "error:partition");
  assertEquals(result.code, 1);
  assertEquals(result.runs, 0);
  assert(!result.hasCoverage);

  // Positive control: the same inputs with a passing partition check pass.
  const control = await runShard([0], [], { verifyExit: 0 });
  assertEquals(control.code, 0);
  assertEquals(control.status, "passed");
  assertEquals(control.runs, 1);
  assert(control.hasCoverage);
});

Deno.test("a passing run that loses its coverage dir fails the shard (Issue #4125)", async () => {
  const result = await runShard([0], [], { skipCoverage: true });
  assertEquals(result.status, "error:no-coverage");
  assertEquals(result.code, 1);
  assertEquals(result.hasCoverage, false);
});

Deno.test("an ordinary failure that loses its coverage dir fails the shard (Issue #4125)", async () => {
  const result = await runShard([1], [], { skipCoverage: true });
  assertEquals(result.status, "error:no-coverage");
  assertEquals(result.code, 1);
  assertEquals(result.hasCoverage, false);
});

Deno.test("a fatal-OOM exit 1 that survives the retry fails the shard as error:oom", async () => {
  const result = await runShard([1, 1], [1, 2]);
  assertEquals(result.status, "error:oom");
  assertEquals(result.code, 1);
  assert(result.junit.length > 0);
  assert(result.hasCoverage);
});

Deno.test("a fatal-OOM exit 1 followed by an ordinary retry failure stays green", async () => {
  const result = await runShard([1, 1], [1]);
  assertEquals(result.status, "failed");
  assertEquals(result.code, 0);
  assertEquals(result.runs, 2);
});

Deno.test("a fatal-OOM exit 1 recovered by the retry leaves the shard green", async () => {
  const result = await runShard([1, 0], [1]);
  assertEquals(result.status, "passed");
  assertEquals(result.code, 0);
});

Deno.test("coverage shard failures still upload status and JUnit artifacts", async () => {
  const wf = await readWorkflow();
  const steps = wf.jobs?.coverage?.steps ?? [];
  const upload = steps.find((s) => s.name === "Upload shard artifact");
  assert(upload, "coverage job must upload shard artifacts");
  assertEquals(upload.if, "${{ always() }}");
  const paths = upload.with?.path;
  assert(typeof paths === "string");
  assert(paths.includes("coverage-${{ matrix.shard }}/"));
  assert(paths.includes("junit-${{ matrix.shard }}.xml"));
  assert(paths.includes("shard-status-${{ matrix.shard }}.txt"));
});

Deno.test("coverage failures do not cancel siblings and merge still runs", async () => {
  const wf = await readWorkflow();
  assertEquals(wf.jobs?.coverage?.strategy?.["fail-fast"], false);
  const merge = wf.jobs?.merge;
  assert(merge, "coverage workflow must aggregate shard results");
  assert((merge.needs ?? []).includes("coverage"));
  assert(merge.if?.includes("!cancelled()"));
});
