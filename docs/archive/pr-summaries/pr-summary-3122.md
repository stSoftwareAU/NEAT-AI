# DOC-MODULE-DOC: `src/optimize` module docs

## Summary

Added a short leading `@module` JSDoc block to the five public modules in the
`src/optimize/` (`@optimize/`) namespace that exported a symbol but opened
straight onto imports/code with no module-level doc comment. Each block follows
[`docs/DOC_STYLE.md`](../../DOC_STYLE.md) — a one-line plain-language gloss of
what the optimisation pass / interface does, in Australian English — so a reader
of this published surface (`publish.include: ["src/**"]`) can orient without
reading the implementation. Documentation only; no code changes. Closes #3122.

Files documented:

- `src/optimize/FunctionCache.ts`
- `src/optimize/InlineActivationInterface.ts`
- `src/optimize/MakeActivationFunctionInterface.ts`
- `src/optimize/Simplify.ts`
- `src/optimize/SimplifyBiasInterface.ts`

## Evidence

Backend/library change with no web interface to screenshot. Verified the module
docs render via the read-only `deno doc` tool, e.g.:

```
$ deno doc src/optimize/Simplify.ts
Behaviour-preserving simplification passes for an exported creature.

`simplify()` folds constants, prunes redundant synapses ...
@module
```

All five files now emit their leading description through `deno doc`.

## Test Plan

No unit tests added. Per [`AGENTS.md`](../../../AGENTS.md) testing policy,
asserting on documentation content (grepping source for `@module`) is a "how"
test and is explicitly discouraged; the change carries no runtime behaviour to
assert on. Verification instead relies on:

- `deno doc src/optimize/<file>.ts` — confirms each module doc renders.
- `./quality.sh` — passed cleanly (lint, format, type-check, full test suite:
  7397 passed, 0 failed), confirming the added comments do not break the build.
