/**
 * Issue #3452 — the cross-species breeding baseline evidence doc must stay
 * self-contained for public readers.
 *
 * `docs/evidence/cross-species-baseline.md` previously committed section 1:
 * a ~20-row table of commit SHAs, timestamps, evolution scores, producer
 * hosts and shared-neuron counts mined from the **private**
 * `stSoftwareAU/GRQ-cluster` repository, plus direct Markdown links to that
 * private repo and to a specific commit in it. Publishing private-derived
 * data in a public repo leaks it, and the links point public readers at a
 * repository they cannot see, so the "evidence" cannot be verified outside
 * the organisation.
 *
 * This test walks the real doc and fails if it reintroduces any link into
 * the private `GRQ-cluster` repo. It exercises behaviour (doc content), not
 * source text of any function.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const BASELINE_DOC = fromFileUrl(
  new URL("../../docs/evidence/cross-species-baseline.md", import.meta.url),
);

/**
 * Return every line that links into the private `stSoftwareAU/GRQ-cluster`
 * repository. A public evidence doc must not point readers at a repo they
 * cannot access.
 *
 * @param source raw Markdown source
 * @returns 1-indexed line numbers carrying a private-repo URL
 */
export function findPrivateRepoLinks(source: string): number[] {
  const pattern = /github\.com\/stSoftwareAU\/GRQ-cluster/i;
  const hits: number[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      hits.push(i + 1);
    }
  }
  return hits;
}

Deno.test("cross-species baseline doc has no private GRQ-cluster links (#3452)", async () => {
  const source = await Deno.readTextFile(BASELINE_DOC);
  const hits = findPrivateRepoLinks(source);
  assertEquals(
    hits,
    [],
    `docs/evidence/cross-species-baseline.md links into the private ` +
      `stSoftwareAU/GRQ-cluster repository on line(s) ${hits.join(", ")}. ` +
      `Remove private-repo-derived data and links so the evidence stays ` +
      `verifiable by public readers.`,
  );
});

Deno.test("findPrivateRepoLinks flags a private-repo URL", () => {
  const src = [
    "Intro line.",
    "See [GRQ-cluster](https://github.com/stSoftwareAU/GRQ-cluster) commit.",
    "Closing line.",
  ].join("\n");
  assertEquals(findPrivateRepoLinks(src), [2]);
});

Deno.test("findPrivateRepoLinks flags a private-repo commit URL", () => {
  const src =
    "walking back from https://github.com/stSoftwareAU/GRQ-cluster/commit/abc123.\n";
  assertEquals(findPrivateRepoLinks(src), [1]);
});

Deno.test("findPrivateRepoLinks returns empty for self-contained prose", () => {
  const src = [
    "Production commit-log analysis showed a flat trend with high noise.",
    "The self-contained baseline below uses in-tree synthetic fixtures.",
  ].join("\n");
  assertEquals(findPrivateRepoLinks(src), []);
});

Deno.test("findPrivateRepoLinks returns empty for empty input", () => {
  assertEquals(findPrivateRepoLinks(""), []);
});
