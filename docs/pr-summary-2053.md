## Summary

Add explicit external interface contract tests for `exportJSON()` output to
prevent future silent breakage of fields consumed by external systems. Closes
#2053.

Issue #2049 identified that external interface fields (`uuid`, `fromUUID`,
`toUUID`) were silently removed without test failures. These contract tests
serve as a tripwire — each test names the specific field it guards, so any
removal or rename immediately surfaces as a clearly labelled test failure.

## Evidence

All 15 new contract tests pass. Full quality gate passes with 5076 tests (0
failures).

## Test Plan

New test file: `test/architecture/ExternalInterfaceContract.ts`

**Neuron export contract (5 tests):**

- Neuron export must include `uuid` field as a string
- Neuron export must include `id` field as a number
- Neuron export must include `type` field as one of hidden, output, constant
- Neuron export must include `bias` field as a number
- Output neuron `uuid` must match `output-N` pattern

**Synapse export contract (5 tests):**

- Synapse export must include `fromUUID` field as a string
- Synapse export must include `toUUID` field as a string
- Synapse export must include `fromId` field as a number
- Synapse export must include `toId` field as a number
- Synapse export must include `weight` field as a number

**Cross-system round-trip tests (3 tests):**

- Legacy consumer using only UUID fields can consume exportJSON output
- New consumer using only integer ID fields can consume exportJSON output
- Export then import then export produces identical external interface fields

**Distributed identity tests (2 tests):**

- Same JSON imported on different machines produces identical UUIDs
- Programmatically constructed creature preserves contract after round-trip
  across machines
