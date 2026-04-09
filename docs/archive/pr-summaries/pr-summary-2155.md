## Summary

Add a pre-flight DNA-creature UUID compatibility check to CRISPR that catches
all missing UUID references before any creature modification occurs. Previously,
UUID incompatibilities were only discovered partway through `insert()` or
`append()` — after cloning the creature and potentially modifying neurons —
resulting in wasted work and one-at-a-time error reporting. The new
`checkDNACompatibility()` method fails fast with a single diagnostic listing
every unresolvable UUID. Closes #2155.

## Changes

- Added private `checkDNACompatibility()` method to `CRISPR` class in
  `src/reconstruct/CRISPR.ts` that:
  - Builds a known UUID set from the target creature's neurons
  - Includes neuron UUIDs defined in the DNA itself (since DNA can create new
    neurons)
  - Checks all `fromId` and `toId` references in DNA synapses against this
    combined set
  - Throws a `CrisprError` with code `MISSING_UUID` listing all unresolvable
    UUIDs (sorted)
- Called `checkDNACompatibility()` in `cleaveDNA()` before `insert()` or
  `append()`, inside the existing try/catch that handles operational
  `CrisprError`s

## Evidence

The pre-flight check is verified by 10 new test cases covering:

- Insert and append mode rejection of missing `fromId`/`toId` UUIDs
- Error messages listing all missing UUIDs (not just the first)
- DNA-defined neurons included in the UUID set (self-referencing DNA passes)
- Compatible DNA working without regression
- Non-UUID synapse references (`from`/`to`/`fromRelative`/`toRelative`)
  unaffected
- Only missing UUIDs reported (valid ones excluded from error message)
- Pre-flight errors caught before any creature modification occurs

## Test Plan

- Added `test/CRISPR/CheckDNACompatibility.ts` with 10 test cases
- All 60 existing CRISPR tests continue to pass (no regressions)
