/**
 * Issue #3003 — the version-handling bash blocks in the publish and
 * release workflows must open with the strict-mode preamble
 * `set -Eeuo pipefail`, matching the convention used by every other
 * substantial run block in the repository's workflows.
 *
 * Without strict mode, a failure of `jq` or `curl` inside the block does
 * not abort the step: an unset or empty `name`/`version` silently
 * produces a malformed JSR meta URL, the HTTP status check falls through
 * to the permissive `else` branch, and the workflow proceeds to publish
 * on the basis of an unverified result. `-e` aborts on error, `-u`
 * catches unset variables and `-o pipefail` surfaces pipeline failures,
 * turning these silent degradations into a clean, early failure — which
 * matters in a publish workflow where acting on a wrong answer has
 * release-level consequences.
 */

import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));

interface Step {
  name?: string;
  id?: string;
  run?: string;
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

/** First non-blank, non-comment line of a run block. */
function firstCommandLine(run: string): string {
  for (const line of run.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return "";
}

// Each entry pins the workflow plus the step that performs version work
// (matched by step id where available, else by name) — the exact blocks
// the issue requires to enable strict mode.
const TARGETS = [
  {
    workflow: ".github/workflows/publish.yml",
    match: (s: Step) => s.id === "needs_publish",
    label: "Determine whether the version needs publishing",
  },
  {
    workflow: ".github/workflows/github-release.yml",
    match: (s: Step) => s.id === "version",
    label: "Read version from deno.json",
  },
];

for (const target of TARGETS) {
  Deno.test(
    `${target.workflow} "${target.label}" run block opens with set -Eeuo pipefail (Issue #3003)`,
    async () => {
      const wf = await readWorkflow(target.workflow);
      const step = collectSteps(wf).find(target.match);
      assert(
        step !== undefined,
        `${target.workflow} expected a step matching "${target.label}"`,
      );
      assert(
        typeof step.run === "string",
        `${target.workflow} step "${target.label}" expected a run: block`,
      );
      assert(
        firstCommandLine(step.run) === "set -Eeuo pipefail",
        `${target.workflow} step "${target.label}" must open its run: block ` +
          "with `set -Eeuo pipefail` so a jq/curl failure aborts the step " +
          "instead of silently publishing on an unverified result.",
      );
    },
  );
}
