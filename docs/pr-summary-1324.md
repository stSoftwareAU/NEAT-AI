## Summary

Implements multi-generational ancestral learning for memetic evolution as described in issue #1324.

### Changes

1. **Extended `MemeticInterface`** (`src/blackbox/MemeticInterface.ts`):
   - Added `MemeticAncestorSnapshot` interface for storing historical memetic state
   - Added optional `ancestry` array to `MemeticInterface` for tracking weight/bias evolution over multiple generations
   - Added `DEFAULT_ANCESTRY_DEPTH` constant (3 generations) to control memory usage

2. **Created `MemeticTrajectory` module** (`src/blackbox/MemeticTrajectory.ts`):
   - `analyseWeightTrajectory()`: Analyses weight/bias changes across generations to identify consistent improvement directions
   - `calculateTrajectoryMomentum()`: Computes a momentum factor (0.5-2.0) based on trajectory consistency
   - `createAncestorSnapshot()`: Creates snapshots for ancestry tracking
   - `addToAncestry()`: Manages the circular buffer of ancestor snapshots

3. **Updated `FineTune`** (`src/blackbox/FineTune.ts`):
   - Modified `quantumAdjust()` to accept optional momentum parameters
   - Updated `tuneRandomize()` to:
     - Build ancestry history using a circular buffer
     - Calculate and apply trajectory momentum for each weight/bias adjustment
     - Bias adjustments towards consistent historical improvement directions

### Technical Details

- **Memory efficiency**: Uses a circular buffer with configurable depth (default 3 generations) to limit memory usage
- **Momentum calculation**:
  - High consistency (0.8-1.0) => aggressive adjustment (factor up to 2.0)
  - Medium consistency (0.5-0.8) => moderate adjustment (factor 1.0-1.5)
  - Low consistency (0-0.5) => conservative adjustment (factor 0.5-1.0)
- **Trajectory analysis**: Examines differences between consecutive generations to determine direction and consistency

## Evidence

Unable to generate screenshot: This is a library/algorithm implementation with no visual interface. The improvement is in the memetic fine-tuning algorithm internals.

## Test Plan

Added comprehensive tests in `test/blackbox/MemeticAncestry.ts`:

- `MemeticInterface should include ancestry history` - Verifies ancestry can be stored and exported
- `fineTuneImprovement should build ancestry history` - Tests that fine-tuning builds ancestry over multiple rounds
- `ancestry should be preserved during breeding` - Ensures ancestry survives offspring creation
- `analyseWeightTrajectory should identify consistent directions` - Tests trajectory direction detection
- `analyseWeightTrajectory should handle no ancestry` - Edge case handling for no history
- `calculateTrajectoryMomentum should compute momentum factor` - Verifies momentum calculation bounds
- `ancestry circular buffer should limit depth` - Tests max depth enforcement
- `bias trajectory should be analysed separately` - Tests bias-specific trajectory analysis

All existing tests continue to pass, including:
- `test/blackbox/MemeticPreserved.ts`
- `test/blackbox/MemeticBreed.ts`
