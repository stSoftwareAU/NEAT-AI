## Summary

Restored backward-compatible `uuid`/`fromUUID`/`toUUID` string fields in all `exportJSON()` output paths. Issue #1958 migrated neuron identification from UUID strings to integer IDs but stopped emitting the UUID fields, breaking external consumers that depend on the UUID-based export format. Both `id`/`fromId`/`toId` (integer) and `uuid`/`fromUUID`/`toUUID` (string) fields are now emitted in every export. Closes #2050.

### Changes

- **Neuron class** (`src/architecture/Neuron.ts`): Added optional `uuid?: string` field to carry legacy UUIDs through import/export cycles.
- **NeuronSerialization** (`src/neuron/NeuronSerialization.ts`): `exportJSON()` now emits a `uuid` field; `fromJSON()` preserves the legacy UUID on the Neuron. Exported `neuronUuid()` helper generates deterministic UUID strings.
- **Synapse** (`src/architecture/Synapse.ts`): `exportJSON()` now accepts a `uuidMap` parameter and emits `fromUUID`/`toUUID` alongside `fromId`/`toId`.
- **CreatureExportBuilder** (`src/utils/CreatureExportBuilder.ts`): Builds a `uuidMap` (index to UUID string) and passes it to synapse export.
- **CreatureSerialization** (`src/creature/CreatureSerialization.ts`): `shallowClone` now copies the `uuid` field.
- **Father.ts** (`src/breed/Father.ts`): Both `createCompatibleFather` variants updated to remap `uuid`/`fromUUID`/`toUUID` fields alongside integer IDs.
- **UUID format**: Output neurons use `"output-N"`, input neurons use `"input-N"`, hidden/constant neurons use their stored legacy UUID or `"neuron-{id}"` for new creatures.

## Evidence

- All 5033 existing tests pass after changes
- `./quality.sh --skip-wasm --skip-discovery` passes cleanly

## Test Plan

- Added `test/architecture/ExportUUID.ts` with 9 tests covering:
  - Neuron export includes `uuid` string field
  - Output neuron UUIDs follow `"output-N"` format
  - Synapse export includes `fromUUID` and `toUUID` string fields
  - Input neuron references use `"input-N"` format in synapse UUIDs
  - Hidden/constant neuron UUIDs are deterministic across identical creatures
  - Legacy UUID strings are preserved through import/export round-trip
  - Synapse UUIDs reference valid neuron UUIDs
  - New creatures (integer IDs only) generate deterministic `"neuron-{id}"` UUIDs
  - Full round-trip export/import/re-export preserves all UUID fields
- Updated `test/breed/Father.ts` to verify UUID remapping in compatible father creation
- Updated `test/breed/samples/expected-{1,2}.json` golden files to include UUID fields
- Updated `test/creature/CreatureUUID.ts` hardcoded creature hash (changed due to new UUID fields in export)
