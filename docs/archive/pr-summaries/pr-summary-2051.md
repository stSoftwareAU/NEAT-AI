## Summary

Update `docs/snapshot-schema.json` to support both legacy UUID-only exports and
new dual-format (UUID + integer ID) exports. Closes #2051.

### Changes to snapshot-schema.json

- **Neuron definition**: Added optional `id` (integer) and `frozen` (boolean)
  fields
- **Synapse definition**: Added optional `fromId`, `toId` (integer) and `frozen`
  (boolean) fields
- **memeticWeight definition**: Made `toUUID` optional, added optional `toId`
  (integer); only `weight` remains required
- **memeticWeights/memeticBiases**: Updated descriptions to document that keys
  may be UUID strings (legacy) or integer ID strings (new format)
- **Top-level**: Added optional `hyperparameters` object with all 6 evolvable
  fields (`learningRate`, `addNeuronRate`, `addConnectionRate`,
  `weightPerturbationScale`, `l1RegularisationStrength`,
  `l2RegularisationStrength`)
- Schema remains valid JSON Schema draft 2020-12

## Evidence

All 5045 tests pass including 12 new schema validation tests.

## Test Plan

Added `test/validate/SnapshotSchema.ts` with 12 tests:

- Schema structural tests verifying `id`, `frozen`, `fromId`, `toId`, `toId`
  (memetic), and `hyperparameters` are declared
- Functional tests validating legacy UUID-only exports against the schema
- Functional tests validating new dual-format exports (from
  `Creature.exportJSON()`) against the schema
- Frozen neuron/synapse export field validation
- Hyperparameters export field validation
- Memetic weight `toId`/`toUUID` dual-format validation
