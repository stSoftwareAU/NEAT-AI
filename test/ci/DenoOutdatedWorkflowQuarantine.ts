/**
 * Issue #2741 — the weekly `.github/workflows/deno-outdated.yml` workflow is
 * the only automated dep-bump path on the repo (the inline quality.yml step
 * was removed by Issue #2697). It must respect the documented dep-bump
 * quarantine: external Deno/JSR/npm versions younger than
 * VIBE_BUMP_QUARANTINE_HOURS (default 24h) must not be picked up, so a
 * freshly published malicious release cannot land in the auto-raised PR.
 *
 * `deno outdated` enforces this via `--minimum-dependency-age=<minutes>`
 * (see bump-deps.sh and docs/CORE_DEPENDENCY_POLICY.md). These tests fail if
 * the workflow runs a bare `deno outdated --update --latest` with no
 * quarantine flag.
 */

import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const DENO_OUTDATED_WORKFLOW = join(
  REPO_ROOT,
  ".github/workflows/deno-outdated.yml",
);

Deno.test(
  "deno-outdated.yml passes --minimum-dependency-age to deno outdated (Issue #2741)",
  async () => {
    const body = await Deno.readTextFile(DENO_OUTDATED_WORKFLOW);
    assert(
      /deno\s+outdated[^\n]*--minimum-dependency-age/.test(body),
      "deno-outdated.yml must run `deno outdated` with --minimum-dependency-age " +
        "so the dep-bump quarantine (VIBE_BUMP_QUARANTINE_HOURS) is enforced — " +
        "otherwise a freshly published malicious release can land in the " +
        "auto-raised PR.",
    );
  },
);

Deno.test(
  "deno-outdated.yml never runs a bare `deno outdated --update --latest` (Issue #2741)",
  async () => {
    const fullBody = await Deno.readTextFile(DENO_OUTDATED_WORKFLOW);
    // Strip YAML comment lines: the header comment legitimately describes the
    // bare command in prose. Only executable `run:` steps matter here.
    const body = fullBody
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    // Every `deno outdated --update --latest` invocation in the run: steps
    // must also carry --minimum-dependency-age. A match without the flag is a
    // quarantine bypass.
    const invocations = body.match(
      /deno\s+outdated\s+--update\s+--latest[^\n]*/g,
    ) ?? [];
    assert(
      invocations.length > 0,
      "deno-outdated.yml must still run `deno outdated --update --latest` — " +
        "it is the reviewable single source of truth for dep bumps.",
    );
    for (const inv of invocations) {
      assert(
        /--minimum-dependency-age/.test(inv),
        "deno-outdated.yml runs `deno outdated --update --latest` without " +
          `--minimum-dependency-age (quarantine bypass): ${inv.trim()}`,
      );
    }
  },
);

Deno.test(
  "deno-outdated.yml drives the quarantine from VIBE_BUMP_QUARANTINE_HOURS (Issue #2741)",
  async () => {
    const body = await Deno.readTextFile(DENO_OUTDATED_WORKFLOW);
    assert(
      /VIBE_BUMP_QUARANTINE_HOURS/.test(body),
      "deno-outdated.yml must source its quarantine window from " +
        "VIBE_BUMP_QUARANTINE_HOURS, matching bump-deps.sh and " +
        "docs/CORE_DEPENDENCY_POLICY.md.",
    );
  },
);
