## Summary

Removed the unused export `filterCachedCandidates` from
`src/discovery/FailureCache.ts`. Static dead-code analysis flagged it as an
unused export, and a whole-repo search
(`grep -rn "filterCachedCandidates"
--include="*.ts"`) confirmed the function
had **no in-repo importer**, was not re-exported from `mod.ts`, and was not
referenced by any test or dynamic/ reflective lookup — only the declaration
itself existed. Deleting it removes dead code with no behavioural impact.

The helper it relied on, `isCandidateCachedSync`, remains in place — it is a
public export still used by tests and other call sites, so it is unaffected.

Closes #3062.

## Evidence

This is a backend/library change with no web interface to screenshot. Verified
instead via:

- **Whole-repo reference search** —
  `grep -rn "filterCachedCandidates"
  --include="*.ts" .` returns no matches
  after removal (previously only the declaration line).
- **Type-check** — `deno check src/discovery/FailureCache.ts` passes.
- **Full quality gate** — `./quality.sh` passes cleanly: **7356 passed, 0
  failed, 4 ignored**.

## Test Plan

No new tests are required — this is a pure dead-code removal of an export with
zero callers. The existing `FailureCache` test suite
(`test/discovery/FailureCacheOperations.ts`,
`test/discovery/FailureCacheErrorReduction.ts`,
`test/discovery/FailureCacheKeys.ts`, and related specs) continues to pass,
confirming the remaining cache functions (`isCandidateCached`,
`isCandidateCachedSync`, `recordFailure`, `recordFailureSync`, `buildCacheKey`)
are intact and behave as before.
