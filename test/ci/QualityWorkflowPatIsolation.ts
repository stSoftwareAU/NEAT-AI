/**
 * Issue #3607 — `.github/workflows/quality.yml` must not run PR-controlled
 * code in the same job that holds the org-level `ACTIONS_PUSH` PAT.
 *
 * `persist-credentials: false` (Issue #2727) keeps the PAT out of
 * `.git/config`, but steps within one job share the workspace, `$GITHUB_ENV`
 * and `$GITHUB_PATH`. A same-repo PR that edits `build.sh` can therefore
 * prepend a directory to `$GITHUB_PATH` and plant a `git` shim, or write a
 * repo-local git config/hook, and the later push step then executes it with
 * the PAT in its environment.
 *
 * The fix splits the workflow: a first job runs the PR-controlled checks with
 * only the default `GITHUB_TOKEN` and uploads the fmt/lint diff as an
 * artefact; a second job checks out fresh, applies that patch as data, and is
 * the only place `secrets.ACTIONS_PUSH` appears.
 *
 * These are "what" tests: they parse the committed workflow YAML and assert on
 * the resulting job/credential topology.
 */

import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOW_PATH = ".github/workflows/quality.yml";

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

interface Job {
  env?: Record<string, string>;
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

async function readWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(join(REPO_ROOT, WORKFLOW_PATH));
  return parse(text) as Workflow;
}

/**
 * Command forms that execute code checked out from the pull request. Each is
 * anchored at a statement boundary so a command *name* quoted inside an
 * argument (e.g. a commit message mentioning `deno fmt`) is not mistaken for
 * an invocation.
 */
