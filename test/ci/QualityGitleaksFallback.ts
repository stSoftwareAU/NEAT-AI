/**
 * Issue #3950 — `.github/workflows/quality.yml` must scan for secrets whether
 * or not an organisation gitleaks licence is available.
 *
 * `gitleaks/gitleaks-action` requires `GITLEAKS_LICENSE` on org-owned
 * repositories. Dependabot-authored pull requests receive no Actions secrets,
 * so the licence arrives empty and the action exits with `ErrLicense` before
 * scanning anything: the job is green and the diff is unscanned, which is
 * worse than no gate because it reads as covered.
 *
 * These are "what" tests. They run the workflow's own licence-detection bash
 * for both licence states, then evaluate the two scanner steps' `if:`
 * conditions against the result, asserting that exactly one scanner runs
 * either way.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOW_PATH = ".github/workflows/quality.yml";

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
}

interface Job {
  env?: Record<string, string>;
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

const LICENCE_STEP_ID = "gitleaks_licence";

async function readWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(join(REPO_ROOT, WORKFLOW_PATH));
  return parse(text) as Workflow;
}

function allSteps(wf: Workflow): { job: string; step: Step }[] {
  return Object.entries(wf.jobs ?? {}).flatMap(([job, j]) =>
    (j.steps ?? []).map((step) => ({ job, step }))
  );
}

/** The step that resolves the licence secret into a step output. */
function licenceStep(wf: Workflow): Step {
  const found = allSteps(wf).find(({ step }) => step.id === LICENCE_STEP_ID);
  assert(
    found !== undefined,
    `${WORKFLOW_PATH} has no step with id "${LICENCE_STEP_ID}" — the secrets ` +
      "context is unavailable in a step-level if:, so the licence must be " +
      "resolved into a step output first.",
  );
  return found.step;
}

/** The licensed `gitleaks-action` step, and the open-source CLI fallback. */
function scannerSteps(wf: Workflow): { licensed: Step; fallback: Step } {
  const steps = allSteps(wf).map(({ step }) => step);
  const licensed = steps.find((s) =>
    typeof s.uses === "string" && s.uses.startsWith("gitleaks/gitleaks-action@")
  );
  const fallback = steps.find((s) =>
    typeof s.run === "string" && /gitleaks-scan\.sh/.test(s.run)
  );
  assert(
    licensed !== undefined,
    `${WORKFLOW_PATH} has no gitleaks-action step`,
  );
  assert(
    fallback !== undefined,
    `${WORKFLOW_PATH} has no licence-less gitleaks CLI fallback step. The ` +
      "licensed action cannot scan a Dependabot PR, so without a fallback " +
      "the diff is unscanned and the job is still green.",
  );
  return { licensed, fallback };
}

/**
 * Run the licence-detection step's real bash body with `GITLEAKS_LICENSE` set
 * to `licence`, and return the step outputs it wrote.
 */
