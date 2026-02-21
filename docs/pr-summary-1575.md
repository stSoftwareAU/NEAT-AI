## Summary

Fixed prototype-polluting assignment vulnerability (CodeQL alert #111) in `CreatureSerialization.ts`. The `Object.assign` calls on lines 132 and 182-185 could allow an attacker to inject `__proto__`, `constructor`, or `prototype` keys via crafted trace JSON data, potentially polluting `Object.prototype`. Replaced `Object.assign` with explicit property-by-property copying that skips unsafe keys. Closes #1575.

## Evidence

This is a backend security fix with no UI changes. The fix was verified by:
- 3 new tests that inject `__proto__` and `constructor` keys into trace data and confirm `Object.prototype` remains unpolluted
- All 4294 existing tests continue to pass

## Test Plan

- Added `test/creature/PrototypePollution.ts` with 3 tests:
  - `loadFrom - neuron trace with __proto__ key does not pollute Object.prototype`
  - `loadFrom - synapse trace with __proto__ key does not pollute Object.prototype`
  - `loadFrom - trace with constructor key does not pollute prototype`
