## Summary

Added `test/architecture/DeDuplicator.ts` with focused unit tests for the shared
`DeDuplicator` data structure on the breeding/compaction hot path. The existing
`test/architecture/DenseNumberMap.ts` was reviewed and already covers the
acceptance criteria in the issue (construction, get/set/has/clear,
auto-grow/sparse-dense boundary, and edge cases); no changes were required
there.

Closes #2400.

## Evidence

CLI / library change — no UI to screenshot. Behaviour verified by the new test
suite:

```
$ deno test --allow-all --no-check test/architecture/DeDuplicator.ts
...
ok | 7 passed | 0 failed (13ms)

$ deno test --allow-all --no-check test/architecture/DenseNumberMap.ts
...
ok | 20 passed | 0 failed (2ms)
```

`./quality.sh --skip-discovery --skip-wasm --lint-only` and `--check-only` pass
cleanly against the new file.

## Test Plan

New `test/architecture/DeDuplicator.ts`:

- **Happy path** — populates 5 unique + 10 duplicate creatures, asserts all
  survivors are unique by UUID.
- **Idempotence** — runs `perform()` twice and asserts the array length and UUID
  order are unchanged on the second pass.
- **Empty input** — empty array stays empty.
- **Single-element edge case** — lone creature is preserved with UUID intact.
- **All-unique input** — 20 unique creatures, order and count preserved.
- **Large-input stress** — 300 creatures with 80% duplicates, all survivors
  unique, well under the 120 s budget.
- **UUID assignment** — `perform()` stamps a UUID on every creature that did not
  already have one.

Each assertion targets observable state (array length, UUID set, ordering), not
implementation details, per AGENTS.md "what vs how" testing guidance. No timing
APIs are used.
