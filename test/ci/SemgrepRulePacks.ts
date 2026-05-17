/**
 * Issue #2698 — `.github/workflows/semgrep.yml` must run at least one
 * explicitly security-focused rule pack in addition to the broad
 * correctness-oriented `p/default` pack.
 *
 * SECURITY.md advertises Semgrep as the project's SAST gate, but
 * `p/default` only lightly overlaps with security rules. Adding
 * `p/security-audit` and `p/owasp-top-ten` materially raises the bar.
 * This test guards against regression by scanning the workflow file
 * directly.
 */

import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOW = join(REPO_ROOT, ".github/workflows/semgrep.yml");

/**
 * Extract every `--config <pack>` argument from a workflow source. Returns the
 * raw pack name (e.g. `p/security-audit`) for each occurrence in document
 * order.
 */
export function extractSemgrepConfigs(source: string): string[] {
  const packs: string[] = [];
  const re = /--config\s+(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    packs.push(match[1]);
  }
  return packs;
}

Deno.test("extractSemgrepConfigs parses a single --config flag", () => {
  const packs = extractSemgrepConfigs("semgrep ci --config p/default");
  assert(packs.length === 1, `expected 1 pack, got ${packs.length}`);
  assert(packs[0] === "p/default");
});

Deno.test("extractSemgrepConfigs captures multiple packs", () => {
  const packs = extractSemgrepConfigs(
    "semgrep ci --config p/default --config p/security-audit --config p/owasp-top-ten",
  );
  assert(packs.length === 3, `expected 3 packs, got ${packs.length}`);
  assert(packs.includes("p/default"));
  assert(packs.includes("p/security-audit"));
  assert(packs.includes("p/owasp-top-ten"));
});

Deno.test("extractSemgrepConfigs returns empty for no --config flags", () => {
  const packs = extractSemgrepConfigs("semgrep ci");
  assert(packs.length === 0);
});

Deno.test(
  "semgrep.yml retains the p/default rule pack (Issue #2698)",
  async () => {
    const source = await Deno.readTextFile(WORKFLOW);
    const packs = extractSemgrepConfigs(source);
    assert(
      packs.includes("p/default"),
      `expected p/default to remain in semgrep.yml, got: ${packs.join(", ")}`,
    );
  },
);

Deno.test(
  "semgrep.yml runs a security-focused rule pack (Issue #2698)",
  async () => {
    const source = await Deno.readTextFile(WORKFLOW);
    const packs = extractSemgrepConfigs(source);
    const securityPacks = ["p/security-audit", "p/owasp-top-ten"];
    const present = securityPacks.filter((p) => packs.includes(p));
    assert(
      present.length >= 1,
      `expected at least one of ${
        securityPacks.join(", ")
      } in semgrep.yml, got: ${packs.join(", ")}`,
    );
  },
);
