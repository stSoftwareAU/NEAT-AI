## Summary

Closes #4077.

`Creature.loadFrom` now refuses a creature JSON whose neurons repeat a uuid, with a `ValidationError` naming the uuid and both positions. Before, the later neuron silently overwrote the earlier one in `uuidToIndex`, so every synapse naming that uuid rebound to the later neuron.

## Spec

### Intent and Rationale

- A neuron's uuid is its wire identity (AGENTS.md, Neuron UUID stability, rule 5). Two neurons sharing one cannot be told apart by synapse endpoints, so the input is malformed.
- Refusing at load gives the real cause up front, instead of a later, misleading `NO_OUTWARD_CONNECTIONS`.

### Essential Design Decisions

- The check is unconditional, so it also runs with the default `validate: false`. The cost is one map lookup per neuron, which the load already pays.
- Inputs are pre-registered as `input-N`, so a hidden neuron claiming `input-0` is refused too.
- The error is `ValidationError(message, "OTHER", position)`. `neuronIndex` is the later position, and the message names the earlier one. The reason union is not widened.
- The check lives in the TS `loadFrom` only.

### Undiscoverable Facts

- The full `./quality.sh` gate needs a native `rust_scorer`, which this host lacks, so it was skipped (see Test Plan).
- The issue suggests adding the rule to NEAT-AI-core's `creature_validate` conformance corpus if it belongs there. It does not belong there for this change: the check is in TS `loadFrom` and the corpus is unchanged.

## Evidence

Bug fix, backend only.

```text
Duplicate neuron uuid constant-a: neuron at position 2 repeats the uuid already held by position 1
```

Tests: `test/creature/LoadFromDuplicateNeuronUuid.ts` (3 tests).

**Docs sweep** — grep: `uuidToIndex`, `duplicat\w* uuid`; section: `AGENTS.md#-neuron-uuid-stability-critical-invariant` rule 5; siblings: `"OTHER"`, `NEURON_ORDER`; updated: `AGENTS.md`, `CHANGELOG.md`

## Reproduction

**symptom**: two neurons sharing a uuid load without error. The later neuron captures the synapses and the earlier one is left unconnected.

**status**: verified. With the check disabled (`if (false && earlier !== undefined)`) both refusal tests fail with `Expected function to throw.`; restored, they pass.

**regression test**: `test/creature/LoadFromDuplicateNeuronUuid.ts::two constants sharing a uuid are refused with a ValidationError`

## Test Plan

- [x] `test/creature/LoadFromDuplicateNeuronUuid.ts`: distinct constant uuids load (positive control); two constants sharing a uuid are refused; a hidden neuron claiming `input-0` is refused. Each refusal asserts reason `"OTHER"`, the exact message and `neuronIndex`.
- [x] Red check: the duplicate check forced off turns both refusal tests red; the positive control stays green.
- [x] 27 related tests pass: Grq24, Grq25, ConvertedConstantKeepsUuid_test, ForwardOnlyOutputRoundTrip, NeuronUuidStability, CreatureValidateHostOnlyOrdering.
- [x] `./quality.sh --skip-tests --skip-discovery --skip-wasm` passes (fmt, lint, type-check). `deno.lock` unchanged.
- [ ] Full `./quality.sh` skipped: the native `rust_scorer` is missing on this host.

<!-- vibe-quality-gate-skipped reason="Native rust_scorer is required (quality.sh default) but was not found on this host" -->

<!-- vibe-branch-outcomes -->

🤖 Generated with [Claude Code](https://claude.com/claude-code)
