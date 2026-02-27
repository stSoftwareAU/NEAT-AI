## Summary

Add a formal JSON schema for the NEAT-AI creature export (snapshot) format, along with a runtime validation utility and comprehensive tests. Closes #1617.

- Created `docs/snapshot-schema.json` — a JSON Schema (draft 2020-12) describing the full `CreatureExport` structure including neurons, synapses, tags, and memetic evolution state
- Created `src/utils/validateCreatureExport.ts` — a zero-dependency runtime validator matching the schema
- Referenced the schema from `CreatureExport` interface and `CreatureExportBuilder`
- All existing example models (`XOR.json`, `NARX.json`, `SHIFT.json`, `large.json`) validate against the schema

## Evidence

This is a documentation/schema change with no UI components. Evidence is provided via tests:

- 9 new test cases validate all example snapshots and reject invalid data
- All 4254 tests pass (including the 9 new ones) via `./quality.sh`

## Test Plan

- `test/schema/SnapshotSchema.ts` — validates all four example models in `docs/models/` against the schema
- Tests that `Creature.exportJSON()` output passes validation
- Tests that missing required fields, invalid neuron types, invalid synapse types, and non-string tag values are correctly rejected
