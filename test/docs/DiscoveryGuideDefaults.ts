/**
 * Issue #3279 — docs/DISCOVERY_GUIDE.md must not mislabel discovery override
 * examples as "defaults", and any default it quotes must match source.
 *
 * The bug: the "Production-Tuned Defaults" block reproduced pre-#1386 values and
 * carried an inline `// Default: candidates must reduce error > 0.001 per
 * synapse` comment that is ~10,000× off the real `DEFAULT_COST_OF_GROWTH`
 * (0.0000001). It also quoted `discoverySampleRate: 0.05` as a default when the
 * real default is 0.2, directly contradicting docs/troubleshooting/DISCOVERY.md
 * and docs/config/DISCOVERY.md.
 *
 * These are "what" tests: they assert the real source constants, then assert the
 * published guide never restates a wrong default and points at the authoritative
 * tables so the block cannot silently drift again.
 *
 * @module
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";
import {
  DEFAULT_COST_OF_GROWTH,
  DEFAULT_DISCOVERY_SAMPLE_RATE,
} from "@config/NeatConfig.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const GUIDE = `${REPO_ROOT}/docs/DISCOVERY_GUIDE.md`;

Deno.test("Discovery defaults in source are the authoritative values", () => {
  assertEquals(DEFAULT_COST_OF_GROWTH, 0.000_000_1);
  assertEquals(DEFAULT_DISCOVERY_SAMPLE_RATE, 0.2);
});

Deno.test("DISCOVERY_GUIDE.md never restates the wrong costOfGrowth default", async () => {
  const content = await Deno.readTextFile(GUIDE);
  // The exact 10,000×-off claim the guide used to teach.
  assert(
    !content.includes("Default: candidates must reduce error > 0.001"),
    "DISCOVERY_GUIDE.md must not state 0.001 as the costOfGrowth default",
  );
  // No `// Default:` inline comment may sit on the same line as costOfGrowth:
  // 0.001 — that is the mislabel this issue fixes.
  for (const line of content.split("\n")) {
    if (line.includes("costOfGrowth") && /\/\/\s*Default/i.test(line)) {
      assert(
        !line.includes("0.001"),
        `costOfGrowth line still mislabels 0.001 as a default: ${line.trim()}`,
      );
    }
  }
});

Deno.test("DISCOVERY_GUIDE.md quotes the correct costOfGrowth default", async () => {
  const content = await Deno.readTextFile(GUIDE);
  assert(
    content.includes("0.0000001"),
    "DISCOVERY_GUIDE.md must quote the real costOfGrowth default 0.0000001 " +
      "(matches DEFAULT_COST_OF_GROWTH and docs/troubleshooting/DISCOVERY.md)",
  );
});

Deno.test("DISCOVERY_GUIDE.md reframes the block as overrides, not defaults", async () => {
  const content = await Deno.readTextFile(GUIDE);
  assert(
    !content.includes("### ⚡ Production-Tuned Defaults"),
    "The block must no longer be titled 'Production-Tuned Defaults' — it lists " +
      "illustrative overrides, not library defaults",
  );
});

Deno.test("DISCOVERY_GUIDE.md links to the authoritative defaults tables", async () => {
  const content = await Deno.readTextFile(GUIDE);
  assert(
    content.includes("config/DISCOVERY.md"),
    "DISCOVERY_GUIDE.md must link to docs/config/DISCOVERY.md for authoritative " +
      "discovery defaults",
  );
  assert(
    content.includes("config/CORE_EVOLUTION.md"),
    "DISCOVERY_GUIDE.md must link to docs/config/CORE_EVOLUTION.md for the " +
      "authoritative costOfGrowth default",
  );
});
