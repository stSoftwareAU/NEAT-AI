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
 *
 * Issue #3615 extends the guard beyond the three hard-coded docs above: every
 * live doc under `docs/` (outside `docs/archive/`) is walked for an
 * **org-qualified** private reference — a `stSoftwareAU/GRQ*` repo slug, a
 * `github.com/stSoftwareAU/GRQ*` link, or a `GRQ#NNNN` issue slug. Those are
 * the forms a reader can act on and be 404'd by, notably the
 * `gh search code … --repo stSoftwareAU/GRQ` commands the option-audit slices
 * shipped. A bare `GRQ` mnemonic (`GRQ-22` host, `GRQ-cluster` topology) still
 * names a concept rather than pointing at an unreachable page, matching the
 * #3454/#3604 decision recorded in `test/_privateRepoRefs.ts`.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { walk } from "@std/fs";

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

/**
 * Match an org-qualified private `GRQ*` reference — a `stSoftwareAU/GRQ*` repo
 * slug (with or without a `github.com/` prefix) or a `GRQ#NNNN` issue slug.
 * Bare mnemonics such as `GRQ-22` are deliberately not matched.
 */
const ORG_QUALIFIED_GRQ_PATTERN = /stSoftwareAU\/GRQ|GRQ#\d+/;

/**
 * Return every line carrying an org-qualified private `GRQ*` reference.
 *
 * @param source raw Markdown source
 * @returns 1-indexed line numbers with an org-qualified `GRQ*` reference
 */
export function findOrgQualifiedGrqReferences(source: string): number[] {
  const hits: number[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (ORG_QUALIFIED_GRQ_PATTERN.test(lines[i])) {
      hits.push(i + 1);
    }
  }
  return hits;
}

const DOCS_DIR = fromFileUrl(new URL("../../docs", import.meta.url));
const ARCHIVE_DIR = fromFileUrl(new URL("../../docs/archive", import.meta.url));

Deno.test("no live doc carries an org-qualified private GRQ reference (#3615)", async () => {
  const offenders: string[] = [];
  for await (
    const entry of walk(DOCS_DIR, { exts: [".md"], includeDirs: false })
  ) {
    if (entry.path.startsWith(ARCHIVE_DIR)) continue;
    const hits = findOrgQualifiedGrqReferences(
      await Deno.readTextFile(entry.path),
    );
    if (hits.length > 0) {
      offenders.push(
        `${entry.path.slice(DOCS_DIR.length + 1)}:${hits.join(",")}`,
      );
    }
  }
  assertEquals(
    offenders.sort(),
    [],
    `Live docs name the private stSoftwareAU/GRQ repository:\n` +
      `${offenders.join("\n")}\n` +
      `Reword to concept level (e.g. "the downstream production consumer") ` +
      `and use a "<consumer-repo>" placeholder in example commands so the ` +
      `documented method stays runnable by public readers.`,
  );
});

Deno.test("findOrgQualifiedGrqReferences flags a repo slug and a gh search command", () => {
  const src = [
    "Consumers were confirmed from `deno.json`: `stSoftwareAU/GRQ` pins",
    'gh search code "<key>" --repo stSoftwareAU/GRQ --limit 20',
    "Closing line.",
  ].join("\n");
  assertEquals(findOrgQualifiedGrqReferences(src), [1, 2]);
});

Deno.test("findOrgQualifiedGrqReferences flags an issue slug and a repo link", () => {
  const src = [
    "is filed there as **stSoftwareAU/GRQ#3793**.",
    "See https://github.com/stSoftwareAU/GRQ-cluster/blob/main/net.json.",
  ].join("\n");
  assertEquals(findOrgQualifiedGrqReferences(src), [1, 2]);
});

Deno.test("findOrgQualifiedGrqReferences ignores bare mnemonics and empty input", () => {
  const src = [
    "The downstream production consumer sets `populationSize`.",
    "GRQ-22 host snapshot: 16 GB total, 10 CPUs.",
    "The synthetic `grq-3397` scale preset reproduces the dimensions.",
  ].join("\n");
  assertEquals(findOrgQualifiedGrqReferences(src), []);
  assertEquals(findOrgQualifiedGrqReferences(""), []);
});

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
