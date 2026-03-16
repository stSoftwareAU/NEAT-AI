# PR Summary: Issue #1308 - Enhanced Discovery Candidate Validation

## Overview

This PR implements enhanced discovery candidate validation with holdout testing
and brittleness scoring as part of the "Brilliant but Brittle" initiative. The
goal is to strengthen validation of discovery candidates to catch brittleness
before integration.

## Problem Statement

Discovery candidates may pass initial validation but fail in production due to:

- Overfitting to the validation set
- Sensitivity to input distributions not in the test set
- Edge cases not represented in validation data

## Solution

### New Components

#### 1. HoldoutValidator (`src/discovery/HoldoutValidator.ts`)

Reserves a portion of training data unseen during discovery to validate
candidates.

**Key Features:**

- Configurable holdout percentage (default: 20%)
- Seeded random splitting for reproducibility
- Performance gap detection (holdout error - training error)
- Rejection when performance gap exceeds threshold

**API:**

```typescript
const validator = new HoldoutValidator({
  holdoutPercentage: 0.2,
  seed: 42,
  maxPerformanceGap: 0.1,
});

const result = validator.validateWithGap(creature, trainingDir, holdoutDir);
```

#### 2. BrittlenessScorer (`src/discovery/BrittlenessScorer.ts`)

Tests candidates with perturbed inputs and measures output variance.

**Key Features:**

- Configurable perturbation magnitude
- Multiple perturbations per input for statistical validity
- Brittleness score combining mean output change and variance
- Rejection when brittleness exceeds threshold

**API:**

```typescript
const scorer = new BrittlenessScorer({
  perturbationMagnitude: 0.1,
  perturbationsPerInput: 5,
  brittlenessThreshold: 0.5,
  seed: 42,
});

const result = scorer.computeBrittleness(creature, sampleInputs);
```

#### 3. EnhancedDiscoveryValidator (`src/discovery/EnhancedDiscoveryValidator.ts`)

Combines holdout validation and brittleness scoring into a unified validator.

**Key Features:**

- Runs both checks (when enabled)
- Computes combined brittleness score
- Verbose logging for analysis
- Batch validation support

**API:**

```typescript
const validator = new EnhancedDiscoveryValidator({
  holdout: { enabled: true, holdoutPercentage: 0.2 },
  brittleness: { enabled: true, perturbationMagnitude: 0.1 },
  verbose: true,
});

const result = validator.validateCandidate(baseCreature, candidate, dataDir);
```

### Integration

#### BatchDiscoveryValidator Updates

The existing `BatchDiscoveryValidator` has been extended with:

- New options for holdout and brittleness configuration
- `validateBatchWithEnhanced()` method that runs enhanced validation
- `isEnhancedValidationEnabled()` helper method
- Enhanced rejection statistics tracking

**Usage:**

```typescript
const validator = new BatchDiscoveryValidator({
  feedbackLoop: false,
  holdout: {
    enabled: true,
    holdoutPercentage: 0.2,
    maxPerformanceGap: 0.1,
  },
  brittleness: {
    enabled: true,
    perturbationMagnitude: 0.1,
    brittlenessThreshold: 0.5,
  },
  dataDir: "/path/to/data",
});

const results = validator.validateBatchWithEnhanced(baseCreature, candidates);
```

## Configuration Options

### Holdout Options

| Option              | Type    | Default | Description                      |
| ------------------- | ------- | ------- | -------------------------------- |
| `enabled`           | boolean | false   | Enable holdout validation        |
| `holdoutPercentage` | number  | 0.2     | Portion of data to reserve       |
| `seed`              | number  | random  | Seed for deterministic splitting |
| `maxPerformanceGap` | number  | ∞       | Maximum allowed performance gap  |
| `costName`          | string  | "MSE"   | Cost function for evaluation     |

### Brittleness Options

| Option                  | Type    | Default | Description                          |
| ----------------------- | ------- | ------- | ------------------------------------ |
| `enabled`               | boolean | false   | Enable brittleness scoring           |
| `perturbationMagnitude` | number  | 0.1     | Max perturbation size (0-1)          |
| `perturbationsPerInput` | number  | 5       | Number of perturbations per input    |
| `seed`                  | number  | random  | Seed for deterministic perturbations |
| `brittlenessThreshold`  | number  | ∞       | Maximum allowed brittleness score    |

## Test Coverage

- 9 tests for HoldoutValidator
- 12 tests for BrittlenessScorer
- 10 tests for EnhancedDiscoveryValidator
- 13 tests for BatchDiscoveryValidator (including 5 new tests)

Total: 44 passing tests

## Files Changed

### New Files

- `src/discovery/HoldoutValidator.ts`
- `src/discovery/BrittlenessScorer.ts`
- `src/discovery/EnhancedDiscoveryValidator.ts`
- `test/discovery/HoldoutValidator.ts`
- `test/discovery/BrittlenessScorer.ts`
- `test/discovery/EnhancedDiscoveryValidator.ts`

### Modified Files

- `src/discovery/BatchDiscoveryValidator.ts`
- `test/discovery/BatchDiscoveryValidator.ts`

## Development Notes

- Followed TDD approach (tests written before implementation)
- Used Australian English spelling throughout
- All code passes `quality.sh` checks
- No external dependencies added

## Related Issues

- Issue #1308: Reduce brittleness: Enhanced discovery candidate validation with
  holdout testing
- Part of the "Brilliant but Brittle" initiative
