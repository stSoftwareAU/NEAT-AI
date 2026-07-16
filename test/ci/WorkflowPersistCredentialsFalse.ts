/**
 * Issue #2727 — workflows that check out a PR head with the
 * `ACTIONS_PUSH` PAT must NOT let `actions/checkout` persist that
 * credential into `.git/config`. With `persist-credentials: true`
 * (the default), the PAT is written to
 * `http.https://github.com/.extraheader` so any subsequent step that
 * executes PR-controlled code (e.g. `./build.sh --verify-only`) can
 * read and exfiltrate it.
 *
 * Fix: every checkout that uses `secrets.ACTIONS_PUSH` (a privileged
 * PAT) MUST set `persist-credentials: false`. The PAT is then
 * re-introduced only at push time via a per-command auth header so it
 * never lives on disk.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));

interface CheckoutWith {
  token?: string;
  "persist-credentials"?: boolean | string;
  ref?: string;
  "fetch-depth"?: number;
}

interface Step {
  name?: string;
  uses?: string;
  with?: CheckoutWith;
  run?: string;
  env?: Record<string, string>;
}

interface Job {
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

async function readWorkflow(relPath: string): Promise<Workflow> {
  const text = await Deno.readTextFile(join(REPO_ROOT, relPath));
  return parse(text) as Workflow;
}

function collectSteps(wf: Workflow): Step[] {
  const steps: Step[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      steps.push(step);
    }
  }
  return steps;
}

function isCheckoutStep(step: Step): boolean {
  return typeof step.uses === "string" &&
    step.uses.startsWith("actions/checkout@");
}

function usesActionsPushPat(step: Step): boolean {
  const tok = step.with?.token ?? "";
  return /secrets\.ACTIONS_PUSH/.test(tok);
}

const SENSITIVE_WORKFLOWS = [
  ".github/workflows/quality.yml",
  ".github/workflows/update-package-version.yml",
];

for (const workflow of SENSITIVE_WORKFLOWS) {
  Deno.test(
    `${workflow} checkout with ACTIONS_PUSH must set persist-credentials: false (Issue #2727)`,
    async () => {
      const wf = await readWorkflow(workflow);
      const checkoutSteps = collectSteps(wf).filter(isCheckoutStep);
      assert(
        checkoutSteps.length > 0,
        `${workflow} expected at least one actions/checkout step`,
      );
      for (const step of checkoutSteps) {
        if (!usesActionsPushPat(step)) continue;
        const persist = step.with?.["persist-credentials"];
        assertEquals(
          persist,
          false,
          `${workflow} step "${step.name ?? "<unnamed>"}" checks out with ` +
            `secrets.ACTIONS_PUSH but does not set persist-credentials: false. ` +
            "Without this, the PAT is written to .git/config and any later " +
            "step that runs PR-controlled code can exfiltrate it.",
        );
      }
    },
  );
}

/**
 * Issue #3349 — the benchmark smoke job only reads the repo and uploads an
 * artifact; it never pushes back or fetches private submodules. The default
 * `persist-credentials: true` still writes the workflow `GITHUB_TOKEN` into
 * `.git/config`, where a later step running PR-controlled code (e.g.
 * `./build.sh --verify-only`) could read it. The read-only checkout must set
 * `persist-credentials: false` so the token never lands on disk.
 */
Deno.test(
  ".github/workflows/bench.yaml smoke checkout must set persist-credentials: false (Issue #3349)",
  async () => {
    const wf = await readWorkflow(".github/workflows/bench.yaml");
    const checkoutSteps = collectSteps(wf).filter(isCheckoutStep);
    assert(
      checkoutSteps.length > 0,
      "bench.yaml expected at least one actions/checkout step",
    );
    for (const step of checkoutSteps) {
      assertEquals(
        step.with?.["persist-credentials"],
        false,
        `bench.yaml step "${step.name ?? "<unnamed>"}" must set ` +
          "persist-credentials: false. This job only reads the repo and " +
          "uploads an artifact, so persisting the GITHUB_TOKEN to " +
          ".git/config only widens the blast radius of a compromised step.",
      );
    }
  },
);

