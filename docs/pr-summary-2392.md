## Summary

Warn-level clamp logs were using the 🚨 alarm emoji, which the external
GRQ-health monitor detects as an error. Clamping overflowing weights/biases is
not a genuine error — the pipeline is successfully capping the magnitude to
`MAX_SAFE_WEIGHT_BIAS`. Switched those two warnings to the 🗜️ clamp emoji so
operators can still find them quickly in logs without the dashboard flagging the
worker as `errors`. Error-level diagnostics (validation failure, topology
corruption) keep 🚨 — they remain genuine errors.

Closes #2392.

## Evidence

This is a backend logging change; the "UI" is the GRQ-health dashboard shown in
the issue screenshots, which classifies any log line containing 🚨 as an error.
Manual verification with the new tests:

```
🗜️ [loadFrom] Clamped overflowing weights/biases to ±9007199254740991 on creature unknown: 1 weight(s) (max |w|=1.1559466326634707e+195), 0 bias(es) (max |b|=0).
```

Quality gate result:
`ok | 6034 passed (2 steps) | 0 failed | 3 ignored (3m18s)`.

## Changes

- `src/creature/CreatureSerialization.ts` — load-time clamp warning now uses 🗜️.
- `src/architecture/Score.ts` — score-path overflow clamp warning now uses 🗜️.
- `src/utils/Diagnostics.ts` — documented the convention: reserve 🚨 for
  error-level logs (detected by GRQ-health), use 🗜️ for non-fatal clamp
  warnings.

## Test Plan

- Added `test/creature/ClampEmojiNotAlarm.ts` with two tests:
  - `Issue #2392: loadFrom clamp warning does not use 🚨 alarm emoji`
  - `Issue #2392: Score overflow clamp warning does not use 🚨 alarm emoji`
- Existing `test/creature/WeightBiasOverflowClamp.ts` (4 tests) and
  `test/score/WeightBiasOverflowWarning.ts` (1 test) still pass — clamp
  behaviour and UUID inclusion are unchanged.
- Full `./quality.sh --skip-discovery --skip-wasm` run: **6034 passed, 0
  failed**.
