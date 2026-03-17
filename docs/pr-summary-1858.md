## Summary

Updated COMPARISON.md to accurately reflect the current implementation state.
Closes #1858.

### Changes made

1. **Section 6 (Regularisation)**: Documented `WeightRegularisationConfig` and
   `BiasRegularisationConfig` with L2 regularisation support. Removed L1/L2 from
   the "missing" list since L2 is now implemented.

2. **Section 12 (Time Series)**: Documented the `feedbackLoop` feature in
   `NeatArguments` that enables recurrent connections (self-loops, backward
   connections) for time-series support. Updated "missing" to "still missing"
   for remaining items.

3. **Training Methods & Unique Approaches**: Added Predictive Coding as a
   documented training paradigm (`PredictiveCodingConfig`) with its own unique
   approach section describing inference settling and Hebbian learning.

4. **Section 4 (Batch Processing)**: Distinguished `BatchDiscoveryValidator`
   (batch validation of discovery candidates with caching and early-exit) from
   the still-missing parallel creature evaluation during training.

5. **Section 7 (Hyperparameters)**: Documented `AdaptiveMutationThresholds`,
   `PlateauDetector`, and `StabilityAdaptationConfig` as existing adaptive
   mechanisms, updating "missing" to "still missing" for remaining items.

6. **Discovery Enhancements**: Added documentation for success/failure caching,
   cache eviction, cache-informed candidate building, and disk space monitoring
   as both unique features and a new unique approach section.

7. **Ensemble Diversity & Quantum Step**: Documented `EnsembleDiversityConfig`
   and `QuantumStepConfig` in the unique features section.

8. **Conclusion**: Updated to reference the new features (predictive coding,
   adaptive hyperparameters, caching, regularisation).

## Evidence

All 4493 tests pass including 10 new tests verifying that every documented
feature is accessible through the `createNeatConfig` API.

## Test Plan

- Added `test/config/ComparisonDocumentedFeatures.ts` with 10 tests:
  - Weight regularisation config accessibility and custom values
  - Bias regularisation config accessibility and custom values
  - feedbackLoop config toggles recurrent mode
  - Predictive coding config accessibility and custom values
  - Adaptive mutation thresholds config accessibility
  - Plateau detection config accessibility
  - Stability adaptation config accessibility
  - Ensemble diversity config accessibility
  - Quantum step config accessibility
  - All documented configs have sensible defaults
