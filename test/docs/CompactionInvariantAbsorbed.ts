/**
 * Issue #3286 — the two-variant (safe/aggressive) compaction invariant must
 * live in a durable doc, not only across the PR summaries that first recorded
 * it.
 *
 * The "safe variant is a guaranteed score floor, so the aggressive gamble can
 * never cost anything" rationale, plus the enumerated safe folds, was spread
 * across `pr-summary-3034.md` … `pr-summary-3038.md`. Those summaries were
 * folded into `docs/api/TRAINING.md` and then deleted. This "what" test walks
 * the real filesystem and asserts on the outcome — the invariant is captured in
 * TRAINING.md and the absorbed summaries are gone — so the rationale cannot be
 * pruned piecemeal and lost.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const TRAINING_DOC = join(REPO_ROOT, "docs", "api", "TRAINING.md");
const ARCHIVE_DIR = join(REPO_ROOT, "docs", "archive", "pr-summaries");

Deno.test("TRAINING.md captures the safe/aggressive compaction invariant (#3286)", async () => {
  const raw = await Deno.readTextFile(TRAINING_DOC);
  // Flatten blockquote markers and line wrapping so assertions do not depend on
  // where prose reflows across lines.
  const doc = raw.replace(/^\s*>\s?/gm, "").replace(/\s+/g, " ");

  // The load-bearing "safe is the floor → aggressive costs nothing" invariant.
  assertStringIncludes(
    doc,
    "aggressive gamble can never cost anything",
    "TRAINING.md must state that the safe variant is the score floor",
  );

  // The two variants, their selection entry points, and the aggressive prune
  // threshold constant.
  for (
    const term of [
      "compactVariants",
      "selectCompactVariant",
      "AGGRESSIVE_PRUNE_WEIGHT_THRESHOLD = 1e-3",
      "dataset-free",
    ]
  ) {
    assertStringIncludes(
      doc,
      term,
      `TRAINING.md must document "${term}"`,
    );
  }

  // The enumerated safe folds (constant fold, transitive fixpoint +
  // zero-varying-input collapse, exact IF-collapse).
  for (
    const fold of [
      "Constant fold into additive consumers",
      "fixpoint",
      "zero-varying-input collapse",
      "IF`-collapse",
    ]
  ) {
    assertStringIncludes(
      doc,
      fold,
      `TRAINING.md must enumerate the safe fold: "${fold}"`,
    );
  }
});

Deno.test("absorbed compaction PR summaries are deleted (#3286)", async () => {
  const checks = await Promise.all(
    [3034, 3035, 3036, 3037, 3038].map(async (n) => {
      const path = join(ARCHIVE_DIR, `pr-summary-${n}.md`);
      try {
        await Deno.stat(path);
        return { n, exists: true };
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) return { n, exists: false };
        throw err;
      }
    }),
  );

  for (const { n, exists } of checks) {
    assert(
      !exists,
      `pr-summary-${n}.md must be deleted after its invariant is absorbed ` +
        `into docs/api/TRAINING.md`,
    );
  }
});
