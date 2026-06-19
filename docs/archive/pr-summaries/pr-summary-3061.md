## Summary

Removed the unused `asRecord` type-guard helper from `src/utils/TypeGuards.ts`.
Static dead-code analysis flagged it as an unused export, and a full-repo search
(`rg "\basRecord\b"`) confirmed the symbol appeared exactly once — its own
declaration — with no importer, no quoted-string/dynamic reference, and no
re-export from `mod.ts`. The sibling export `isRecord` remains and is still used
by `src/creature/CreatureSerialization.ts`. Closes #3061.

## Evidence

Backend/library change only — no web interface to screenshot.

Confirmation that `asRecord` had no dynamic or reflective use before removal:

```
$ rg -n "asRecord" .
./src/utils/TypeGuards.ts:25:export function asRecord(   # declaration only — now removed
```

After removal, the surviving `isRecord` export is still imported and exercised:

- `src/creature/CreatureSerialization.ts` imports and calls `isRecord`.
- `test/creature/SerialisationTypeSafety.ts` covers `isRecord` behaviour.

Verification commands:

- `deno check src/utils/TypeGuards.ts src/creature/CreatureSerialization.ts` —
  passes.
- `deno test test/creature/SerialisationTypeSafety.ts` — 7 passed, 0 failed.
- `./quality.sh` — 7356 passed, 0 failed, 4 ignored.

## Test Plan

No new tests required — this is a dead-code deletion with no behaviour change.
The existing
`test/creature/SerialisationTypeSafety.ts::isRecord - validates
plain objects`
guards the surviving `isRecord` export, and the full quality gate
(`./quality.sh`) confirms nothing else depended on `asRecord`.
