import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse, stringify } from "@std/yaml";
// Register the real workflow's positive controls alongside the rejection cases.
// Child processes run only that suite, so these checks cannot recurse.
import "./CoverageFailsPrOnTestFailure.ts";

/**
 * Exercise the regression suite against known-broken workflow outcomes. This
 * verifies that its assertions reject incorrect exits and artifacts, including
 * when an assertion in the regression suite is removed by mutation testing.
 * Fixtures alter workflow behaviour, never the test source or assertion library.
 */
interface Step {
  name?: string;
  run?: string;
  if?: string;
  with?: { path?: string };
}

interface Workflow {
  jobs: Record<string, {
    steps: Step[];
    if?: string;
    needs?: string[];
    strategy?: { "fail-fast"?: boolean };
  }>;
}

const suite = new URL("./CoverageFailsPrOnTestFailure.ts", import.meta.url);
const config = new URL("../../deno.json", import.meta.url);
const workflow = new URL(
  "../../.github/workflows/coverage.yaml",
  import.meta.url,
);

async function checkRegression(
  filter: string,
  change: (wf: Workflow) => void,
  diagnostic?: string,
  expectedCode = 1,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    const wf = parse(await Deno.readTextFile(workflow)) as Workflow;
    change(wf);
    await Deno.mkdir(join(dir, ".github", "workflows"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".github", "workflows", "coverage.yaml"),
      stringify(wf),
    );
    const runnerTmp = join(dir, "runner-tmp");
    await Deno.mkdir(runnerTmp);
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "-A",
        "--no-check",
        "--config",
        config.pathname,
        "--filter",
        filter,
        suite.pathname,
      ],
      cwd: dir,
      env: {
        TMPDIR: runnerTmp,
        SHARD_TOTAL: "invalid-parent-value",
        TEST_EXIT_CODE: "73",
      },
    }).output();
    const output = new TextDecoder().decode(result.stdout) +
      new TextDecoder().decode(result.stderr);
    assertEquals(result.code, expectedCode, output);
    // A setup/import failure is not evidence that the selected check rejected
    // the fixture. Require the actual test's assertion or harness diagnostic.
    if (expectedCode !== 0) {
      assert(output.includes(diagnostic ?? "AssertionError"), output);
    }
    const leftovers = Array.fromAsync(Deno.readDir(runnerTmp));
    assertEquals(
      await leftovers,
      [],
      "shard harness must remove its workspace",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function shardStep(wf: Workflow): Step {
  return wf.jobs.coverage.steps.find((s) => s.name === "Run test shard")!;
}

Deno.test("coverage regression accepts the real workflow with isolated runner state", async () => {
  await checkRegression("", () => {}, undefined, 0);
});

const scenarios = [
  { filter: "coverage shard exits successfully", code: 0, complete: true },
  { filter: "ordinary test failures retain", code: 0, complete: true },
  { filter: "unexpected runner crashes", code: 139, complete: false },
  { filter: "successful OOM recovery", code: 0, complete: true },
  { filter: "an exhausted OOM retry", code: 137, complete: false },
];

for (const scenario of scenarios) {
  const faults = {
    exit: `exit ${scenario.code === 0 ? 7 : 0}`,
    status: "printf 'wrong-status\\n' > shard-status-0.txt",
    junit: scenario.complete
      ? "printf '<?xml version=\"1.0\"?>\\n<testsuites>' > junit-0.xml"
      : "printf '<testsuites></testsuites>\\n' > junit-0.xml",
    coverage: "rm -rf coverage-0; touch coverage-0",
    ...(scenario.complete ? {} : { "empty JUnit": ": > junit-0.xml" }),
  };
  for (const [fault, command] of Object.entries(faults)) {
    Deno.test(`coverage regression rejects ${fault}: ${scenario.filter}`, async () => {
      await checkRegression(scenario.filter, (wf) => {
        const step = shardStep(wf);
        const quotedCommand = "'" + command.replaceAll("'", "'\\''") + "'";
        step.run = `trap ${quotedCommand} EXIT\n${step.run}`;
      });
    });
  }
}

Deno.test("coverage regression explains missing shard status", async () => {
  await checkRegression("coverage shard exits successfully", (wf) => {
    const step = shardStep(wf);
    step.run = `trap 'rm -f shard-status-0.txt' EXIT\n${step.run}`;
  }, "shard command exited 0; stdout=");
});

Deno.test("coverage regression explains a missing runnable shard", async () => {
  await checkRegression("coverage shard exits successfully", (wf) => {
    delete shardStep(wf).run;
  }, "coverage job must declare a runnable test shard step");
});

const uploadFaults: Record<string, (step: Step) => void> = {
  "missing upload": (step) => {
    step.name = "Disabled upload";
  },
  "conditional upload": (step) => {
    step.if = "${{ success() }}";
  },
  "missing paths": (step) => {
    delete step.with!.path;
  },
  ...Object.fromEntries(
    ["coverage-", "junit-", "shard-status-"].map((prefix) => [
      `missing ${prefix}artifact`,
      (step: Step) => {
        step.with!.path = step.with!.path!.split("\n")
          .filter((line) => !line.startsWith(prefix)).join("\n");
      },
    ]),
  ),
};

for (const [fault, change] of Object.entries(uploadFaults)) {
  Deno.test(`coverage regression rejects ${fault}`, async () => {
    await checkRegression("coverage shard failures still upload", (wf) => {
      change(
        wf.jobs.coverage.steps.find((s) => s.name === "Upload shard artifact")!,
      );
    });
  });
}

const aggregationFaults: Record<string, (wf: Workflow) => void> = {
  "cancelled siblings": (wf) => {
    wf.jobs.coverage.strategy!["fail-fast"] = true;
  },
  "missing merge": (wf) => {
    delete wf.jobs.merge;
  },
  "missing shard dependency": (wf) => {
    wf.jobs.merge.needs = [];
  },
  "missing merge condition": (wf) => {
    wf.jobs.merge.if = "${{ success() }}";
  },
};

for (const [fault, change] of Object.entries(aggregationFaults)) {
  Deno.test(`coverage regression rejects ${fault}`, async () => {
    await checkRegression("coverage failures do not cancel siblings", change);
  });
}
