/**
 * Issue #3187 — the repository must ship a `CODEOWNERS` file that requires a
 * trusted reviewer on every change to the privileged CI/CD surface under
 * `.github/workflows/` (and `.github/actions/`).
 *
 * Several workflows run with credentials far beyond `GITHUB_TOKEN`:
 * `publish.yml` and `pages.yml` request `id-token: write` (JSR OIDC / Pages),
 * while `quality.yml` and `update-package-version.yml` expose the
 * write-scoped `secrets.ACTIONS_PUSH` PAT. Without a CODEOWNERS rule covering
 * these paths, a single careless or compromised account could open a PR that
 * quietly edits a workflow which then exfiltrates those secrets the moment CI
 * fires. Requiring a named code owner's review closes that path.
 *
 * This test pins down the governance guarantee so it cannot be silently
 * removed:
 *
 *   1. A CODEOWNERS file exists in one of the three locations GitHub
 *      recognises (`CODEOWNERS`, `.github/CODEOWNERS`, `docs/CODEOWNERS`).
 *   2. The workflows directory resolves to at least one owner.
 *   3. Every owner token is a valid `@user` / `@org/team` reference (so the
 *      rule actually enforces instead of being ignored by GitHub).
 */

import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));

/** Locations GitHub scans for a CODEOWNERS file, in precedence order. */
const CODEOWNERS_LOCATIONS = [
  "CODEOWNERS",
  ".github/CODEOWNERS",
  "docs/CODEOWNERS",
];

interface CodeownersRule {
  pattern: string;
  owners: string[];
}

/** Read the first CODEOWNERS file found, or null when none exists. */
export async function readCodeowners(): Promise<
  { path: string; source: string } | null
> {
  const reads = CODEOWNERS_LOCATIONS.map(async (rel) => {
    try {
      const source = await Deno.readTextFile(join(REPO_ROOT, rel));
      return { path: rel, source };
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  });
  // Precedence order: first existing location wins.
  const results = await Promise.all(reads);
  return results.find((r) => r !== null) ?? null;
}

/** Parse CODEOWNERS text into ordered { pattern, owners } rules. */
export function parseCodeowners(source: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const rawLine of source.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const [pattern, ...owners] = line.split(/\s+/);
    if (!pattern) continue;
    rules.push({ pattern, owners });
  }
  return rules;
}

/** Convert a CODEOWNERS/gitignore-style pattern to an anchored RegExp. */
function patternToRegExp(pattern: string): RegExp {
  const anchoredToRoot = pattern.startsWith("/");
  const core = pattern.replace(/^\/+/, "").replace(/\/+$/, "");

  const escaped = core
    .split("/")
    .map((segment) =>
      segment
        .split("*")
        .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*")
    )
    .join("/");

  const prefix = anchoredToRoot ? "^/?" : "^(?:.*/)?";
  // Match the file/dir itself and, for a directory pattern, everything beneath.
  return new RegExp(prefix + escaped + "(?:/.*)?$");
}

/** Owners for a path using CODEOWNERS last-match-wins semantics. */
export function ownersFor(rules: CodeownersRule[], path: string): string[] {
  let owners: string[] = [];
  for (const rule of rules) {
    if (patternToRegExp(rule.pattern).test(path)) owners = rule.owners;
  }
  return owners;
}

const OWNER_TOKEN = /^@[A-Za-z0-9-]+(?:\/[A-Za-z0-9._-]+)?$/;

Deno.test("CODEOWNERS file exists in a recognised location (Issue #3187)", async () => {
  const file = await readCodeowners();
  assert(
    file !== null,
    `A CODEOWNERS file must exist in one of: ${
      CODEOWNERS_LOCATIONS.join(", ")
    }`,
  );
});

Deno.test("CODEOWNERS covers the workflows directory (Issue #3187)", async () => {
  const file = await readCodeowners();
  assert(file !== null, "CODEOWNERS file is required");
  const rules = parseCodeowners(file.source);

  const owners = ownersFor(rules, ".github/workflows/publish.yml");
  assert(
    owners.length > 0,
    "`.github/workflows/` must resolve to at least one code owner",
  );
});

Deno.test("CODEOWNERS covers the composite actions directory (Issue #3187)", async () => {
  const file = await readCodeowners();
  assert(file !== null, "CODEOWNERS file is required");
  const rules = parseCodeowners(file.source);

  const owners = ownersFor(rules, ".github/actions/setup/action.yml");
  assert(
    owners.length > 0,
    "`.github/actions/` must resolve to at least one code owner",
  );
});

Deno.test("every CODEOWNERS owner is a valid @user or @org/team (Issue #3187)", async () => {
  const file = await readCodeowners();
  assert(file !== null, "CODEOWNERS file is required");
  const rules = parseCodeowners(file.source);

  assert(rules.length > 0, "CODEOWNERS must declare at least one rule");
  for (const rule of rules) {
    assert(
      rule.owners.length > 0,
      `Rule "${rule.pattern}" must name at least one owner`,
    );
    for (const owner of rule.owners) {
      assert(
        OWNER_TOKEN.test(owner),
        `Owner "${owner}" for "${rule.pattern}" must be a @user or @org/team reference`,
      );
    }
  }
});

// A code owner must have write access or GitHub silently ignores the rule and
// enforces no review. The `maintainers` team suggested by some templates does
// not exist in the stSoftwareAU org, so pointing a rule at it would leave the
// CI/CD surface unprotected. Guard against that regression explicitly.
const NONEXISTENT_TEAM = /^@[A-Za-z0-9-]+\/maintainers$/i;

Deno.test("CODEOWNERS does not reference the non-existent 'maintainers' team (Issue #3187)", async () => {
  const file = await readCodeowners();
  assert(file !== null, "CODEOWNERS file is required");
  const rules = parseCodeowners(file.source);

  for (const rule of rules) {
    for (const owner of rule.owners) {
      assert(
        !NONEXISTENT_TEAM.test(owner),
        `Owner "${owner}" for "${rule.pattern}" references a 'maintainers' team ` +
          "that does not exist in the stSoftwareAU org. A code owner must have " +
          "write access, otherwise GitHub ignores the rule and no review is " +
          "enforced. Use @stSoftwareAU/developers instead.",
      );
    }
  }
});
