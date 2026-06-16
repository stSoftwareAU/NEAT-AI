/**
 * Issue #3006 — the multi-line bash blocks in the markdown-lint workflow
 * must open with the strict-mode preamble `set -Eeuo pipefail`, matching
 * the convention used by every other substantial run block in the
 * repository's workflows (publish.yml and github-release.yml were brought
 * into line by Issue #3003).
 *
 * The "Detect Deno worker module" step writes a step output that later
 * steps gate on. Without strict mode a failure inside the block does not
 * abort the step: an unset or empty value silently flows into the
 * conditional steps. `-e` aborts on error, `-u` catches unset variables
 * and `-o pipefail` surfaces pipeline failures, turning these silent
 * degradations into a clean, early failure.
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

const TARGET = {
  workflow: ".github/workflows/markdown-lint.yml",
  match: (s: Step) => s.id === "detect-deno",
  label: "Detect Deno worker module",
};

Deno.test(
  `${TARGET.workflow} "${TARGET.label}" run block opens with set -Eeuo pipefail (Issue #3006)`,
  async () => {
    const wf = await readWorkflow(TARGET.workflow);
    const step = collectSteps(wf).find(TARGET.match);
    assert(
      step !== undefined,
      `${TARGET.workflow} expected a step matching "${TARGET.label}"`,
    );
    assert(
      typeof step.run === "string",
      `${TARGET.workflow} step "${TARGET.label}" expected a run: block`,
    );
    assert(
      firstCommandLine(step.run) === "set -Eeuo pipefail",
      `${TARGET.workflow} step "${TARGET.label}" must open its run: block ` +
        "with `set -Eeuo pipefail` so a failing command aborts the step " +
        "instead of silently writing a stale step output.",
    );
  },
);
