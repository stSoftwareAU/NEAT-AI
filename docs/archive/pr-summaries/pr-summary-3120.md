# PR Summary — Issue #3120

## Summary

Added leading `@module` JSDoc blocks to the eight previously undocumented
public mutation-operator modules in `src/mutate/`. Each file jumped from
imports straight to its `export`, so a reader scanning the `@mutate/`
catalogue could not tell at a glance what an operator does without reading
the body. Each block follows [`docs/DOC_STYLE.md`](../../DOC_STYLE.md):
a one-line plain-language gloss, Australian English, and an explicit
NEAT-vs-NEAT-AI call-out where the operator behaves differently from the
original 2002 algorithm. Documentation only — no behaviour changes.

Closes #3120

Files documented:

- `src/mutate/AddBackCon.ts` — adds a back (recurrent) connection.
- `src/mutate/AddSelfCon.ts` — adds a self-connection.
- `src/mutate/RadioactiveInterface.ts` — shared `mutate` contract for operators.
- `src/mutate/SubBackCon.ts` — removes a back (recurrent) connection.
- `src/mutate/SubConnection.ts` — removes a feed-forward connection.
- `src/mutate/SubNeuron.ts` — removes a hidden neuron.
- `src/mutate/SubSelfCon.ts` — removes a self-connection.
- `src/mutate/SwapNeurons.ts` — swaps the squash/bias of two hidden neurons.

## Evidence

Documentation-only change with no web interface — no screenshot applies.
Verified each module-doc renders via the read-only `deno doc` command, e.g.:

```
$ deno doc src/mutate/SwapNeurons.ts
@module
    Mutation operator that swaps the squash (activation) and bias of two hidden
    neurons, exploring the parameter space without changing the connection
    structure. Unlike a sub/add pair it preserves the existing topology — only
    the two neurons' activation behaviour is exchanged.
```

All eight files produce an `@module` block. Quality gate:

- `./quality.sh --lint-only` — passed (format + lint clean across 1977/1741 files).
- `./quality.sh --check-only` — passed (type-check clean).

## Test Plan

No functional code changed, so no unit tests were added — the operators'
runtime behaviour is unchanged and is already covered by the existing
`test/mutation/` suite. Verification was via `deno doc` (each file emits an
`@module` block) plus the `deno fmt`, `deno lint`, and `deno check` gates
run through `./quality.sh`.