async function runLicenceDetection(
  body: string,
  licence: string,
): Promise<Record<string, string>> {
  const outputFile = await Deno.makeTempFile({ prefix: "neat-gh-output-" });
  try {
    const out = await new Deno.Command("bash", {
      args: ["-c", body],
      env: { GITLEAKS_LICENSE: licence, GITHUB_OUTPUT: outputFile },
      clearEnv: false,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(
      out.code,
      0,
      `licence detection failed: ${new TextDecoder().decode(out.stderr)}`,
    );
    const outputs: Record<string, string> = {};
    for (const line of (await Deno.readTextFile(outputFile)).split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return outputs;
  } finally {
    await Deno.remove(outputFile);
  }
}

/**
 * Evaluate a step `if:` condition of the simple form
 * `<context.path> == '<literal>'` (or `!=`) against a context. Anything more
 * elaborate fails loudly rather than being guessed at — this gate only exists
 * to prove the two scanner conditions are complementary.
 */
export function evaluateCondition(
  condition: string | undefined,
  context: Record<string, string>,
): boolean {
  if (condition === undefined) return true;
  const match = condition.trim().match(
    /^([A-Za-z0-9_.]+)\s*(==|!=)\s*'([^']*)'$/,
  );
  assert(
    match !== null,
    `cannot evaluate if: "${condition}" — the gitleaks scanner steps must use ` +
      "a simple `<path> == '<value>'` condition so their complementarity is " +
      "checkable.",
  );
  const [, path, operator, literal] = match;
  const actual = context[path] ?? "";
  return operator === "==" ? actual === literal : actual !== literal;
}

Deno.test("evaluateCondition handles equality, inequality and absence", () => {
  const ctx = { "steps.x.outputs.licensed": "true" };
  assertEquals(
    evaluateCondition("steps.x.outputs.licensed == 'true'", ctx),
    true,
  );
  assertEquals(
    evaluateCondition("steps.x.outputs.licensed != 'true'", ctx),
    false,
  );
  assertEquals(
    evaluateCondition("steps.y.outputs.licensed != 'true'", ctx),
    true,
  );
  assertEquals(evaluateCondition(undefined, ctx), true);
});

Deno.test({
  name:
    "quality.yml runs exactly one gitleaks scanner whether or not a licence is present (Issue #3950)",
  permissions: { read: true, write: true, run: true, env: true },
  fn: async () => {
    const wf = await readWorkflow();
    const detect = licenceStep(wf);
    assert(
      typeof detect.run === "string",
      `${WORKFLOW_PATH} step "${LICENCE_STEP_ID}" must be a run: step`,
    );
    const { licensed, fallback } = scannerSteps(wf);

    const states = [
      { description: "an organisation licence", licence: "an-org-licence-key" },
      { description: "no licence (Dependabot PR)", licence: "" },
    ] as const;
    const detected = await Promise.all(
      states.map((s) => runLicenceDetection(detect.run!, s.licence)),
    );

    for (const [index, { description }] of states.entries()) {
      const context: Record<string, string> = {};
      for (const [key, value] of Object.entries(detected[index])) {
        context[`steps.${LICENCE_STEP_ID}.outputs.${key}`] = value;
      }

      const running = [
        ["licensed action", licensed] as const,
        ["open-source CLI fallback", fallback] as const,
      ].filter(([, step]) => evaluateCondition(step.if, context))
        .map(([label]) => label);

      assertEquals(
        running.length,
        1,
        `with ${description}, expected exactly one gitleaks scanner to run; ` +
          `these ran: [${running.join(", ")}]`,
      );
    }
  },
});

Deno.test({
  name:
    "quality.yml scans with the open-source CLI when no licence is present (Issue #3950)",
  permissions: { read: true, write: true, run: true, env: true },
  fn: async () => {
    const wf = await readWorkflow();
    const detect = licenceStep(wf);
    const { fallback } = scannerSteps(wf);

    const outputs = await runLicenceDetection(detect.run!, "");
    const context = Object.fromEntries(
      Object.entries(outputs).map((
        [k, v],
      ) => [`steps.${LICENCE_STEP_ID}.outputs.${k}`, v]),
    );

    assert(
      evaluateCondition(fallback.if, context),
      "the licence-less fallback must run when GITLEAKS_LICENSE is empty — " +
        "that is the only case the licensed action cannot cover.",
    );

    // …and the script it delegates to must be present and runnable.
    const script = join(REPO_ROOT, "scripts/gitleaks-scan.sh");
    const stat = await Deno.stat(script);
    assert(stat.isFile, "scripts/gitleaks-scan.sh is missing");
  },
});

Deno.test({
  name:
    "quality.yml keeps the gitleaks licence out of job-level env (Issue #3607)",
  permissions: { read: true },
  fn: async () => {
    const wf = await readWorkflow();
    // The `quality` job executes PR-controlled code. A secret at job level is
    // in scope for every one of those steps; scoped to the steps that need it,
    // it is not.
    for (const [id, job] of Object.entries(wf.jobs ?? {})) {
      for (const [key, value] of Object.entries(job.env ?? {})) {
        assert(
          !/secrets\./.test(String(value)),
          `${WORKFLOW_PATH} job "${id}" exposes secret "${key}" at job level. ` +
            "Scope it to the steps that need it instead.",
        );
      }
    }
  },
});
