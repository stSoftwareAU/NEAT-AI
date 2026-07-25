/**
 * Issue #3453 — live (non-archive) documentation must stay self-contained for
 * public readers and must not name or link the private `stSoftwareAU` repos
 * `GRQ`, `GRQ-cluster` or `GRQ-logs`.
 *
 * A public repository is fully self-contained for the public: a doc line that
 * names or links a private repository is dead weight to every public reader —
 * the link 404s and the named file paths are unverifiable. This test walks the
 * real docs and fails if any reintroduces a private `GRQ*` reference. It
 * exercises behaviour (doc content), not the source text of any function.
 *
 * Detection is case-sensitive on the upper-case `GRQ` token so the in-tree
 * synthetic `grq-3397` scale-preset name (a fixture, not a private repo) is not
 * flagged.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/** Live docs that must not reference the private `GRQ*` repositories. */
const LIVE_DOCS = [
  "../../docs/comparison/PROS_AND_CONS.md",
  "../../docs/PROFILING_REPORT_3397.md",
  "../../docs/VERSION_VISIBILITY.md",
];

/**
 * Return every line that names or links a private `GRQ*` repository
 * (`GRQ`, `GRQ-cluster`, `GRQ-logs`). Matching is case-sensitive so the
 * lower-case in-tree `grq-3397` fixture name is not a false positive.
 *
 * @param source raw Markdown source
 * @returns 1-indexed line numbers carrying a private `GRQ*` reference
 */
export function findPrivateGrqReferences(source: string): number[] {
  const pattern = /GRQ/;
  const hits: number[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      hits.push(i + 1);
    }
  }
  return hits;
}

for (const rel of LIVE_DOCS) {
  Deno.test(`live doc ${rel} has no private GRQ reference (#3453)`, async () => {
    const path = fromFileUrl(new URL(rel, import.meta.url));
    const source = await Deno.readTextFile(path);
    const hits = findPrivateGrqReferences(source);
    assertEquals(
      hits,
      [],
      `${rel} references a private GRQ* repository on line(s) ` +
        `${hits.join(", ")}. Reword to concept level so the doc stays ` +
        `verifiable by public readers.`,
    );
  });
}

Deno.test("findPrivateGrqReferences flags GRQ-cluster and GRQ-logs", () => {
  const src = [
    "Intro line.",
    "See the GRQ-cluster network snapshot.",
    "Traced back through the GRQ-logs output.",
    "Closing line.",
  ].join("\n");
  assertEquals(findPrivateGrqReferences(src), [2, 3]);
});

Deno.test("findPrivateGrqReferences flags a bare GRQ repo name", () => {
  const src = "run the GRQ/worker/learn.sh script.\n";
  assertEquals(findPrivateGrqReferences(src), [1]);
});

Deno.test("findPrivateGrqReferences ignores the lower-case grq-3397 fixture", () => {
  const src = [
    "The synthetic `grq-3397` scale preset reproduces the dimensions.",
    "Re-running against the `grq-3397` generator must reproduce the line.",
  ].join("\n");
  assertEquals(findPrivateGrqReferences(src), []);
});

Deno.test("findPrivateGrqReferences returns empty for concept-level prose", () => {
  const src = [
    "A production-scale network snapshot (~1,670 neurons) keeps growing.",
    "The downstream production runner scripts select the scoring lane.",
  ].join("\n");
  assertEquals(findPrivateGrqReferences(src), []);
});

Deno.test("findPrivateGrqReferences returns empty for empty input", () => {
  assertEquals(findPrivateGrqReferences(""), []);
});
