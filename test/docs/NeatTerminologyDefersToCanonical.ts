/**
 * Issue #3289 — the "NEAT-AI ≠ NEAT" terminology admonition was restated in
 * full across 11 live docs, giving the same normative rule 11 copies that drift
 * apart over time. `AGENTS.md` § "🆚 NEAT vs NEAT-AI — which term to use" is the
 * one canonical statement; every other doc must *defer* to it with a concise
 * link rather than re-state the rule (or re-cite the founding 2002 paper).
 *
 * These are behavioural "what" tests, in the spirit of ComparisonSplit.ts and
 * DiscoveryGuides.ts:
 *
 *   1. AGENTS.md actually defines the canonical rule heading (so the anchor the
 *      other docs link to resolves to a real section).
 *   2. Each governed doc's terminology callout links to that canonical anchor.
 *   3. Each governed doc's terminology callout is a concise deferral — it must
 *      not re-embed the Stanley & Miikkulainen (2002) paper citation, which is
 *      the boilerplate the canonical rule already owns. This guards against the
 *      restated-paragraph duplication returning.
 *
 * The assertions target the structure of the terminology callout (its link and
 * the absence of a re-cited paper URL), not the exact wording of its summary
 * sentence, so a reword of the one-line summary does not break the test.
 */

import { assert } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");

// Anchor GitHub generates for the canonical AGENTS.md heading.
const CANON_ANCHOR = "-neat-vs-neat-ai--which-term-to-use";
const CANON_HEADING = "### 🆚 NEAT vs NEAT-AI — which term to use";
// The founding-paper citation the canonical rule owns; a deferring callout must
// not re-embed it.
const PAPER_URL_MARKER = "stanley.ec02.pdf";

// Live (non-archive) docs that must defer to the one canonical rule.
const GOVERNED_DOCS: ReadonlyArray<string> = [
  "docs/README.md",
  "docs/GLOSSARY.md",
  "COMPARISON.md",
  "docs/comparison/ARCHITECTURES.md",
  "docs/comparison/ECOSYSTEM.md",
  "docs/comparison/TRAINING_PARADIGMS.md",
  "docs/comparison/PROS_AND_CONS.md",
  "docs/comparison/IMPLEMENTED.md",
  "docs/comparison/UNIQUE_APPROACHES.md",
  "docs/comparison/FUTURE_WORK.md",
  "docs/comparison/REFERENCES.md",
];

/** Return the `> [!IMPORTANT]` blockquote that carries the NEAT-AI ≠ NEAT rule. */
function extractTerminologyCallout(content: string): string {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "> [!IMPORTANT]") {
      const block: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith(">")) {
        block.push(lines[j]);
        j++;
      }
      const text = block.join("\n");
      if (text.includes("NEAT-AI ≠ NEAT")) return text;
    }
  }
  return "";
}

Deno.test("AGENTS.md is the single canonical home of the NEAT vs NEAT-AI rule", async () => {
  const agents = await Deno.readTextFile(`${REPO_ROOT}/AGENTS.md`);
  assert(
    agents.includes(CANON_HEADING),
    "AGENTS.md must define the canonical '🆚 NEAT vs NEAT-AI — which term to use' heading",
  );
});

Deno.test("governed docs defer to the canonical NEAT vs NEAT-AI rule", async () => {
  const docs = await Promise.all(
    GOVERNED_DOCS.map(async (rel) => ({
      rel,
      content: await Deno.readTextFile(`${REPO_ROOT}/${rel}`),
    })),
  );
  for (const { rel, content } of docs) {
    const callout = extractTerminologyCallout(content);
    assert(
      callout !== "",
      `${rel} must contain a NEAT-AI ≠ NEAT terminology callout`,
    );
    assert(
      callout.includes(CANON_ANCHOR),
      `${rel} callout must link to the canonical rule (${CANON_ANCHOR})`,
    );
    assert(
      !callout.includes(PAPER_URL_MARKER),
      `${rel} callout must defer to AGENTS.md, not re-cite the 2002 paper — ` +
        `this is the restated-paragraph duplication issue #3289 removes`,
    );
  }
});