const REPO_CODE_PATTERNS: RegExp[] = [
  // `./build.sh`, `scripts/foo.sh`, … — a script from the PR tree.
  /(?:^|[;&|(!])\s*\.{0,2}\/[\w./-]*\.(sh|bash)\b/m,
  // `bash script.sh` — but not `bash -n file` (parse only, no execution).
  /(?:^|[;&|(!])\s*(bash|sh|zsh)\s+\S*\.(sh|bash)\b/m,
  // Deno runs PR-controlled config (deno.json tasks, lint plugins, imports).
  /(?:^|[;&|(!])\s*deno\s/m,
  /(?:^|[;&|(!])\s*(npm|npx|node|pnpm|yarn|make)\s/m,
];

function stepRunsRepoCode(step: Step): boolean {
  if (typeof step.run !== "string") return false;
  return REPO_CODE_PATTERNS.some((re) => re.test(step.run as string));
}

function jobRunsRepoCode(job: Job): boolean {
  return (job.steps ?? []).some(stepRunsRepoCode);
}

/** True when `secrets.ACTIONS_PUSH` is reachable anywhere in the job. */
function jobExposesPat(job: Job): boolean {
  return /secrets\.ACTIONS_PUSH/.test(JSON.stringify(job));
}

function jobEntries(wf: Workflow): [string, Job][] {
  return Object.entries(wf.jobs ?? {});
}

Deno.test(
  "quality.yml: no job both runs PR-controlled code and holds the ACTIONS_PUSH PAT (Issue #3607)",
  async () => {
    const wf = await readWorkflow();
    const offenders = jobEntries(wf)
      .filter(([, job]) => jobExposesPat(job) && jobRunsRepoCode(job))
      .map(([id, job]) => {
        const steps = (job.steps ?? [])
          .filter(stepRunsRepoCode)
          .map((s) => `      - ${s.name ?? s.run?.trim().split("\n")[0]}`)
          .join("\n");
        return `  job "${id}" runs:\n${steps}`;
      });

    assert(
      offenders.length === 0,
      `${WORKFLOW_PATH} runs PR-controlled code in a job that holds ` +
        "secrets.ACTIONS_PUSH. Steps in one job share $GITHUB_PATH, " +
        "$GITHUB_ENV and the workspace, so PR-controlled code can plant a " +
        "shim the later push step executes with the PAT in scope. Split the " +
        "PR-controlled steps into a job that carries no PAT.\n" +
        offenders.join("\n"),
    );
  },
);

Deno.test(
  "quality.yml: no checkout fetches with the ACTIONS_PUSH PAT (Issue #3607)",
  async () => {
    const wf = await readWorkflow();
    const checkouts = jobEntries(wf).flatMap(([id, job]) =>
      (job.steps ?? [])
        .filter((s) =>
          typeof s.uses === "string" &&
          s.uses.startsWith("actions/checkout@")
        )
        .map((s) => ({ id, step: s }))
    );

    assert(
      checkouts.length > 0,
      `${WORKFLOW_PATH} expected at least one actions/checkout step`,
    );

    for (const { id, step } of checkouts) {
      const token = String(step.with?.token ?? "");
      assert(
        !/secrets\.ACTIONS_PUSH/.test(token),
        `${WORKFLOW_PATH} job "${id}" step "${step.name ?? "<unnamed>"}" ` +
          "fetches with secrets.ACTIONS_PUSH. The fetch only needs read " +
          "access, which the default GITHUB_TOKEN already provides; the push " +
          "supplies the PAT via a per-command auth header instead.",
      );
    }
  },
);

Deno.test(
  "quality.yml: the PAT-holding job executes no checked-out repository code (Issue #3607)",
  async () => {
    const wf = await readWorkflow();
    const patJobs = jobEntries(wf).filter(([, job]) => jobExposesPat(job));
    assert(
      patJobs.length === 1,
      `${WORKFLOW_PATH} must expose secrets.ACTIONS_PUSH in exactly one job; ` +
        `found ${patJobs.length}`,
    );

    // The PAT job may only check out and collect the patch artefact. Any other
    // action runs third-party code beside the PAT.
    const ALLOWED_ACTIONS = [
      "actions/checkout@",
      "actions/download-artifact@",
    ];

    const [id, job] = patJobs[0];
    for (const step of job.steps ?? []) {
      if (typeof step.uses === "string") {
        assert(
          ALLOWED_ACTIONS.some((a) => step.uses!.startsWith(a)),
          `${WORKFLOW_PATH} job "${id}" uses "${step.uses}" beside the PAT. ` +
            `Only ${ALLOWED_ACTIONS.join(", ")} are permitted in this job.`,
        );
      }
      assert(
        !stepRunsRepoCode(step),
        `${WORKFLOW_PATH} job "${id}" step "${step.name ?? "<unnamed>"}" ` +
          "executes code from the checked-out PR tree while holding the PAT.",
      );
    }
  },
);

Deno.test(
  "quality.yml: the PAT-holding job derives its push branch from the github context, not from the PR-code job (Issue #3607)",
  async () => {
    const wf = await readWorkflow();
    const [id, job] = jobEntries(wf).filter(([, j]) => jobExposesPat(j))[0];

    // The upstream job runs PR-controlled code and can write arbitrary values
    // to `$GITHUB_OUTPUT`. Anything the push job feeds to git must therefore
    // come from the github context and be re-validated locally.
    for (const step of job.steps ?? []) {
      for (const [key, value] of Object.entries(step.env ?? {})) {
        assert(
          !/needs\./.test(String(value)),
          `${WORKFLOW_PATH} job "${id}" step "${step.name ?? "<unnamed>"}" ` +
            `env "${key}" is taken from another job's outputs. That job runs ` +
            "PR-controlled code and can write arbitrary values to " +
            "$GITHUB_OUTPUT — derive the value from the github context and " +
            "re-validate it here instead.",
        );
      }
    }

    // …and it must still re-run the protected-branch guard before pushing.
    const body = (job.steps ?? []).map((s) => s.run ?? "").join("\n");
    assert(
      /PROTECTED_BRANCHES/.test(body),
      `${WORKFLOW_PATH} job "${id}" must re-run the protected-branch guard ` +
        "so a push can never target Develop/main/master.",
    );
  },
);
