/**
 * Issue #3007 — SCR-AUTO-UPDATE: the security-update channel was off. The repo
 * had *freshness-driven* dependency automation (`deno-outdated.yml` raises a
 * weekly PR for whatever is newest) and *advisory detection*
 * (`osv-scan.yml` fails CI when a CVE is disclosed against the resolved tree),
 * but nothing turned "an advisory exists" into "a fix PR is waiting for
 * review". The mean-time-to-patch was therefore bounded by the weekly
 * freshness cadence rather than by how fast a maintainer can review a focused
 * security bump.
 *
 * `renovate.json` closes that remediation-automation gap. Renovate supports
 * the Deno manager (jsr:, npm:, https://deno.land/*) and, with
 * `osvVulnerabilityAlerts` enabled, raises a dedicated PR for any dependency
 * carrying a known OSV advisory — the advisory-driven channel that was
 * missing. The freshness job (`deno-outdated.yml`) is left intact for routine
 * bumps.
 *
 * These are "what" tests: they parse the committed renovate.json and assert on
 * the resulting configuration, not on how each value happens to be written.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const RENOVATE_JSON = join(REPO_ROOT, "renovate.json");

interface RenovateConfig {
  $schema?: string;
  extends?: string[];
  vulnerabilityAlerts?: { enabled?: boolean };
  osvVulnerabilityAlerts?: boolean;
}

async function readRenovate(): Promise<RenovateConfig> {
  const text = await Deno.readTextFile(RENOVATE_JSON);
  return JSON.parse(text) as RenovateConfig;
}

Deno.test("renovate.json exists and parses as JSON (Issue #3007)", async () => {
  const config = await readRenovate();
  assert(
    typeof config === "object" && config !== null,
    "renovate.json did not parse as a JSON object",
  );
});

Deno.test("renovate.json references the Renovate schema (Issue #3007)", async () => {
  const config = await readRenovate();
  assert(
    typeof config.$schema === "string" &&
      /renovate-schema\.json/.test(config.$schema),
    "renovate.json should set $schema to the Renovate schema so editors " +
      "validate the config",
  );
});

Deno.test("renovate.json extends a base preset (Issue #3007)", async () => {
  const config = await readRenovate();
  assert(
    Array.isArray(config.extends) && config.extends.length > 0,
    "renovate.json should extend a base preset (e.g. config:recommended) so " +
      "it inherits sensible defaults rather than re-deriving them",
  );
});

Deno.test("renovate.json enables vulnerability alerts (Issue #3007)", async () => {
  const config = await readRenovate();
  assert(
    config.vulnerabilityAlerts !== undefined &&
      typeof config.vulnerabilityAlerts === "object",
    "renovate.json must declare a vulnerabilityAlerts block",
  );
  assertEquals(
    config.vulnerabilityAlerts!.enabled,
    true,
    "renovate.json must enable vulnerabilityAlerts so security updates are " +
      "raised as PRs — this is the advisory-driven channel that was missing",
  );
});

Deno.test("renovate.json enables OSV-backed vulnerability alerts (Issue #3007)", async () => {
  const config = await readRenovate();
  assertEquals(
    config.osvVulnerabilityAlerts,
    true,
    "renovate.json must set osvVulnerabilityAlerts: true so any dependency " +
      "with a known OSV advisory gets a dedicated remediation PR, closing the " +
      "gap left by the detection-only osv-scan.yml",
  );
});
