# feat: record value/errors for aggregate-squash neurons (MAXIMUM/MINIMUM/IF)

## Summary

Aggregate-squash neurons — `MAXIMUM`, `MINIMUM`, and `IF`, **including an
`output-0` that uses an aggregate squash** — delegated their `record()` walk
wholly to the selected input path and discarded the aggregate neuron's own
quantities. As a result those neurons exported a **fully-null `value` series and
no `errors`**, so the discovery/insight tooling could not show what the output
neuron (or any aggregate-squash neuron) actually saw.

The record walk now writes the aggregate neuron's **own pre-activation `value`**
and **attributed `error`** in the delegation branch of
`src/neuron/NeuronRecord.ts`, using the same `toValue(neuron, activation)`
quantities the squash `record()` methods already compute internally
(`error = toValue(target) − toValue(current)`). The own value/error is recorded
**on first visit only**, matching the existing non-delegating branch, and the
existing delegation into the selected input path is preserved. Recorded
aggregate errors receive **full integration** — they flow into the existing
discovery-analysis paths with no gating.

Producer-side only; the viewer-side null display is the counterpart
stSoftwareAU/NEAT-AI-Explore#507.

Closes #3389

## Evidence

Backend/CLI change — no web interface to screenshot. Verified via unit tests
that assert on the recorded `value`/`errors` outcome, and the full quality gate
(`./quality.sh`) passing with **7658 tests passed, 0 failed**.

### Record walk before vs after

```mermaid
flowchart TD
    R["record(aggregate neuron)"] --> Q{squash has<br/>record()?}
    Q -- "no (normal squash)" --> N["write own value + error<br/>(unchanged)"]
    Q -- "yes (MAXIMUM/MINIMUM/IF)" --> B["delegation branch"]
    B --> New["Issue #3389: on first visit<br/>write own value = toValue(neuron, activation)<br/>and error = toValue(target) − toValue(current)"]
    New --> D["delegate to selected input path<br/>(existing behaviour, preserved)"]
```

Before this change the delegation branch went straight to _delegate to selected
input path_, so the aggregate neuron's own record stayed value-null with no
errors.

## Test Plan

New behaviour tests in `test/discovery/AggregateSquashRecordsOwnValue.ts` (all
assert on recorded outcomes, not implementation):

- `record(MAXIMUM|MINIMUM|IF): output aggregate records its own value and error`
  — an `output-0` using each aggregate squash records a finite `value` equal to
  `toValue(neuron, activation)` and a first `error` equal to
  `toValue(target) − toValue(current)`.
- `record(aggregate): matching target records a zero own error` — when the
  target equals the activation, the `value` is still recorded and the own error
  is `0`.
- `record(aggregate): own error recorded once per neuron (single visit)` — a
  hidden aggregate feeding two outputs (visited twice by the record walk)
  records its own value/error exactly once.

Confirmed the suite **fails against the unfixed code** (all 5 cases fail:
missing `value`/`errors`) and **passes after the fix**.

Regression coverage: re-ran `test/propagate/record/*`,
`test/discovery/STEPRecordingIntegration.ts`,
`test/discovery/DiscoverStructureSquash.ts` (28 passed) plus the full
`./quality.sh` gate (7658 passed, 0 failed).
