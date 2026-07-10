# Fix wrong defaults and mislabelled semantics in `docs/api/CONFIGURATION.md`

## Summary

The config-key reference table in `docs/api/CONFIGURATION.md` had drifted from
the source of truth in `src/config/NeatConfig.ts`, listing wrong defaults and
mislabelling what several knobs control. Reconciled each row against the code
(and, where a sibling `docs/config/*` doc already documents the value, linked to
it so the two copies stop drifting). Closes #3277.

Corrections:

| Field                              | Was                              | Now                                                        | Source of truth                                        |
| ---------------------------------- | -------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `threads` default                  | `navigator.hardwareConcurrency`  | `navigator.hardwareConcurrency + 2` (+ link to Workers)    | `NeatConfig.ts:239-240`, `DEFAULT_HEAVY_TASK_WORKER_COUNT` = 2 |
| `maxConns` default                 | `Infinity`                       | `MAX_SAFE_INTEGER` (+ link to Core evolution)              | `NeatConfig.ts` `parseNumber(... MAX_SAFE_INTEGER)`    |
| `maximumNumberOfNodes` default     | `Infinity` / "Maximum **hidden** neurons" | `MAX_SAFE_INTEGER` / "Maximum neurons" (+ link) | `NeatConfig.ts` (caps all neurons)                     |
| `adaptiveMutationThresholds.medium`/`.large` | "**Synapse** count threshold" | "Neuron count threshold"                    | `AdaptiveMutationThresholds.ts:13,20`                  |
| `verbose` description              | "Enable debug logging"           | "Verbose logging; when `true`, `log` defaults to `1`" (+ link to Logging) | `NeatConfig.ts:420,424` (`verbose` ≠ `debug`) |

`verbose` and `debug` are distinct flags: `debug` toggles debug mode, while
`verbose` controls log cadence (it makes `log` default to `1`).

## Evidence

Documentation-only change — no web interface to screenshot. Verified by a new
"what" test that parses the doc table and asserts each documented default/label
matches the real source constant, so the drift cannot silently return.

```
deno test --allow-read test/docs/ApiConfigurationDefaults.ts
ok | 6 passed | 0 failed
```

Full quality gate: `7578 passed | 0 failed`.

## Test Plan

Added `test/docs/ApiConfigurationDefaults.ts` (fails against the unfixed doc,
passes after the fix):

- `threads` default documents `+ DEFAULT_HEAVY_TASK_WORKER_COUNT`.
- `maxConns` default is `MAX_SAFE_INTEGER`, not `Infinity`.
- `maximumNumberOfNodes` default is `MAX_SAFE_INTEGER` and is not labelled
  "hidden".
- `adaptiveMutationThresholds.medium`/`.large` are neuron (not synapse) counts.
- `verbose` description is not conflated with `debug`.
- Documented numeric defaults still match `createNeatConfig({})`.

Existing `test/docs/ApiReferenceSplit.ts` continues to pass, confirming the new
relative links resolve on disk.
