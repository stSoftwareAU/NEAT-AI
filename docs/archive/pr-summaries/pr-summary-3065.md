## Summary

Removed the unused, deprecated export `DEFAULT_NEW_CREATURE_SEMANTIC_VERSION`
from `src/Creature.ts`. Static dead-code analysis flagged it as having no
in-repo importer — a whole-repo grep returned only the declaration itself. The
constant was a `@deprecated` alias of `CURRENT_CREATURE_SEMANTIC_VERSION`, which
is the live version export used everywhere (constructor, training, export
builder, `mod.ts` public API). Confirmed no dynamic/reflective use before
deleting.

Closes #3065.

## Evidence

Backend/library change only — no web interface to screenshot.

Verification that the constant was dead before removal:

```
$ rg "DEFAULT_NEW_CREATURE_SEMANTIC_VERSION" --type ts
src/Creature.ts:109:export const DEFAULT_NEW_CREATURE_SEMANTIC_VERSION =
```

Single occurrence — the declaration only. It is not re-exported from `mod.ts`
(only `CURRENT_CREATURE_SEMANTIC_VERSION` is), so it was not part of the public
API either.

After removal, `./quality.sh` reports 7356 tests passing. One unrelated test
(`MakeUuidDirectConstruction.ts`) flaked under parallel execution; it passes
cleanly in isolation (`8 passed | 0 failed`) and does not reference the removed
constant.

## Test Plan

- No new test required — this is a dead-code deletion of a deprecated alias.
- Existing coverage of the surviving constant remains green:
  `test/creature/CreatureConstruction.ts`,
  `test/creature/CreatureModeSplit.ts`, and
  `test/creature/SemanticVersionWriteGuard.ts` all assert on
  `CURRENT_CREATURE_SEMANTIC_VERSION`.
- `./quality.sh` (fmt, lint, type-check, full test suite) run after the change.