/**
 * Issue #3350 — the coverage shard job only reads the repo, runs the test
 * suite, and uploads a per-shard artifact; it never pushes back or fetches
 * private submodules. The default `persist-credentials: true` still writes the
 * workflow `GITHUB_TOKEN` into `.git/config`, where a later step running
 * PR-controlled code (e.g. `./build.sh --verify-only`) could read it. The
 * read-only checkout must set `persist-credentials: false`.
 *
 * Scoped to the `coverage` job only — the sibling `merge` job is tracked
 * separately (Issue #3351).
 */
Deno.test(
  ".github/workflows/coverage.yaml coverage-job checkout must set persist-credentials: false (Issue #3350)",
  async () => {
    const wf = await readWorkflow(".github/workflows/coverage.yaml");
    const job = wf.jobs?.coverage;
    assert(job, "coverage.yaml expected a `coverage` job");
    const checkoutSteps = (job.steps ?? []).filter(isCheckoutStep);
    assert(
      checkoutSteps.length > 0,
      "coverage job expected at least one actions/checkout step",
    );
    for (const step of checkoutSteps) {
      assertEquals(
        step.with?.["persist-credentials"],
        false,
        `coverage job step "${step.name ?? "<unnamed>"}" must set ` +
          "persist-credentials: false. This job only reads the repo, runs " +
          "tests, and uploads an artifact, so persisting the GITHUB_TOKEN to " +
          ".git/config only widens the blast radius of a compromised step.",
      );
    }
  },
);

/**
 * Issue #3351 — the coverage `merge` job only checks out the repo, downloads
 * every shard's artifacts, merges the partial coverage + JUnit reports, and
 * uploads them to Codecov; it never pushes back or fetches private submodules.
 * The default `persist-credentials: true` still writes the workflow
 * `GITHUB_TOKEN` into `.git/config`, where a later step running PR-controlled
 * code could read it. The read-only checkout must set
 * `persist-credentials: false`.
 *
 * Scoped to the `merge` job only — the sibling `coverage` shard job is tracked
 * separately (Issue #3350).
 */
Deno.test(
  ".github/workflows/coverage.yaml merge-job checkout must set persist-credentials: false (Issue #3351)",
  async () => {
    const wf = await readWorkflow(".github/workflows/coverage.yaml");
    const job = wf.jobs?.merge;
    assert(job, "coverage.yaml expected a `merge` job");
    const checkoutSteps = (job.steps ?? []).filter(isCheckoutStep);
    assert(
      checkoutSteps.length > 0,
      "merge job expected at least one actions/checkout step",
    );
    for (const step of checkoutSteps) {
      assertEquals(
        step.with?.["persist-credentials"],
        false,
        `merge job step "${step.name ?? "<unnamed>"}" must set ` +
          "persist-credentials: false. This job only reads the repo, merges " +
          "shard artifacts, and uploads to Codecov, so persisting the " +
          "GITHUB_TOKEN to .git/config only widens the blast radius of a " +
          "compromised step.",
      );
    }
  },
);

/**
 * Issue #3352 — the dependency-review job only checks out the repo and runs
 * `actions/dependency-review-action` to scan changed dependency manifests; it
 * never pushes back or fetches private submodules. The default
 * `persist-credentials: true` still writes the workflow `GITHUB_TOKEN` into
 * `.git/config`, where a later step running PR-controlled code could read it.
 * The read-only checkout must set `persist-credentials: false`.
 */
Deno.test(
  ".github/workflows/dependency-review.yml checkout must set persist-credentials: false (Issue #3352)",
  async () => {
    const wf = await readWorkflow(".github/workflows/dependency-review.yml");
    const job = wf.jobs?.["dependency-review"];
    assert(job, "dependency-review.yml expected a `dependency-review` job");
    const checkoutSteps = (job.steps ?? []).filter(isCheckoutStep);
    assert(
      checkoutSteps.length > 0,
      "dependency-review job expected at least one actions/checkout step",
    );
    for (const step of checkoutSteps) {
      assertEquals(
        step.with?.["persist-credentials"],
        false,
        `dependency-review job step "${step.name ?? "<unnamed>"}" must set ` +
          "persist-credentials: false. This job only reads the repo and " +
          "scans dependency manifests, so persisting the GITHUB_TOKEN to " +
          ".git/config only widens the blast radius of a compromised step.",
      );
    }
  },
);

