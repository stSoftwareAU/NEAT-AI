## Summary

Remove junk files from the repository root and fix a test that wrote to a
non-hidden directory. Closes #2102.

Two empty junk files were committed in the ts-rust-migration merge (commit
`0926664c`):

- `exportedJSON.neurons.find((neuron) => neuron.id === 5003)!.squash =`
- `quantiseBuffer is deterministic (same input => same output) ... ok (0ms)`

These appear to be accidental artifacts (a code expression and a test output
line) that were created during the large merge process and inadvertently
committed. No code in the repository actively produces them.

Additionally, `test/costs/CustomCost.ts` was the only test writing to a
non-hidden directory (`./test/custom_cost_data`). Updated it to use
`.test/custom-cost` instead, consistent with the existing convention that all
test output goes to hidden (`.`-prefixed) directories which are covered by
`.gitignore`.

## Evidence

- Searched the entire codebase for `Deno.writeTextFile`, `Deno.writeFile`,
  `Deno.mkdir`, etc. in test, bench, and src directories. All test output
  already targets hidden directories except the fixed `CustomCost.ts`.
- The junk file names match a code expression from test fixtures (neuron id
  5003) and a Deno test output line, confirming they are accidental artifacts.

## Test Plan

- All 5168 existing tests pass after changes
- `test/costs/CustomCost.ts` now writes to `.test/custom-cost` (hidden,
  gitignored) instead of `./test/custom_cost_data`
