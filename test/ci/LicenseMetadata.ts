import { assert, assertEquals } from "@std/assert";

/**
 * Verifies the SPDX licence metadata added for Issue #3189.
 *
 * `@stsoftware/neat-ai` is published to JSR, so `deno.json` is consumer-facing
 * metadata. Without a machine-readable `license` field, JSR's package page,
 * SBOM generators, and dependency-licence scanners cannot cross-check the
 * licence against the committed `LICENSE` file and must fall back to
 * heuristics. These tests lock in that the manifest declares the exact SPDX
 * short code matching the Apache-2.0 `LICENSE` file.
 */

interface DenoConfig {
  license?: string;
}

async function loadDenoConfig(): Promise<DenoConfig> {
  return JSON.parse(await Deno.readTextFile("deno.json")) as DenoConfig;
}

Deno.test("deno.json declares an SPDX license field", async () => {
  const config = await loadDenoConfig();
  assertEquals(
    config.license,
    "Apache-2.0",
    "deno.json should declare the SPDX short code `Apache-2.0`",
  );
});

Deno.test("declared license agrees with the committed LICENSE file", async () => {
  const config = await loadDenoConfig();
  const license = await Deno.readTextFile("LICENSE");

  assert(
    license.includes("Apache License") && license.includes("Version 2.0"),
    "LICENSE file should be Apache License, Version 2.0",
  );
  assertEquals(
    config.license,
    "Apache-2.0",
    "manifest license must match the Apache-2.0 LICENSE file",
  );
});
