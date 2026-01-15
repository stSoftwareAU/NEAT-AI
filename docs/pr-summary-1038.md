## Summary

This PR implements architecture-based species management (#1038) to improve crossover compatibility in the NEAT algorithm. Previously, the species key only used squash function names, meaning creatures with vastly different sizes (e.g., 10 neurons vs 100 neurons) could be grouped in the same species, leading to inefficient crossover operations.

### Changes Made

**Enhanced Species Key Generation** (`src/NEAT/Species.ts`):
- Added `ArchitectureInfo` interface to capture architectural metrics
- Added `getArchitectureInfo()` static method to extract creature architecture
- Enhanced `calculateKey()` to incorporate three architectural dimensions:

1. **Neuron Count Range**: Groups creatures by hidden neuron count in buckets of 10
   - Bucket 0: 0-9 hidden neurons
   - Bucket 1: 10-19 hidden neurons
   - Bucket 2: 20-29 hidden neurons
   - etc.

2. **Connectivity Density**: Groups creatures by average connections per neuron
   - Bucket 0: 0-1.99 connections per neuron (sparse)
   - Bucket 1: 2-3.99 connections per neuron (moderate)
   - Bucket 2: 4+ connections per neuron (dense)

3. **Squash Function Distribution**: Captures the distribution of activation functions
   - Uses count bucketing (Low: 1-2, Medium: 3-5, High: 6+) to avoid excessive species fragmentation

### Expected Benefits

- **Better crossover compatibility**: Similar-sized creatures are grouped together
- **More meaningful species competition**: Creatures compete within their architectural niche
- **Prevents large creatures from dominating small creature niches**: Size-based isolation

## Evidence

This is an internal algorithm enhancement with no visual UI component. The improvement is demonstrated through the test suite which verifies that:

1. Creatures with vastly different neuron counts are placed in different species
2. Creatures within the same size range with same squash distribution stay in the same species
3. Creatures with different connectivity levels are placed in different species
4. Creatures with different squash distributions are placed in different species

Performance impact: The species key calculation adds minimal overhead as it uses simple arithmetic operations on existing creature properties.

## Test Plan

Added 5 new tests in `test/NEAT/Species.ts`:

1. **Species Key - Neuron Count Range affects key**: Verifies creatures with vastly different sizes (2 vs 12 hidden neurons) are placed in different species
2. **Species Key - Same neuron count range keeps same key**: Verifies creatures within the same size bucket (2 vs 3 hidden neurons) with same squash distribution stay in the same species
3. **Species Key - Connectivity affects key**: Verifies sparse vs dense creatures are placed in different species
4. **Species Key - Squash distribution affects key**: Verifies creatures with different activation function distributions are placed in different species
5. **Species Key - getArchitectureInfo returns correct metrics**: Verifies the architectural metrics are calculated correctly

All 1315 existing tests continue to pass, confirming backward compatibility.