/**
 * Issue #3353 — the github-release `release` job only reads the version from
 * deno.json and creates a GitHub Release via `softprops/action-gh-release`
 * (which authenticates with the token passed via env, not from `.git/config`);
 * it never pushes back or fetches private submodules. The default
 * `persist-credentials: true` still writes the workflow `GITHUB_TOKEN` into
 * `.git/config`, where a later step running compromised code could read it.
 * The read-only checkout must set `persist-credentials: false`.
 */
Deno.test(
  ".github/workflows/github-release.yml checkout must set persist-credentials: false (Issue #3353)",
  async () => {
    const wf = await readWorkflow(".github/workflows/github-release.yml");
    const job = wf.jobs?.release;
    assert(job, "github-release.yml expected a `release` job");
    const checkoutSteps = (job.steps ?? []).filter(isCheckoutStep);
    assert(
      checkoutSteps.length > 0,
      "release job expected at least one actions/checkout step",
    );
    for (const step of checkoutSteps) {
      assertEquals(
        step.with?.["persist-credentials"],
        false,
        `release job step "${step.name ?? "<unnamed>"}" must set ` +
          "persist-credentials: false. This job only reads the version and " +
          "creates a GitHub Release, so persisting the GITHUB_TOKEN to " +
          ".git/config only widens the blast radius of a compromised step.",
      );
    }
  },
);

function isGitPushStep(step: Step): boolean {
  if (typeof step.run !== "string") return false;
  return /\bgit\b/.test(step.run) && /\bpush\s+origin\b/.test(step.run);
}

Deno.test(
  "quality.yml push step re-introduces ACTIONS_PUSH via env (Issue #2727)",
  async () => {
    const wf = await readWorkflow(".github/workflows/quality.yml");
    const steps = collectSteps(wf);
    const pushSteps = steps.filter(isGitPushStep);
    assert(
      pushSteps.length > 0,
      "quality.yml expected at least one push step that runs git push",
    );
    for (const step of pushSteps) {
      const envVals = Object.values(step.env ?? {}).join("\n");
      assert(
        /secrets\.ACTIONS_PUSH/.test(envVals),
        `quality.yml push step "${step.name ?? "<unnamed>"}" must re-` +
          "introduce secrets.ACTIONS_PUSH via the step env: map so the PAT " +
          "is only in scope for the push itself, not for any earlier step " +
          "that runs PR-controlled code.",
      );
      assert(
        typeof step.run === "string" && /extraheader/i.test(step.run),
        `quality.yml push step "${step.name ?? "<unnamed>"}" must pass the ` +
          "PAT via a per-command `git -c http.<url>.extraheader=...` header " +
          "so it never lives on disk in .git/config.",
      );
    }
  },
);

Deno.test(
  "update-package-version.yml push step re-introduces ACTIONS_PUSH via env (Issue #2727)",
  async () => {
    const wf = await readWorkflow(
      ".github/workflows/update-package-version.yml",
    );
    const steps = collectSteps(wf);
    const pushSteps = steps.filter(isGitPushStep);
    assert(
      pushSteps.length > 0,
      "update-package-version.yml expected at least one push step",
    );
    for (const step of pushSteps) {
      const envVals = Object.values(step.env ?? {}).join("\n");
      assert(
        /secrets\.ACTIONS_PUSH/.test(envVals),
        `update-package-version.yml push step "${
          step.name ?? "<unnamed>"
        }" must re-introduce secrets.ACTIONS_PUSH via the step env: map.`,
      );
      assert(
        typeof step.run === "string" && /extraheader/i.test(step.run),
        `update-package-version.yml push step "${
          step.name ?? "<unnamed>"
        }" must pass the PAT via a per-command ` +
          "`git -c http.<url>.extraheader=...` header.",
      );
    }
  },
);
