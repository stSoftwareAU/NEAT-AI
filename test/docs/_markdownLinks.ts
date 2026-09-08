/**
 * Shared Markdown link extraction for the `test/docs/` guards — Issue #3978.
 *
 * Several doc guards need the same thing: the relative link targets a
 * committed Markdown file points at, so the guard can assert they resolve.
 * Each copy of the extractor is a chance for the guards to disagree about
 * what counts as a link, which is the drift `test/_privateRepoRefs.ts`
 * (Issue #3604) was extracted to stop.
 *
 * @module
 */

/**
 * Relative link targets in `content` — external URLs and bare anchors are
 * skipped, and any `#fragment` is stripped from the path.
 *
 * @param content raw Markdown
 * @returns the repository-relative path of every relative link, in order
 */
export function relativeLinkTargets(content: string): string[] {
  const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
  const targets: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(content)) !== null) {
    const target = match[1];
    if (target.startsWith("http://") || target.startsWith("https://")) continue;
    if (target.startsWith("#")) continue;
    const [pathPart] = target.split("#");
    if (!pathPart) continue;
    targets.push(pathPart);
  }
  return targets;
}
