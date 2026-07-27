/**
 * Issue #3454 — source and test comments must stay self-contained for public
 * readers.
 *
 * `stSoftwareAU/GRQ` is a **private** repository, so a `GRQ#NNNN` issue-tracker
 * slug (or a "GRQ repo" / "GRQ shell" pointer) in a comment sends a public
 * reader to a page they cannot open. Behaviour being guarded should be
 * described at concept level instead; where in-repo traceability matters, cite
 * this repository's own issues/PRs.
 *
 * This test walks the real `src/` and `test/` trees and fails if any file
 * reintroduces a private GRQ issue-tracker slug or repo pointer. It exercises
 * behaviour (committed file content), not the source text of any function.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { walk } from "@std/fs";

const SRC_DIR = fromFileUrl(new URL("../../src", import.meta.url));
const TEST_DIR = fromFileUrl(new URL("../../test", import.meta.url));

/**
 * Private-repo *detector* tests — this guard plus its siblings that must embed
 * the forbidden `GRQ` patterns verbatim as fixtures and test names to verify
 * their own detection logic. They are the audit, not offenders, so scanning them
 * would be a self-referential false positive. Any new detector test that carries
 * literal pattern fixtures belongs here.
 */
const DETECTOR_TESTS = new Set(
  [
    import.meta.url,
    new URL("./LiveDocsNoPrivateGrqReference.ts", import.meta.url).href,
    new URL("./CrossSpeciesBaselineNoPrivateRepo.ts", import.meta.url).href,
    new URL("./ArchiveDocsNoPrivateRepoSlugs.ts", import.meta.url).href,
    new URL("./ArchiveDocsNoPrivateRepoReference.ts", import.meta.url).href,
    new URL("./ArchivedDocsNoPrivateRepoReference.ts", import.meta.url).href,
    new URL("../scripts/BumpDepsNoPrivateRepoReference.ts", import.meta.url)
      .href,
  ].map(fromFileUrl),
);

/**
 * Match a private `stSoftwareAU/GRQ` issue-tracker slug (`GRQ#3295`,
 * `stSoftwareAU/GRQ#3298`) or a pointer at the private repo's shell
 * ("the GRQ repo", "the GRQ shell").
 */
const PRIVATE_GRQ_PATTERN = /GRQ#\d+|GRQ repo|GRQ[- ]shell/i;

/**
 * Return every 1-indexed line number carrying a private GRQ issue-tracker slug
 * or repo pointer.
 *
 * @param source raw file content
 * @returns 1-indexed line numbers with a private-GRQ reference
 */
export function findPrivateGrqRefs(source: string): number[] {
  const hits: number[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PRIVATE_GRQ_PATTERN.test(lines[i])) {
      hits.push(i + 1);
    }
  }
  return hits;
}

async function scanTree(root: string): Promise<string[]> {
  const offenders: string[] = [];
  for await (
    const entry of walk(root, { exts: [".ts"], includeDirs: false })
  ) {
    if (DETECTOR_TESTS.has(entry.path)) continue;
    const source = await Deno.readTextFile(entry.path);
    const hits = findPrivateGrqRefs(source);
    if (hits.length > 0) {
      offenders.push(`${entry.path}:${hits.join(",")}`);
    }
  }
  return offenders;
}

Deno.test("no private GRQ issue-tracker slugs or repo pointers in src/ or test/ (#3454)", async () => {
  const offenders = [
    ...(await scanTree(SRC_DIR)),
    ...(await scanTree(TEST_DIR)),
  ];
  assertEquals(
    offenders,
    [],
    `Found private stSoftwareAU/GRQ issue-tracker slugs or repo pointers in:\n` +
      `${offenders.join("\n")}\n` +
      `Reword to concept level (describe the behaviour guarded) and cite this ` +
      `repository's own issues/PRs where traceability matters.`,
  );
});

Deno.test("findPrivateGrqRefs flags a GRQ# issue slug", () => {
  const src = [
    "Intro line.",
    " * Issue GRQ#3295: automatic Discovery worker-memory envelope.",
    "Closing line.",
  ].join("\n");
  assertEquals(findPrivateGrqRefs(src), [2]);
});

Deno.test("findPrivateGrqRefs flags an org-qualified GRQ# slug", () => {
  const src = " * (stSoftwareAU/GRQ#3298, part of the OOM guard).\n";
  assertEquals(findPrivateGrqRefs(src), [1]);
});

Deno.test("findPrivateGrqRefs flags a GRQ repo pointer", () => {
  const src =
    " * The runner (`run.sh`, in the GRQ repo) exports the envelope.\n";
  assertEquals(findPrivateGrqRefs(src), [1]);
});

Deno.test("findPrivateGrqRefs returns empty for self-contained prose", () => {
  const src = [
    " * A Discovery worker was OOM-killed on a 16 GB production host, so the",
    " * external production runner exports a host-derived memory envelope.",
    " * GRQ-22 host snapshot: 16 GB total, 10 CPUs.",
  ].join("\n");
  assertEquals(findPrivateGrqRefs(src), []);
});

Deno.test("findPrivateGrqRefs returns empty for empty input", () => {
  assertEquals(findPrivateGrqRefs(""), []);
});
