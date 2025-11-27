# Discovery Focus Selection Improvements

**Date:** 27-Nov-2025

## Summary

Fixed critical issues with neuron focus selection in error-guided discovery to
ensure only neurons that can actually improve the creature's score are selected.

## Problems Identified

1. **Neurons selected with no chance of improvement**: Neurons with
   `potentialErrorReduction < costOfGrowth` were being selected, wasting
   analysis time on candidates that could never improve the score.

2. **Weak weighting function**: Linear weighting
   (`weight = totalError × impact`) didn't strongly enough favour high-potential
   neurons. Low-potential neurons had significant probability of selection.

3. **Wrong default costOfGrowth**: Methods used `0.01` as default, which is
   **10,000,000x larger** than the NEAT option default of `1e-7`.

4. **Incorrect EPSILON**: Used `costOfGrowth × 0.01` instead of just
   `costOfGrowth`.

5. **Single selection mode**: No distinction between adding structures (want
   high potential) vs removing structures (want low impact).

## Changes Made

### 1. Hard Filter by costOfGrowth

**File:** `src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts`

Added pre-filtering to exclude neurons that cannot improve score:

- **Add mode**: Only neurons where `potentialErrorReduction >= costOfGrowth`
- **Remove mode**: Only neurons where `impact < costOfGrowth`

```typescript
const neuronErrors = mode === "add"
  ? allNeuronErrors.filter((n) => {
    const potentialErrorReduction = n.totalError * n.impact;
    return potentialErrorReduction >= costOfGrowth;
  })
  : allNeuronErrors.filter((n) => n.impact < costOfGrowth);
```

### 2. Squared Weighting for Strong Preference

Changed from linear to squared weighting relative to costOfGrowth:

**Old (linear):**

```typescript
weight = totalError × (impact + EPSILON)
```

**New (squared):**

```typescript
netImprovement = mode === "add" 
  ? (totalError × impact) - costOfGrowth
  : costOfGrowth - impact;
weight = netImprovement²
```

**Impact:** If neuron A has 10x the net improvement of neuron B, it now gets
100x the weight (not 10x).

### 3. Fixed EPSILON

**Old:** `EPSILON = costOfGrowth × 0.01`\
**New:** `EPSILON = costOfGrowth`

EPSILON represents the cost of adding a single synapse - the minimum meaningful
improvement.

### 4. Single Source of Truth for costOfGrowth

**Old approach (multiple sources):**

- Method default: `costOfGrowth: number = 0.01`
- Test hardcoded: `0.000_000_1`
- Config default: `options.costOfGrowth ?? 0.000_000_1`

**New approach (single source):**

```typescript
// src/config/NeatConfig.ts - THE ONLY source of truth
export const DEFAULT_COST_OF_GROWTH = 0.000_000_1;
export const MIN_COST_OF_GROWTH = 0.000_000_000_1;

// Used consistently everywhere:
import { DEFAULT_COST_OF_GROWTH } from "../../config/NeatConfig.ts";
const cost = options.costOfGrowth ?? DEFAULT_COST_OF_GROWTH;
```

**Benefits:**

- **One-line change**: Want to change the default to `0.000_000_2`? Change ONE
  constant.
- **No duplication**: All code references the same constant
- **Type safety**: Methods require `costOfGrowth: number` (no optional, no
  default)
- **Consistent behavior**: User-set `costOfGrowth: 0.012345` flows through
  unchanged

### 5. Dual Selection Modes

Added `mode` parameter to `selectNeuronsWeightedByError`:

- **"add" mode** (default): For adding synapses/neurons or changing squash
  functions
  - Selects neurons with high `potentialErrorReduction - costOfGrowth`
  - Used by: `analyzeSynapses()`, `analyzeNeurons()`, `analyzeNeuronsSquashes()`

- **"remove" mode**: For removing structures
  - Selects neurons with low impact where removal saves costOfGrowth
  - Used by: `analyzeSynapsesForRemoval()`

## Cost of Growth Economics

From NEAT configuration (`src/config/NeatConfig.ts`):

- **Default:** `1e-7` (0.000_000_1)
- **Minimum:** `1e-10` (0.000_000_000_1)

**Structure costs:**

- New synapse: `1 × costOfGrowth`
- New neuron: `~3 × costOfGrowth` (neuron body + 2 synapses minimum)

**Viability check:**

```typescript
// For a synapse to be worth adding:
potentialErrorReduction >= costOfGrowth

// For a neuron to be worth adding:
potentialErrorReduction >= 3 × costOfGrowth

// For a structure to be worth removing:
impact < costOfGrowth  // Saves more than it contributes
```

## Example: Weight Calculation

Given two neurons with different potential:

**Linear weighting (old):**

- Neuron A: PER = 0.10 → weight = 0.10
- Neuron B: PER = 0.01 → weight = 0.01
- Ratio: 10x (A is 10x more likely to be selected)

**Squared weighting (new, with costOfGrowth = 1e-7):**

- Neuron A: PER = 0.10, net = 0.10 - 1e-7 ≈ 0.10 → weight = 0.01
- Neuron B: PER = 0.01, net = 0.01 - 1e-7 ≈ 0.01 → weight = 0.0001
- Ratio: 100x (A is 100x more likely to be selected)

If Neuron B had PER < 1e-7, it would be filtered out entirely.

## Testing

Created `test/discovery/FocusCostOfGrowthFilter.ts` to verify:

1. Neurons with `potentialErrorReduction < costOfGrowth` are filtered out
2. Lower costOfGrowth includes more neurons (as expected)
3. Empty selection when all neurons below threshold

## Benefits

1. **No wasted analysis**: Only viable candidates are analyzed
2. **Stronger focus**: High-potential neurons get dramatically higher selection
   probability
3. **Consistent economics**: costOfGrowth used uniformly from NEAT options
4. **Mode-specific selection**: Different strategies for adding vs removing
   structures
5. **Better logging**: Clear warnings when no viable neurons exist

## Backward Compatibility

Changes are backward compatible:

- Default `costOfGrowth` matches NEAT option default
- Existing code passing `costOfGrowth` works unchanged
- New `mode` parameter defaults to "add" (existing behavior)

## Related Files

- `src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts` - Core
  implementation
- `src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts` -
  Passes costOfGrowth from options
- `src/config/NeatConfig.ts` - Defines costOfGrowth default
- `src/config/NeatOptions.ts` - Documents costOfGrowth semantics
- `test/discovery/FocusCostOfGrowthFilter.ts` - New tests
