## Summary

Add automated schema validation test for `exportJSON()` output against `docs/snapshot-schema.json`. This ensures that any future change to `exportJSON()` that breaks the schema contract is caught immediately by the test suite. Closes #2052.

The breakage described in #2049 went undetected because no test validated `exportJSON()` output against the JSON schema. This test fills that gap using Ajv (JSON Schema draft 2020-12) to programmatically enforce the schema.

## Evidence

All 8 new tests pass across 7 creature configurations:
- Minimal creature (1 input, 1 output, 1 synapse)
- Creature with hidden layers
- Creature with constant neurons
- Legacy UUID-format creature (verifies UUID preservation)
- Creature with memetic data
- Forward-only creature
- Programmatically constructed creature (via `new Creature()` with layers)

Each test validates:
- Full JSON Schema compliance against `docs/snapshot-schema.json`
- Every neuron has a `uuid` string field
- Output neuron UUIDs follow `output-N` pattern
- Every synapse has `fromUUID` and `toUUID` string fields
- All synapse UUID references point to valid neurons

Round-trip fidelity test verifies `Creature.fromJSON(creature.exportJSON())` preserves neuron UUIDs, biases, synapse UUIDs, and weights.

`./quality.sh` passes cleanly (5053 tests, 0 failures).

## Test Plan

- Added `test/architecture/ExportSchemaValidation.ts` with 8 test cases
- Added `ajv/2020` dependency in `deno.json` for JSON Schema draft 2020-12 validation
