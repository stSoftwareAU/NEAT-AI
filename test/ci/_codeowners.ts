/**
 * Shared CODEOWNERS reader/parser for the governance tests (Issues #3187,
 * #3669).
 *
 * Extracted so both `CodeownersWorkflowsCoverage.ts` and
 * `CodeownersPrivilegedJobCoverage.ts` can resolve owners without one test file
 * importing another (which would register the same tests twice).
 */

import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));

/** Locations GitHub scans for a CODEOWNERS file, in precedence order. */
export const CODEOWNERS_LOCATIONS = [
  "CODEOWNERS",
  ".github/CODEOWNERS",
  "docs/CODEOWNERS",
];

export interface CodeownersRule {
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
