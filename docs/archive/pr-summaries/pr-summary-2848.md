## Summary

Replaced a benchmark masquerading as a unit test in
`test/methods/activations/SquashLookupTable.ts`. The old case
`"Squash lookup table - performance comparable to original"` warmed up a
creature, ran a 1000-iteration `creature.activate()` timing loop wrapped in
`performance.now()`, printed per-iteration time via `console.log`, and finished
with the tautological assertion `timePerIteration > 0` — which any running loop
satisfies. The case verified no correctness, slowed the unit suite, and emitted
log noise (test-audit anti-pattern #4).

It is now rewritten as a proper WHAT-test
(`"Squash lookup table - large creature produces finite output for varied
inputs"`)
that asserts the observable behaviour the surrounding tests care about: the
`traced.json` creature — which exercises many lookup-table squash functions —
produces a finite output of the expected width for a deterministic spread of
varied inputs. The timing loop, warm-up, `console.log`, and non-deterministic
`Math.random` inputs are all removed; throughput measurement belongs in a
dedicated benchmark, not the unit runner.

Closes #2848.

## Evidence

Backend/test-only change — no UI to screenshot. Verified via the test runner.

Before: 1000-iteration timing loop + warm-up, single tautological assertion,
`console.log` noise. After: deterministic finite-output assertions; file runs in
~15ms.

```
running 5 tests from ./test/methods/activations/SquashLookupTable.ts
Squash lookup table - WASM activation runs ... ok
Squash lookup table - activation produces correct output ... ok
Squash lookup table - consistent with traced.json creature ... ok
Squash lookup table - handles all non-inline squash functions ... ok
Squash lookup table - large creature produces finite output for varied inputs ... ok
ok | 5 passed | 0 failed
```

## Test Plan

- Rewrote
  `test/methods/activations/SquashLookupTable.ts::"Squash lookup table -
  large creature produces finite output for varied inputs"`
  to assert output width and finiteness across 16 deterministic input vectors,
  replacing the former timing-loop case.
- Ran the file: 5 passed / 0 failed.
- Ran the full `./quality.sh` gate (fmt, lint, type-check, tests).
