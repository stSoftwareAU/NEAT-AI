## Summary
Fixed broken string formatting in `CreatureValidate.ts` error messages (#1365).

Three template literal strings on lines 117, 124, and 133 contained leftover `+ "` fragments
from a migration away from string concatenation. These fragments appeared as literal text in
error messages instead of being part of proper interpolation.

**Before:** `"wrong-uuid + \") invalid output UUID: wrong-uuid"`
**After:** `"wrong-uuid) invalid output UUID: wrong-uuid"`

The source fix was applied in commit ec382894 (Fix: Suggest improvements #1363 #1369).
This PR adds robust regression tests that verify the actual error message content for all
three affected code paths.

## Evidence
This is a backend validation fix with no UI component. Evidence is provided via the test
suite:

- All 3 new tests **fail** when the broken string formatting is reintroduced (verified by
  temporarily reverting the source fix)
- All 3 new tests **pass** with the corrected template literals
- Full quality gate passes: 2209 tests, 0 failures

## Test Plan
- `creatureValidate - output UUID mismatch produces clean message` — verifies the error
  message for invalid output neuron UUIDs contains no concatenation artefacts and follows
  the expected `"${uuid}) invalid output UUID:"` format
- `creatureValidate - non-output after output produces clean message` — verifies the error
  message for neuron ordering violations contains no concatenation artefacts and follows
  the expected `") type hidden after output neuron"` format
- `creatureValidate - input after max inputs produces clean message` — verifies the error
  message for misplaced input neurons contains no concatenation artefacts and follows
  the expected `") input neuron after the maximum input neurons"` format
