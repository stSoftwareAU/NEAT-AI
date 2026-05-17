/**
 * Issue #2697 — `.github/workflows/quality.yml` must not auto-update
 * external Deno dependencies on every pull request. The previous
 * inline `deno outdated --update --latest` step pulled whatever
 * version was newest at PR run-time and then auto-committed/pushed the
 * resulting lockfile changes back to the PR branch via
 * `secrets.ACTIONS_PUSH`. A malicious JSR/npm release published shortly
 * before a PR run would be merged in automatically, bypassing
 * contributor review and the quarantine window described in the
 * repo-wide secure-coding guideline (`VIBE_BUMP_QUARANTINE_HOURS`,
 * default 24h).
 *
 * The dedicated weekly workflow `.github/workflows/deno-outdated.yml`
 * already runs `deno outdated --update --latest` on a scheduled cadence
 * and raises a separate reviewable PR. That dedicated workflow is the
 * correct single source of truth for opportunistic dep bumps.
 *
 * These tests pin the fix: quality.yml must not contain the inline
 * `deno outdated --update --latest` step, and the dedicated weekly
 * workflow must still exist.
 */

import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const QUALITY_WORKFLOW = join(REPO_ROOT, ".github/workflows/quality.yml");
const DENO_OUTDATED_WORKFLOW = join(
  REPO_ROOT,
  ".github/workflows/deno-outdated.yml",
);

Deno.test(
  "quality.yml does not run `deno outdated --update --latest` inline (Issue #2697)",
  async () => {
    const body = await Deno.readTextFile(QUALITY_WORKFLOW);
    assert(
      !/deno\s+outdated\s+--update\s+--latest/.test(body),
      "quality.yml must not run `deno outdated --update --latest` inline — " +
        "dep bumps must flow through the scheduled deno-outdated.yml workflow " +
        "so external versions are reviewed and respect the bump quarantine.",
    );
  },
);

Deno.test(
  "quality.yml does not auto-commit `deno fmt and lint fixes` containing fresh dep versions (Issue #2697)",
  async () => {
    const body = await Deno.readTextFile(QUALITY_WORKFLOW);
    // The auto-commit/push step was only dangerous because it captured
    // the lockfile changes from the inline `deno outdated --update
    // --latest` step. Once the inline update step is removed, the only
    // diff that can reach the commit step is fmt/lint output — that's
    // fine. But if anyone re-adds an "update" verb anywhere in this
    // workflow that also writes to the lockfile (`deno.lock`,
    // `deno.json`), the commit-and-push pipeline becomes a silent dep
    // bump channel again. Guard against that combination.
    const writesLock = /deno\s+(outdated|add|install|cache)\s+[^\n]*--/.test(
      body,
    ) &&
      /(deno\.lock|deno\.json)/.test(body);
    const pushesBack = /git push origin/.test(body);
    assert(
      !(writesLock && pushesBack),
      "quality.yml combines a Deno step that writes to the lockfile with a " +
        "push-back step — this re-introduces the unreviewed dep-bump channel " +
        "that Issue #2697 closed.",
    );
  },
);

Deno.test(
  "deno-outdated.yml still owns the scheduled dep-update channel (Issue #2697)",
  async () => {
    const body = await Deno.readTextFile(DENO_OUTDATED_WORKFLOW);
    assert(
      /deno\s+outdated\s+--update\s+--latest/.test(body),
      "deno-outdated.yml must keep running `deno outdated --update --latest` — " +
        "it is the reviewable single source of truth for dep bumps.",
    );
    assert(
      /peter-evans\/create-pull-request@/.test(body),
      "deno-outdated.yml must continue to raise a reviewable PR via " +
        "peter-evans/create-pull-request.",
    );
  },
);
