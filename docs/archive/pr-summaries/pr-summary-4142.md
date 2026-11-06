## Summary

The live-doc privacy guard now scans every Markdown file under `docs/` (outside
`docs/archive/`) with the shared `scanForPrivateRepoRefs` from
`test/_privateRepoRefs.ts`, the same detector the archive guard uses. It
therefore also flags the un-prefixed private repo names the Issue #3617 decision
covers, which the old org-qualified-only pattern missed. Closes #4142.

Version bump: not applicable; test-only change.

## Spec

### Intent and Rationale

- The live docs are read more than the archive, yet were held to a weaker rule.
  Using the shared scanner removes the second, drifted pattern instead of
  widening it by hand.

### Essential Design Decisions

- The local org-qualified pattern and its helper were deleted, not kept
  alongside the shared scanner, so there is one definition of "private
  reference" for live docs.
- The walk is an exported function taking the docs directory, so a temporary
  fixture tree can exercise the real code path.

### Undiscoverable Facts

- No live doc currently trips the wider rule, so no doc rewording was needed.

## Evidence

Test-only change; no UI or performance surface. Verified by running the guard
tests.

## Test Plan

- Modified `test/docs/LiveDocsNoPrivateGrqReference.ts`: the real-tree test now
  calls `scanLiveDocsForPrivateRepoRefs`; added a fixture test
  (`scanLiveDocsForPrivateRepoRefs flags un-prefixed GRQ repo names, skips
  archive...`)
  with a positive control where the same line, reworded, is clean.
- Red check: with the scan filtered to org-qualified forms only, the fixture
  test failed (actual `TIMEOUTS.md:2`, `sub/OTHER.md:3` against expected `[]`);
  restored afterwards.
- Removed from `test/docs/LiveDocsNoPrivateGrqReference.ts`: the three
  `findOrgQualifiedGrqReferences ...` unit tests.
  - Obsolete: the helper was replaced by the shared scanner.
  - Still covered by:
    `test/docs/LiveDocsNoPrivateGrqReference.ts::scanLiveDocsForPrivateRepoRefs`
    fixture tests (repo slug and search command, issue slug and link, bare
    mnemonics ignored) and `test/docs/PrivateRepoRefScanner.ts`.
- Ran `deno fmt --check`, `deno lint`, `deno check` on the file, and the five
  `test/docs/*PrivateRepo*`/`NoPrivateGrq*` guard files: 44 passed, 0 failed.
- `./quality.sh < /dev/null` could not run: it stops at "Native rust_scorer is
  required (quality.sh default) but was not found" in this environment. CI runs
  the full gate.
