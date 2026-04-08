## Summary

Harden type safety at serialisation boundaries by replacing `as any` casts with
proper typed interfaces and runtime validation guards. Closes #2217.

### Changes

- **`src/blackbox/MemeticWireData.ts`** (new): Wire-format `MemeticWireData`
  interface with `isMemeticWireData()` runtime type guard for JSON-parsed
  memetic data.
- **`src/utils/TypeGuards.ts`** (new): Shared `isRecord()` / `asRecord()` guards
  replacing double-casts (`as unknown as Record<string, unknown>`).
- **`src/creature/CreatureSerialization.ts`**: Replaced `memetic: any` parameter
  with `MemeticWireData`; replaced `JSON.parse` result `any` with validated
  `MemeticWireData`; removed `as any` for neuron/synapse UUID access (using
  existing interface fields); replaced trace-data double-casts with `isRecord()`
  guards; replaced `for...in` loops with `Object.keys()` iterations.
- **`src/architecture/NormaliseCreatureExport.ts`**: Removed `as any` casts for
  neuron `.uuid` and synapse `.fromUUID`/`.toUUID` (already on the interfaces);
  typed `normaliseMemeticData` parameter as `MemeticWireData`.
- **`src/discovery/ReplayEntryApplication.ts`**: Typed `getRustRequest()` return
  as `DiscoveryWireRequest` instead of `Record<string, unknown>`; removed
  redundant casts on wire request properties.
- **`src/creature/MemeticWireExport.ts`**: Replaced `any` parameter and
  `JSON.parse` result with `MemeticWireData`.

## Evidence

- `deno check` passes with no type errors
- All 5492 existing tests pass (0 failures)
- Lint and format checks clean

## Test Plan

- Added `test/creature/SerialisationTypeSafety.ts` with 7 tests:
  - `isMemeticWireData` guard: accepts valid shapes, rejects invalid shapes
  - `isRecord` guard: validates plain objects
  - `loadFrom` with UUID-keyed memetic data round-trip
  - `normaliseCreatureExport` with UUID neurons and wire memetic data
  - `loadFrom` with trace data via type-guarded path
