# Remove unused export `DISCOVERY_SAMPLE_RATE_DISABLED`

## Summary

The sentinel constant `DISCOVERY_SAMPLE_RATE_DISABLED` in
`src/config/ParseOptions.ts` was exported but never imported by any other
module. A static module-graph scan across `src/**`, `test/**`, `bench/**` and
`mod.ts` found the constant is used only internally, at
`parseDiscoverySampleRate` (line 172). `ParseOptions.ts` is not re-exported from
`mod.ts` and the repository contains no `export *` barrels, so dropping the
`export` keyword cannot break any external consumer.

This change removes the `export` keyword, keeping the constant module-private,
and adds behaviour tests that pin the public `-1` "disabled" sentinel semantics
so the un-exported constant cannot silently change meaning.

Closes #3213.

## Evidence

Backend/CLI change only — no web interface to screenshot.

Verified no importers exist outside the defining file:

```
$ grep -rn "DISCOVERY_SAMPLE_RATE_DISABLED" src test bench mod.ts
src/config/ParseOptions.ts:126:const DISCOVERY_SAMPLE_RATE_DISABLED = -1;
src/config/ParseOptions.ts:172:  if (num === DISCOVERY_SAMPLE_RATE_DISABLED) {
```

The public function `parseDiscoverySampleRate` continues to honour the `-1`
disabled sentinel, confirmed by the new tests:

```
parseDiscoverySampleRate - -1 sentinel (numeric) returns -1 (disabled) ... ok
parseDiscoverySampleRate - '-1' sentinel (string) returns -1 (disabled) ... ok
ok | 9 passed | 0 failed
```

Note: an unrelated pre-existing failure in
`test/ErrorGuidedStructuralEvolution/NeuronDiscoveryIntegration.ts`
(`Unhandled variant: setWeight` from the Rust/WASM coordinated-ops path) exists
on the base branch and is independent of this change — confirmed by reproducing
it with this change stashed.

## Test Plan

- Added `parseDiscoverySampleRate - -1 sentinel (numeric) returns -1 (disabled)`
  and `parseDiscoverySampleRate - '-1' sentinel (string) returns -1 (disabled)`
  to `test/config/ParseOptionsNegativeZero.ts`, exercising the internal
  `DISCOVERY_SAMPLE_RATE_DISABLED` sentinel through the public API.
- Existing negative-zero normalisation tests continue to pass unchanged.
