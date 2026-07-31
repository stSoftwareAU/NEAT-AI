/**
 * Shared private-repo reference scanner for the #3455 (archived docs) and
 * #3458 (dependency-bump automation) guards — Issue #3604.
 *
 * A public repository is fully self-contained for the public: archived PR
 * summaries and live automation ship in every public clone, so a private
 * issue-tracker slug or a link into a private `stSoftwareAU` repository sends
 * the reader to a page they cannot open. Seven near-duplicate guards each
 * carried their own copy of this scanner and had already drifted apart, so the
 * detectors silently disagreed about what was forbidden. This module is the
 * single source of truth; the guards only supply the files to scan.
 *
 * @module
 */

/**
 * Match a reference a public reader cannot follow:
 *
 * - a private issue-tracker slug (`GRQ#3472`, `VibeCoding#1613`, and their
 *   org-qualified forms);
 * - an org-qualified private repo path (`stSoftwareAU/GRQ-cluster`,
 *   `stSoftwareAU/VibeCoding`);
 * - a link into a private repository
 *   (`github.com/stSoftwareAU/GRQ-cluster/blob/...`).
 *
 * Deliberately **not** matched — these name a concept rather than pointing at
 * an unreachable page, consistent with the #3454 mnemonic decision:
 *
 * - the public `stSoftwareAU/NEAT-AI` repository;
 * - a bare `stSoftwareAU/GRQ` / `stSoftwareAU/GRQ-logs` repo name used to
 *   identify the downstream consumer or its log store (no `#` slug, no link);
 * - bare host/log/preset mnemonics (`GRQ-21`, `GRQ-3-rocket.log`) and the
 *   lower-case in-tree `grq-3397` scale-preset fixture — matching is
 *   case-sensitive on the upper-case repo tokens.
 */
export const PRIVATE_REPO_PATTERN =
  /(?:GRQ|VibeCoding)#\d+|stSoftwareAU\/(?:GRQ-cluster|VibeCoding)|github\.com\/stSoftwareAU\/(?:GRQ|VibeCoding)/;

/**
 * Return every 1-indexed line number carrying a private-repo issue slug,
 * org-qualified private repo path or private-repo link.
 *
 * @param source raw file content (Markdown, shell or TypeScript)
 * @returns 1-indexed line numbers with a private-repo reference
 */
export function findPrivateRepoRefs(source: string): number[] {
  const hits: number[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PRIVATE_REPO_PATTERN.test(lines[i])) {
      hits.push(i + 1);
    }
  }
  return hits;
}

/**
 * Scan files on disk and report the offenders. Reads are synchronous so a
 * whole-tree scan cannot burst hundreds of concurrent file descriptors while
 * the suite runs in parallel.
 *
 * @param paths paths to scan
 * @returns one `path:line,line` entry per file carrying a private-repo
 *          reference; empty when every file is clean
 */
export function scanForPrivateRepoRefs(paths: readonly string[]): string[] {
  const offenders: string[] = [];
  for (const path of paths) {
    const hits = findPrivateRepoRefs(Deno.readTextFileSync(path));
    if (hits.length > 0) {
      offenders.push(`${path}:${hits.join(",")}`);
    }
  }
  return offenders;
}
