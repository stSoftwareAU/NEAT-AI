/**
 * Strips git merge conflict markers from text, keeping the "theirs" side
 * (the section between `=======` and `>>>>>>>`) for each conflict block.
 *
 * This is useful for loading model JSON files that were left with unresolved
 * git merge/stash conflicts. The "theirs" side typically contains the newer
 * version (e.g. with UUIDs added).
 *
 * @param text - Raw text that may contain merge conflict markers
 * @returns Cleaned text with conflict markers resolved
 * @throws {Error} If a conflict marker is opened but never closed
 */
export function stripMergeConflictMarkers(text: string): string {
  const OURS_START = /^<{7}\s/;
  const SEPARATOR = /^={7}$/;
  const THEIRS_END = /^>{7}\s/;

  const lines = text.split("\n");
  const result: string[] = [];

  let inConflict = false;
  let inTheirsSection = false;

  for (const line of lines) {
    if (!inConflict) {
      if (OURS_START.test(line)) {
        inConflict = true;
        inTheirsSection = false;
        continue;
      }
      result.push(line);
    } else {
      if (SEPARATOR.test(line)) {
        inTheirsSection = true;
        continue;
      }
      if (THEIRS_END.test(line)) {
        inConflict = false;
        inTheirsSection = false;
        continue;
      }
      if (inTheirsSection) {
        result.push(line);
      }
      // Skip "ours" lines (between <<<<<<< and =======)
    }
  }

  if (inConflict) {
    throw new Error(
      "Unclosed merge conflict marker found — missing ======= or >>>>>>> line",
    );
  }

  return result.join("\n");
}
