/**
 * Issue #2864 — SCR-VULN-SCAN: the repo had no *scheduled, full-tree*
 * dependency vulnerability scanner. `dependency-review.yml` only inspects
 * deps that change within a PR diff and `deno-outdated.yml` is a weekly
 * freshness bump, not an advisory scan. Neither alerts us when a CVE is
 * disclosed against an exact-pinned dependency we already ship.
 *
 * `.github/workflows/osv-scan.yml` closes that detection gap: on a weekly
 * schedule (and on demand) it generates an *ephemeral* lockfile and scans the
 * resolved tree against the OSV advisory database, failing on known
 * advisories so the signal is actionable.
 *
 * These are "what" tests: they parse the committed workflow YAML (and
 * deno.json) and assert on the resulting configuration, not on how each value
 * happens to be written.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const OSV_WORKFLOW = join(REPO_ROOT, ".github/workflows/osv-scan.yml");
const DENO_JSON = join(REPO_ROOT, "deno.json");

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface Job {
  "runs-on"?: string;
  "timeout-minutes"?: number;
  permissions?: Record<string, string>;
  steps?: Step[];
}

interface Concurrency {
  group?: string;
  "cancel-in-progress"?: boolean | string;
}

interface Workflow {
  name?: string;
  // `on:` is parsed by @std/yaml as the boolean key `true`, so accept both.
  on?: unknown;
  true?: unknown;
  permissions?: Record<string, string>;
  concurrency?: Concurrency | string;
  jobs?: Record<string, Job>;
}

async function readWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(OSV_WORKFLOW);
  return parse(text) as Workflow;
}

async function readWorkflowText(): Promise<string> {
  return await Deno.readTextFile(OSV_WORKFLOW);
}

function triggers(wf: Workflow): Record<string, unknown> {
  // YAML maps the unquoted `on:` key to the boolean true.
  const on = (wf.on ?? wf.true) as Record<string, unknown> | undefined;
  assert(
    on !== undefined && typeof on === "object",
    "workflow has no on: block",
  );
  return on;
}

function allSteps(wf: Workflow): Step[] {
  const steps: Step[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) steps.push(step);
  }
  return steps;
}

Deno.test("osv-scan.yml exists and parses as YAML (Issue #2864)", async () => {
  const wf = await readWorkflow();
  assert(typeof wf === "object" && wf !== null, "osv-scan.yml did not parse");
  const jobIds = Object.keys(wf.jobs ?? {});
  assert(jobIds.length > 0, "osv-scan.yml declares no jobs");
});

Deno.test("osv-scan.yml runs on a weekly schedule (Issue #2864)", async () => {
  const wf = await readWorkflow();
  const on = triggers(wf);
  const schedule = on["schedule"] as Array<{ cron?: string }> | undefined;
  assert(
    Array.isArray(schedule) && schedule.length > 0,
    "osv-scan.yml must declare a schedule: trigger so the resolved dependency " +
      "tree is re-scanned between weekly bumps, not only on PR diffs",
  );
  for (const entry of schedule) {
    assert(
      typeof entry.cron === "string" && entry.cron.trim().length > 0,
      "each schedule entry must carry a non-empty cron expression",
    );
    const fields = entry.cron!.trim().split(/\s+/);
    assertEquals(
      fields.length,
      5,
      `cron '${entry.cron}' must have 5 fields (min hour dom mon dow)`,
    );
    // Day-of-week field pins the run to a specific weekday (weekly cadence),
    // not "every day" (*).
    assert(
      fields[4] !== "*",
      `cron '${entry.cron}' must pin a day-of-week for a weekly cadence, ` +
        `got dow='${fields[4]}'`,
    );
  }
});

Deno.test("osv-scan.yml supports manual dispatch (Issue #2864)", async () => {
  const wf = await readWorkflow();
  const on = triggers(wf);
  assert(
    "workflow_dispatch" in on,
    "osv-scan.yml should expose workflow_dispatch so the scan can be run on " +
      "demand after a fresh advisory is published",
  );
});

Deno.test("osv-scan.yml grants least-privilege permissions (Issue #2864)", async () => {
  const wf = await readWorkflow();
  const jobPerms = Object.values(wf.jobs ?? {})
    .map((j) => j.permissions)
    .find((p) => p !== undefined);
  const perms = wf.permissions ?? jobPerms;
  assert(
    perms !== undefined && typeof perms === "object",
    "osv-scan.yml must declare an explicit permissions block (least privilege)",
  );
  assertEquals(
    perms["contents"],
    "read",
    "osv-scan.yml should only need contents: read — it scans, it does not push",
  );
});

Deno.test("osv-scan.yml job declares an explicit timeout (Issue #2864)", async () => {
  const wf = await readWorkflow();
  for (const [jobId, job] of Object.entries(wf.jobs ?? {})) {
    const timeout = job["timeout-minutes"];
    assert(
      typeof timeout === "number" && Number.isInteger(timeout) && timeout > 0 &&
        timeout < 360,
      `osv-scan.yml job "${jobId}" must set a positive timeout-minutes well ` +
        `below the 360-minute GitHub default, got ${timeout}`,
    );
  }
});

Deno.test("osv-scan.yml generates an ephemeral lockfile for the scan (Issue #2864)", async () => {
  const wf = await readWorkflow();
  const runSteps = allSteps(wf)
    .map((s) => s.run)
    .filter((r): r is string => typeof r === "string");
  const body = runSteps.join("\n");
  // deno.json sets "lock": false, so the scan step must produce a transient
  // deno.lock by passing --lock explicitly.
  assert(
    /deno\s+cache[^\n]*--lock/.test(body) ||
      /deno\s+install[^\n]*--lock/.test(body),
    "osv-scan.yml must generate a lockfile via `deno cache --lock=...` (or " +
      '`deno install --lock=...`) because deno.json sets "lock": false',
  );
  assert(
    /deno\.lock/.test(body),
    "the generated lockfile must be named deno.lock so the scanner can find it",
  );
});

Deno.test("osv-scan.yml never commits the ephemeral lockfile (Issue #2864)", async () => {
  const text = await readWorkflowText();
  // Strip comment lines: prose may legitimately mention not committing.
  const code = text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  assert(
    !/git\s+add[^\n]*deno\.lock/.test(code),
    "osv-scan.yml must not `git add deno.lock` — the lockfile is transient and " +
      'deno.json\'s "lock": false policy must stay intact',
  );
  assert(
    !/git\s+commit/.test(code),
    "osv-scan.yml must not commit anything — it is a read-only scanner",
  );
});

Deno.test("osv-scan.yml invokes the OSV scanner action against the lockfile (Issue #2864)", async () => {
  const wf = await readWorkflow();
  const steps = allSteps(wf);
  const osvStep = steps.find(
    (s) => typeof s.uses === "string" && /google\/osv-scanner/.test(s.uses),
  );
  assert(
    osvStep !== undefined,
    "osv-scan.yml must run a google/osv-scanner action to scan the resolved " +
      "tree against the OSV advisory database",
  );
  const scanArgs = String(osvStep!.with?.["scan-args"] ?? "");
  assert(
    /deno\.lock/.test(scanArgs),
    "the osv-scanner step must point scan-args at the generated deno.lock",
  );
});

// Issue #2865 supersedes #2864's "lock": false assumption: the repo now
// commits a real deno.lock for transitive-dependency integrity pinning, so
// deno.json must NOT disable the lockfile. The OSV scanner still points at a
// deno.lock — now the committed one rather than an ephemeral throwaway.
Deno.test('deno.json does not disable the lockfile (Issue #2865 supersedes #2864 "lock": false)', async () => {
  const text = await Deno.readTextFile(DENO_JSON);
  const config = JSON.parse(text) as { lock?: unknown };
  assert(
    config.lock !== false,
    'deno.json must not set "lock": false — Issue #2865 commits a real ' +
      "deno.lock so transitive-dependency integrity is verified on every " +
      "cache/install/run, including the OSV scan",
  );
});
