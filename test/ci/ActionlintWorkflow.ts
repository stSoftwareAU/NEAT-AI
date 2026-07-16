/**
 * Issue #2762 — `.github/workflows/actionlint.yml` is the CI lint gate
 * for the `github-actions` bucket. It runs the standard GitHub Actions
 * linter (`actionlint`) on every push and pull request so that workflow
 * regressions fail the build before they land.
 *
 * Without this gate, a regression in any other workflow file (e.g. a
 * mistyped expression, a missing `permissions:` block, an unpinned
 * third-party action) would only be discovered the next time that
 * workflow runs — long after the offending PR has merged.
 *
 * This test pins down the expected shape of the workflow so the gate
 * cannot be silently removed or downgraded:
 *
 *   1. The file exists at `.github/workflows/actionlint.yml`.
 *   2. It triggers on `pull_request` (the PR gate) but NOT on `push` —
 *      this is a checker, not a deploy/release workflow, so it must not
 *      re-run on push to the default branch (`Develop`) and duplicate the
 *      run that already gated the PR (Issue #3347).
 *   3. At least one job runs the `actionlint` binary (either via an
 *      action wrapper or by invoking the binary directly).
 *   4. It declares a read-only `contents: read` permission block so the
 *      job runs under least-privilege (consistent with the other lint
 *      workflows in this repo — see Issue #2706).
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/actionlint.yml");

interface Step {
  name?: string;
  uses?: string;
  run?: string;
}

interface Job {
  "runs-on"?: string;
  steps?: Step[];
}

interface Workflow {
  name?: string;
  on?: unknown;
  permissions?: Record<string, string>;
  jobs?: Record<string, Job>;
}

async function readWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parse(text) as Workflow;
}

Deno.test("actionlint workflow file exists (Issue #2762)", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} must be a regular file`);
});

Deno.test(
  "actionlint workflow triggers on pull_request but not push (Issue #3347)",
  async () => {
    const wf = await readWorkflow();
    assert(wf.on, "actionlint workflow must declare an `on:` trigger");
    const triggers = wf.on as Record<string, unknown>;
    assert(
      "pull_request" in triggers,
      "actionlint workflow must trigger on pull_request (the PR gate)",
    );
    assert(
      !("push" in triggers),
      "actionlint is a checker, not a deploy workflow: it must NOT trigger " +
        "on push, so it does not duplicate the PR run on merge to Develop " +
        "(Issue #3347)",
    );
  },
);

// Translate a GitHub branch-filter glob into a RegExp using GitHub's
// semantics: `*` matches any run of characters except `/`, `**` matches any
// run of characters including `/`. This lets us assert on what the committed
// filter actually MATCHES rather than on the literal patterns written.
function branchGlobToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*"; // `**` crosses path separators
        i++;
      } else {
        out += "[^/]*"; // `*` stops at `/`
      }
    } else if ("\\^$.|?+()[]{}".includes(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  return new RegExp(out + "$");
}

function branchFilterMatches(branches: string[], branch: string): boolean {
  return branches.some((glob) => branchGlobToRegExp(glob).test(branch));
}

Deno.test(
  "actionlint workflow gate runs on milestone/* PRs (Issue #3359)",
  async () => {
    const wf = await readWorkflow();
    const triggers = wf.on as { pull_request?: { branches?: string[] } };
    const branches = triggers.pull_request?.branches;
    assert(
      Array.isArray(branches) && branches.length > 0,
      "actionlint pull_request trigger must declare a non-empty `branches` " +
        "filter",
    );
    // Milestone sub-issue PRs target a shared `milestone/<slug>` branch. A
    // bare `*` glob does not cross `/`, so the gate would skip those PRs and
    // they would merge into the milestone branch unchecked (Issue #3359).
    assert(
      branchFilterMatches(branches!, "milestone/example-slug"),
      "actionlint pull_request.branches must match milestone/<slug> branches " +
        "(add `milestone/*`) so the gate runs on milestone sub-issue PRs " +
        `(Issue #3359); got: ${JSON.stringify(branches)}`,
    );
  },
);

Deno.test(
  "actionlint workflow declares read-only contents permission (Issue #2762)",
  async () => {
    const wf = await readWorkflow();
    assert(
      wf.permissions,
      "actionlint workflow must declare a top-level `permissions:` block",
    );
    assertEquals(
      wf.permissions.contents,
      "read",
      "actionlint workflow must run under least-privilege contents: read",
    );
  },
);

Deno.test(
  "actionlint workflow invokes the actionlint linter (Issue #2762)",
  async () => {
    const wf = await readWorkflow();
    const jobs = wf.jobs ?? {};
    assert(
      Object.keys(jobs).length > 0,
      "actionlint workflow must declare at least one job",
    );
    let invokesActionlint = false;
    for (const job of Object.values(jobs)) {
      for (const step of job.steps ?? []) {
        const usesActionlint = (step.uses ?? "").toLowerCase().includes(
          "actionlint",
        );
        const runsActionlint = /\bactionlint\b/.test(step.run ?? "");
        if (usesActionlint || runsActionlint) {
          invokesActionlint = true;
        }
      }
    }
    assert(
      invokesActionlint,
      "actionlint workflow must include a step that runs actionlint " +
        "(either via an action wrapper or by invoking the binary directly)",
    );
  },
);

Deno.test(
  "actionlint workflow checks out the repository before linting (Issue #2762)",
  async () => {
    const wf = await readWorkflow();
    let checksOut = false;
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if ((step.uses ?? "").startsWith("actions/checkout@")) {
          checksOut = true;
        }
      }
    }
    assert(
      checksOut,
      "actionlint workflow must check out the repository so the linter " +
        "can read the workflow files under .github/workflows/",
    );
  },
);
