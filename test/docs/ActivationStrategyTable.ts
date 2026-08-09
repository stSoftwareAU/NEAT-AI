/**
 * Issue #3690 — `src/methods/activations/README.md` presents its
 * backpropagation-strategy table as the full per-squash reference (CONTRIBUTING
 * step 4 requires every new activation to add a row), but the table had drifted
 * behind the registry in `src/methods/activations/Activations.ts`: SOFTMAX was
 * registered yet undocumented.
 *
 * These tests pin the table to the registry in both directions:
 *
 *   1. Every activation the registry knows about has a row.
 *   2. Every row names an activation the registry actually knows about, so a
 *      removed or renamed squash cannot leave a stale row behind.
 *
 * Names are compared case-insensitively — the table's display casing (e.g.
 * "Complement") is cosmetic; the registry's canonical name is authoritative.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";
import { Activations } from "@methods/activations/Activations.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const README = `${REPO_ROOT}/src/methods/activations/README.md`;

/** Canonical registry names (aliases resolve to the same instance). */
function registeredNames(): Set<string> {
  return new Set(Activations.list().map((activation) => activation.getName()));
}

/**
 * Activation names in the first column of the strategy table. Header and
 * separator rows are skipped; a row qualifies only when it has the table's full
 * column count, so incidental pipes in prose are ignored.
 */
function documentedNames(markdown: string): string[] {
  const names: string[] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 7) continue;
    const name = cells[0];
    if (name === "" || name === "Activation") continue;
    if (/^:?-+:?$/.test(name)) continue;
    names.push(name);
  }
  return names;
}

Deno.test("activations README documents every registered squash", async () => {
  const markdown = await Deno.readTextFile(README);
  const documented = new Set(
    documentedNames(markdown).map((n) => n.toLowerCase()),
  );

  const missing = [...registeredNames()]
    .filter((name) => !documented.has(name.toLowerCase()))
    .sort();

  assertEquals(
    missing,
    [],
    `src/methods/activations/README.md strategy table is missing rows for: ${
      missing.join(", ")
    }`,
  );
});

Deno.test("activations README has no rows for unregistered squashes", async () => {
  const markdown = await Deno.readTextFile(README);
  const registered = new Set(
    [...registeredNames()].map((n) => n.toLowerCase()),
  );

  const orphans = documentedNames(markdown)
    .filter((name) => !registered.has(name.toLowerCase()))
    .sort();

  assertEquals(
    orphans,
    [],
    `src/methods/activations/README.md documents squashes absent from the registry: ${
      orphans.join(", ")
    }`,
  );
});

Deno.test("activations README names the registry as authoritative", async () => {
  const markdown = await Deno.readTextFile(README);
  assert(
    markdown.includes("Activations.ts"),
    "README must point readers at src/methods/activations/Activations.ts as the authoritative list",
  );
});
