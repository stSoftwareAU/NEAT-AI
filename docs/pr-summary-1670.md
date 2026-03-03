## Summary

Expand CRISPR test coverage for 10 previously untested code paths, covering
`cleaveDNA()`, `insert()`, `append()`, `editAliases()`, and the
`deepCloneAndShuffle` integration. Closes #1670.

## Evidence

All 4395 tests pass (including 10 new tests) via `./quality.sh`. No UI changes
— this is a test-only change verified by test output.

## Test Plan

New test file: `test/CRISPR/CRISPRUntestedPaths.ts` with 10 test scenarios:

1. **Validation failure fallback** — `cleaveDNA` returns original creature when
   insert references non-existent UUID
2. **Idempotency via synapse tags** — DNA whose id matches a synapse CRISPR tag
   is detected as already processed
3. **UUID unchanged** — no `CRISPR-SOURCE`/`CRISPR-DNA` tags when modification
   produces no structural change
4. **Duplicate UUID in insert** — neuron with existing UUID is skipped (not
   duplicated) during insert
5. **Output neuron rejection in insert** — `validateDNA` throws clear error for
   insert-mode DNA containing output neurons
6. **UUID collision in append** — hidden neuron with colliding UUID gets
   re-assigned via `crypto.randomUUID()`
7. **Missing output index in append** — output neurons without `index` field are
   handled gracefully
8. **No-match aliases** — aliases not matching any UUID produce unchanged DNA
9. **Empty aliases map** — empty `Record<string, string>` produces unchanged DNA
10. **CRISPRs survive deepCloneAndShuffle** — user-provided CRISPRs survive the
    round-trip used in `Neat` constructor
