## Summary

Extracted three independent compaction strategies out of the monolithic
`src/compact/CompactCreature.ts` (previously 658 lines) so each can be tested
and evolved in isolation. The orchestrator now composes helpers from dedicated
modules; no behavioural change. Closes #2397.

New modules under `src/compact/`:

- `CloneCreatureExport.ts` — shared `cloneCreatureExport` helper, re-exported
  from `CompactUtils.ts` per acceptance criteria.
- `SimplifyLargeWeights.ts` — `simplifyLargeWeights` +
  `calculateWeightBiasPenalty`.
- `RemoveBackwardSynapses.ts` — backward-synapse removal for feed-forward mode.

`ParallelIdentityMerge.ts` and `ParallelBridgeMerge.ts` were already split, so
no further isolation was needed there.

`CompactCreature.ts` is now 392 lines and delegates to the extracted strategies
(vs. 658 before — a 40% reduction). It no longer imports activation-specific or
scoring helpers that belonged to the simplify pass.

## Evidence

Backend/library change — no UI. Tested via the full quality gate.

- `deno test test/compact/*.ts` → **142 passed, 0 failed**.
- `./quality.sh --skip-wasm --skip-discovery` → **6049 passed, 0 failed, 3
  ignored** (lint, fmt, type-check, full test suite).

Line counts:

| File                                    | Before | After |
| --------------------------------------- | ------ | ----- |
| `src/compact/CompactCreature.ts`        | 658    | 392   |
| `src/compact/CloneCreatureExport.ts`    | —      | 73    |
| `src/compact/SimplifyLargeWeights.ts`   | —      | 197   |
| `src/compact/RemoveBackwardSynapses.ts` | —      | 69    |

## Test Plan

- Added `test/compact/CloneCreatureExport.ts` — happy path (tagged,
  forward-only, memetic-bearing export) and minimal-input edge case; asserts
  mutation of the clone does not bleed back into the source.
- Added `test/compact/SimplifyLargeWeights.ts` — rescale-and-reduce-penalty
  happy path, no-op for balanced weights, no-op for non-homogeneous squash
  (TANH), plus `calculateWeightBiasPenalty` zero-count edge case.
- Added `test/compact/RemoveBackwardSynapses.ts` — removes exactly the backward
  synapses in a mixed creature, plus no-op on an already feed-forward network.
- Existing `test/compact/CompactCreatureSimplifyLargeWeights.ts` and
  `CompactCreatureIntegrity.ts` continue to pass against the refactored
  orchestrator.
