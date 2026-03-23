## Summary

Replace UUID string-based neuron identifiers with integer IDs to eliminate
UUID-to-index mapping overhead that dominates WASM serialisation cost. Closes
#1958.

### Key Changes

- **New `NeuronId` utility module** (`src/architecture/NeuronId.ts`): Provides
  deterministic integer ID scheme:
  - Input neurons: `id = inputIndex` (0, 1, 2, ...)
  - Output neurons: `id = -(outputIndex + 1)` (-1, -2, -3, ...)
  - Hidden/constant neurons: monotonically increasing from global counter
    (starting at 1,000,000)

- **Core interface changes**:
  - `Neuron.uuid: string` replaced with `Neuron.id: number`
  - `NeuronExport.uuid` replaced with `NeuronExport.id` (optional for backward
    compatibility)
  - `SynapseExport.fromUUID/toUUID` replaced with `fromId/toId` (optional for
    backward compatibility)
  - `getHiddenNeuronUUIDs()` renamed to `getHiddenNeuronIds()` returning
    `Set<number>`
  - All `Map<string, X>` keyed by neuron UUID changed to `Map<number, X>`

- **Backward compatibility**: Serialisation code handles both legacy string UUID
  format and new integer ID format, allowing existing JSON data files to load
  without modification.

- **Scope**: 100+ source files and 250+ test files updated across all modules
  (architecture, breed, compact, mutate, creature, discovery, propagate,
  reconstruct, optimise, intelligentDesign).

### Benefits

- Direct indexing into typed arrays (O(1) vs hash lookup)
- Trivial serialisation (no string encoding/decoding)
- Reduced memory per neuron (8 bytes vs 36+ bytes per UUID)
- Eliminates UUID-to-index mapping tables on both sides during WASM
  serialisation

## Evidence

- All new tests in `test/architecture/IntegerNeuronIds.ts` verify:
  - Input neurons have integer IDs matching their index
  - Output neurons have negative integer IDs
  - Hidden neurons have positive integer IDs >= 1,000,000
  - `nextNeuronId()` returns unique sequential integers
  - Serialisation round-trip preserves integer neuron IDs
  - Breeding offspring uses integer neuron IDs
  - Genetic compatibility works with integer IDs

## Test Plan

- Added `test/architecture/IntegerNeuronIds.ts` with 8 tests covering the
  integer ID scheme, serialisation round-trip, breeding, and genetic
  compatibility
- Updated all existing tests to work with integer neuron IDs
- No existing tests were removed; business logic changes are documented inline
