/**
 * Issue #3667 — the repository has two dependency-update paths and only one of
 * them honoured the 24 h supply-chain quarantine.
 *
 * `bump-deps.sh` (and `quality.sh`) pass
 * `--minimum-dependency-age=$((VIBE_BUMP_QUARANTINE_HOURS * 60))` to
 * `deno outdated`, so Deno/JSR bumps raised by those scripts are embargoed.
 * Renovate, by contrast, ran with a six-line `config:recommended` config and no
 * `minimumReleaseAge`, so it could raise — and a maintainer could merge — an
 * update PR the moment a version was published. GitHub Actions had no
 * quarantine at all (`bump-deps.sh` never touches `.github/workflows/*`), and
 * Renovate's `deno` manager could race the gated script path.
 *
 * These are "what" tests: they parse the committed `renovate.json` and
 * `deno.json` and assert on the resulting configuration, not on how each value
 * happens to be written.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const RENOVATE_JSON = join(REPO_ROOT, "renovate.json");
const DENO_JSON = join(REPO_ROOT, "deno.json");

interface PackageRule {
  description?: string;
  matchManagers?: string[];
  matchPackageNames?: string[];
  enabled?: boolean;
  minimumReleaseAge?: string | null;
}

interface RenovateConfig {
  minimumReleaseAge?: string;
  stabilityDays?: number;
  vulnerabilityAlerts?: { enabled?: boolean };
  packageRules?: PackageRule[];
}

interface MinimumDependencyAge {
  age?: string;
  exclude?: string[];
}

interface DenoConfig {
  minimumDependencyAge?: MinimumDependencyAge;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

const readRenovate = () => readJson<RenovateConfig>(RENOVATE_JSON);
const readDeno = () => readJson<DenoConfig>(DENO_JSON);

/** Parse a Renovate duration string ("24 hours", "3 days") into hours. */
function durationToHours(value: string): number {
  const match = /^\s*(\d+)\s*(minute|hour|day|week)s?\s*$/i.exec(value);
  if (!match) return Number.NaN;
  const amount = Number(match[1]);
  switch (match[2].toLowerCase()) {
    case "minute":
      return amount / 60;
    case "hour":
      return amount;
    case "day":
      return amount * 24;
    default:
      return amount * 24 * 7;
  }
}

Deno.test(
  "renovate.json sets a top-level quarantine of at least 24 hours (Issue #3667)",
  async () => {
    const config = await readRenovate();
    const declared = config.minimumReleaseAge ??
      (config.stabilityDays === undefined
        ? undefined
        : `${config.stabilityDays} days`);
    assert(
      declared !== undefined,
      "renovate.json must set minimumReleaseAge so Renovate cannot raise a " +
        "same-day update PR for a freshly published (possibly hijacked) release",
    );
    const hours = durationToHours(declared);
    assert(
      Number.isFinite(hours),
      `minimumReleaseAge "${declared}" is not a parseable Renovate duration`,
    );
    assert(
      hours >= 24,
      `minimumReleaseAge must be at least 24 hours to match ` +
        `VIBE_BUMP_QUARANTINE_HOURS, got ${hours}h`,
    );
  },
);

Deno.test(
  "renovate.json disables the deno manager so it cannot race the gated path (Issue #3667)",
  async () => {
    const config = await readRenovate();
    const rules = config.packageRules ?? [];
    const denoRule = rules.find((rule) =>
      rule.matchManagers?.includes("deno") && rule.enabled === false
    );
    assert(
      denoRule !== undefined,
      "renovate.json must carry a packageRules entry with " +
        'matchManagers: ["deno"] and enabled: false — Deno/JSR deps are ' +
        "governed by bump-deps.sh --minimum-dependency-age, and an ungated " +
        "Renovate deno manager can land a bump the script would have embargoed",
    );
  },
);

Deno.test(
  "renovate.json exempts internal stSoftwareAU deps from the quarantine (Issue #3667)",
  async () => {
    const config = await readRenovate();
    const rules = config.packageRules ?? [];
    const internalRule = rules.find((rule) =>
      rule.matchPackageNames?.some((pattern) =>
        /stSoftwareAU/i.test(pattern)
      ) && rule.minimumReleaseAge !== undefined
    );
    assert(
      internalRule !== undefined,
      "renovate.json must carry a packageRules entry matching stSoftwareAU/* " +
        "that overrides minimumReleaseAge — internal first-party code ships " +
        "with no embargo (Issue #1613 classification)",
    );
    const override = internalRule!.minimumReleaseAge;
    // Renovate types minimumReleaseAge as string|null, so null is the only
    // schema-valid way to say "no embargo" — "0" and false are rejected both by
    // Renovate's schema and by semgrep's renovate-missing-minimum-release-age.
    assertEquals(
      override,
      null,
      'the internal-deps override must be null, not "0" or false — those are ' +
        "outside Renovate's string|null schema and trip the semgrep " +
        "renovate-missing-minimum-release-age rule",
    );
    assertEquals(
      durationToHours(String(override ?? "0")) || 0,
      0,
      "internal stSoftwareAU deps must have a zero-length quarantine",
    );
  },
);

Deno.test(
  "renovate.json keeps the vulnerability-alert channel enabled (Issue #3667)",
  async () => {
    const config = await readRenovate();
    assertEquals(
      config.vulnerabilityAlerts?.enabled,
      true,
      "vulnerabilityAlerts must stay enabled — Renovate exempts security " +
        "fixes from minimumReleaseAge, so adding the quarantine must not slow " +
        "an actively-exploited CVE fix (Issue #3007)",
    );
  },
);

Deno.test(
  "deno.json declares the native minimumDependencyAge window (Issue #3667)",
  async () => {
    const config = await readDeno();
    const window = config.minimumDependencyAge;
    assert(
      window !== undefined && typeof window === "object",
      "deno.json must declare minimumDependencyAge so a bare " +
        "`deno outdated --update` outside bump-deps.sh still inherits the " +
        "quarantine window",
    );
    assertEquals(
      window!.age,
      "P1D",
      'minimumDependencyAge.age must be the ISO-8601 one-day window "P1D" — ' +
        '"24 hours" is rejected by `deno check`',
    );
    const exclude = window!.exclude ?? [];
    for (const expected of ["jsr:@stsoftware/*", "npm:@stsoftware/*"]) {
      assert(
        exclude.includes(expected),
        `minimumDependencyAge.exclude must contain "${expected}" so internal ` +
          "stSoftwareAU deps update immediately (0h quarantine)",
      );
    }
  },
);
