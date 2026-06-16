/**
 * Issue #3007 — SCR-AUTO-UPDATE: the repository had freshness-driven dependency
 * automation (`.github/workflows/deno-outdated.yml` weekly bump,
 * `bump-deps.sh` quarantine refresh) and advisory *detection*
 * (`.github/workflows/osv-scan.yml`), but no advisory-*driven* update channel.
 * When a CVE is disclosed against a pinned dependency nothing raised a targeted
 * remediation PR — the team waited for the next weekly freshness run or
 * responded manually to the OSV scan failure.
 *
 * `renovate.json` closes that remediation-automation gap: Renovate supports the
 * Deno manager (`jsr:`, `npm:`, `https://deno.land/*`) and, with
 * `osvVulnerabilityAlerts`/`vulnerabilityAlerts`, raises a dedicated PR for any
 * dependency carrying a known OSV advisory — the channel that was missing.
 *
 * These are "what" tests: they parse the committed Renovate config and assert
 * on the resulting configuration, not on how each value happens to be written.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const RENOVATE_CONFIG = join(REPO_ROOT, "renovate.json");

interface VulnerabilityAlerts {
  enabled?: boolean;
}

interface RenovateConfig {
  $schema?: string;
  extends?: string[];
  vulnerabilityAlerts?: VulnerabilityAlerts;
  osvVulnerabilityAlerts?: boolean;
}

async function readConfig(): Promise<RenovateConfig> {
  const text = await Deno.readTextFile(RENOVATE_CONFIG);
  return JSON.parse(text) as RenovateConfig;
}

Deno.test("renovate.json exists and parses as JSON (Issue #3007)", async () => {
  const config = await readConfig();
  assert(
    typeof config === "object" && config !== null,
    "renovate.json did not parse to an object",
  );
});

Deno.test("renovate.json references the Renovate schema (Issue #3007)", async () => {
  const config = await readConfig();
  assert(
    typeof config.$schema === "string" &&
      /renovate-schema\.json$/.test(config.$schema),
    "renovate.json should set $schema to the Renovate schema so editors and " +
      "Renovate validate the config",
  );
});

Deno.test("renovate.json extends a recommended preset (Issue #3007)", async () => {
  const config = await readConfig();
  assert(
    Array.isArray(config.extends) && config.extends.length > 0,
    "renovate.json must extend at least one shared preset so it inherits " +
      "sensible defaults",
  );
  assert(
    config.extends!.some((preset) => /config:recommended/.test(preset)),
    'renovate.json should extend "config:recommended" for the baseline ' +
      "Renovate behaviour",
  );
});

Deno.test("renovate.json enables the vulnerability-alert channel (Issue #3007)", async () => {
  const config = await readConfig();
  assert(
    config.vulnerabilityAlerts !== undefined &&
      typeof config.vulnerabilityAlerts === "object",
    "renovate.json must declare a vulnerabilityAlerts block to turn on the " +
      "advisory-driven update channel",
  );
  assertEquals(
    config.vulnerabilityAlerts!.enabled,
    true,
    "vulnerabilityAlerts.enabled must be true so Renovate raises remediation " +
      "PRs for dependencies with security advisories",
  );
});

Deno.test("renovate.json enables OSV-backed vulnerability alerts (Issue #3007)", async () => {
  const config = await readConfig();
  assertEquals(
    config.osvVulnerabilityAlerts,
    true,
    "osvVulnerabilityAlerts must be true so OSV advisories (the same database " +
      "osv-scan.yml detects against) raise dedicated remediation PRs — closing " +
      "the remediation-automation half of the detection loop",
  );
});
