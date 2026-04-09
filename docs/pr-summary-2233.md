## Summary

Fixed simplify causing invalid Memetic validation errors by deleting the memetic
object from the export before reconstructing the creature. Previously, memetic
was deleted from the creature after validation, meaning stale synapse references
in the memetic object would trigger a
`ValidationError: Memetic from id X to id
Y has no matching synapses`. This
occurred when `simplifyConstants` (or other non-`removeNeuron` simplification
paths) removed synapses that the memetic object still referenced. Closes #2233.

## Evidence

Before the fix, the test logs the CRITICAL error:

```
🚨 [simplify] CRITICAL: creature failed validation after simplify.
ValidationError: Synapse with id X not found in the creature.
```

After the fix, no validation error is logged and the simplified creature
correctly has no memetic object.

## Test Plan

- Added `test/optimize/simplify/MemeticCleanup.ts` with a test that constructs a
  creature with a constant neuron, attaches a memetic object referencing the
  constant→hidden synapse, then runs simplify. Verifies the simplified creature
  has no memetic and no validation error occurs.
- All 21 existing simplify tests continue to pass.
