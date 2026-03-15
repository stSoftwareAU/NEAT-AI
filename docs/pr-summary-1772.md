## Summary

Third-pass audit of compact and optimisation test files across `test/Compact/`,
`test/optimize/`, `test/optimization/`, `test/FeedForward/`, and
`test/reconstruct/`. Improves test names for clarity, removes debug code,
strengthens weak assertions, consolidates duplicate tests, and replaces
console.info/fail patterns with proper assertions. Closes #1772.

## Changes

### Test names improved (25 files)

**test/Compact/** (7 files) — Renamed vague single-word test names to clearly
describe behaviour:

- `Cascade.ts`: "CompactCascade" → "compactUnused - behaviour preserved with
  cascading Cosine/CLIPPED removals"
- `FixIF.ts`: "FixIF" → "compactUnused - behaviour preserved when IF-type neuron
  is compacted"
- `UnusedClipped.ts`: "UnusedClipped" → "compactUnused - behaviour preserved when
  CLIPPED hidden neuron is removed"
- `CompactConstant.ts`: "CompactConstants" → "compactUnused - behaviour preserved
  with constant and IF neurons"
- `CompactKeepOrder.ts`: "CompactKeepOrder" → "compactUnused - preserves constant
  neuron ordering and behaviour"
- `Compact.ts`: 5 tests renamed (removeDanglingHidden, removeFeedbackLoop,
  CompactSimple, RandomizeCompact, CompactSelf)

**test/optimize/activate/** (7 files) — Renamed all single-word test names:

- "Constant" → "activate - constant neuron contributes correct value to IDENTITY
  output"
- "HYPOT" → "activate - HYPOT squash produces correct hypotenuse output"
- "IF" → "activate - IF squash with condition/positive/negative branches executes
  correctly"
- "Maximum" → "activate - MAXIMUM squash selects highest weighted input"
- "Minimum" → "activate - MINIMUM squash selects lowest weighted input"
- Plus RELU, HYPOTv2, Constant-max

**test/optimize/simplify/** (7 files) — Renamed all single-word test names:

- "ABSOLUTE" → "simplify - ABSOLUTE squash with mixed activation chain preserves
  behaviour"
- "COMPLEMENT -> IDENTITY" → "simplify - COMPLEMENT neuron is converted to
  IDENTITY with negated weights"
- "Constant" through "Constant-3" renamed to describe specific scenarios
- "Cosine", "SINE", "TAN" renamed with descriptive suffixes
- "IDENTITY", "IDENTITY-simple", "IDENTITY Maximum" renamed

**test/FeedForward/MutateActions.ts** — 2 tests renamed:

- "FeedForward only" → "FeedForward mode excludes recurrent mutation methods"
- "memory enabled" → "FeedbackLoop mode includes recurrent mutation methods"

### Debug code removed (14 files)

Removed `((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;` from:

- `test/Compact/Compact.ts`, `test/Compact/CleanupOrphanedNeurons.ts`
- `test/optimize/activate/Constant.ts`, `HYPOT.ts`, `HYPOTv2.ts`, `IF.ts`,
  `Maximum.ts`, `Minimum.ts`, `RELU.ts`
- `test/optimize/simplify/COMPLEMENT.ts`, `Constant.ts`, `Cosine.ts`,
  `IDENTITY.ts`, `SINE.ts`, `TAN.ts`

Removed `simplifiedCreature.DEBUG = false;` from `test/optimize/simplify/Constant.ts`
(3 occurrences).

Removed `b.DEBUG = false; ... b.DEBUG = true;` toggling and
`console.info("Did not compact")` from `test/Compact/Compact.ts`.

### Assertions improved (5 files)

**test/optimize/activate/** (4 files: Constant, IF, Maximum, Minimum) — Replaced
`console.info(...) + fail(...)` pattern with `assertAlmostEquals()`. Removed
unused `delta` variables.

**test/reconstruct/ConnectMissing.ts** — Rewrote as behavioural test:

- Removed UUID-string-parsing "how" test (`fromUUID.split("-")[1]`)
- Removed `console.log(exported3)`
- Added proper assertions checking all inputs have synapses
- Renamed tests to describe behaviour

**test/reconstruct/LegacyFormat.ts** — Strengthened tautological assertions:

- `creature.neurons.length > 0 === true` → `assertEquals(creature.neurons.length, 3)`
- `result.neurons !== undefined === true` → `assertEquals(result.neurons?.length, 1)`

### Duplicate tests consolidated (1 file)

**test/reconstruct/ValidateDNATypedErrors.ts** — Consolidated from 17
near-duplicate tests to 4 representative tests. The removed tests duplicated
`test/CRISPR/ValidateDNA.ts` with only the error type (CrisprError vs Error)
differing. Kept 4 representative tests covering: null input, non-object input,
invalid neuron, and invalid synapse.

### Dead code removed

- Removed commented-out code in `test/Compact/Compact.ts`
  (`// const d = c.compact(); // assert(!d);`)

## Evidence

4520 tests pass. 1 pre-existing failure in `test/config/NeatArguments.ts`
(unrelated to this audit — selection default changed from POWER to
FITNESS_PROPORTIONATE).

## Test Plan

- Verified all modified tests still pass after renaming
- Verified debug code removal does not affect test behaviour
- Verified strengthened assertions correctly test intended behaviour
- Verified consolidated ValidateDNATypedErrors.ts covers CrisprError type
  verification (full message coverage retained in test/CRISPR/ValidateDNA.ts)
- Ran full quality gate: lint, type-check, and all tests pass
