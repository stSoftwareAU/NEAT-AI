# Rust Discovery: Fix "No Eligible Upstream Sources" Diagnostic

## Problem

The Rust discovery library is returning `"no_eligible_sources"` diagnostics for neurons that should have eligible upstream sources. This is causing valid discovery candidates to be incorrectly filtered out.

## Expected Behavior

All non-input neurons in a valid creature **must** have at least one inward synapse. Therefore, for any non-input neuron, there should always be potential upstream sources to evaluate for synapse discovery.

## Current Issue

The Rust library is reporting `"no_eligible_sources"` for neurons that:
- Are not input neurons (input neurons legitimately have no upstream sources)
- Are part of a valid creature (which requires all non-input neurons to have inward synapses)
- Should have eligible upstream neurons available for synapse discovery

## Example from Logs

```
[NEAT-AI-Discovery][verbose] Target adjustment-node-00003-v4 had no eligible upstream neurons to evaluate.
```

This message appears even when:
- The creature is valid (all neurons have required connections)
- There are ~2000 observations/samples available
- The neuron is not an input neuron

## Root Cause Hypothesis

The "no eligible upstream sources" check may be:

1. **Overly restrictive filtering**: Filtering out all potential sources because they're already connected, when we should still consider them for analysis
2. **Incorrect eligibility logic**: The eligibility check may be incorrectly determining that no sources are available
3. **Missing source types**: Not considering all valid source neuron types (e.g., input neurons, hidden neurons, other output neurons)
4. **Sample alignment issue**: Incorrectly determining that no aligned samples exist, when samples should be available

## Requested Fix

### Option 1: Remove or Relax the "No Eligible Sources" Check (Recommended)

If a neuron is not an input neuron and the creature is valid, there should always be eligible upstream sources. The check should:

1. **Only apply to input neurons**: Input neurons legitimately have no upstream sources
2. **For non-input neurons**: Always assume eligible sources exist, or at minimum, log a warning if truly none are found (as this would indicate a creature validation bug)

### Option 2: Improve Eligibility Detection

If the check must remain, improve it to:

1. **Check all neuron types**: Consider input, hidden, and output neurons as potential sources
2. **Don't filter by existing connections**: Even if a synapse already exists, the source neuron is still "eligible" for analysis purposes
3. **Verify sample availability**: Ensure the check isn't incorrectly determining that no samples are available
4. **Add detailed logging**: When "no eligible sources" is detected, log:
   - Neuron UUID and type
   - Number of existing inward synapses
   - Number of potential source neurons in the creature
   - Number of samples available
   - Why each potential source was filtered out

### Option 3: Make it a Warning, Not a Filter

Instead of filtering out candidates with "no eligible sources", make it a diagnostic warning but still allow the analysis to proceed. The TypeScript side can then decide whether to proceed or skip based on the full context.

## Expected Outcome

After the fix:

1. **Valid neurons should not report "no eligible sources"** unless they are input neurons
2. **Discovery should proceed** for all non-input neurons with available samples
3. **If truly no sources exist** (which would indicate a creature validation bug), it should be logged as an error/warning, not silently filtered

## Related Code Locations

- Rust diagnostic reason: `"no_eligible_sources"` in synapse/neuron diagnostics
- TypeScript mapping: `src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts:2529-2530` and `2548-2549`
- Rust interfaces: `RustSynapseDiagnostic` and `RustNeuronDiagnostic` with `reason: "no_eligible_sources"`

## Validation

To verify the fix:

1. Run discovery on a creature with ~2000 samples
2. Check that "no eligible upstream sources" only appears for:
   - Input neurons (legitimate)
   - Cases where it's truly impossible (with detailed logging explaining why)
3. Verify that discovery candidates are not incorrectly filtered out

## Notes

- The user suspects this is appearing incorrectly for valid neurons
- A neuron connected to all ~2000 observations would be a valid case for "no eligible sources" (all already connected), but this is unlikely
- The more likely issue is overly aggressive filtering or incorrect eligibility logic in the Rust library

