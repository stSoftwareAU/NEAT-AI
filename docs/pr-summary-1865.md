## Summary

Add k-fold cross-validation support for fitness evaluation during NEAT evolution. Closes #1865.

Cross-validation improves generalisation by evaluating creatures on held-out data folds during training, reducing overfitting to a single train/test split. When enabled, training data is split into k folds (default k=5), and each creature's fitness is evaluated as the average validation error across all folds.

Key features:
- **K-fold cross-validation**: Configurable fold count (1-20) via `crossValidation: { enabled: true, folds: 5 }`
- **Backward compatible**: Default behaviour (disabled, or k=1) matches existing single-split evaluation
- **Validation-based early stopping**: Uses held-out fold performance for early stopping during backpropagation
- **Graceful fallback**: Falls back to single-split training when data is insufficient for the requested number of folds
- **Full pipeline integration**: Works with existing batch processing, sparse training, and the evolution loop

## Evidence

- 7 config tests verify parsing, defaults, CLI coercion, and validation bounds
- 8 KFoldSplitter tests verify fold creation, record distribution, cleanup, and error handling
- 10 cross-validation integration tests verify training with various fold counts, validation early stopping, backward compatibility, and evolveDataSet integration
- All 25 new tests pass; existing tests remain unaffected

## Test Plan

- `test/config/CrossValidationConfig.ts` - Configuration parsing, defaults, CLI coercion, validation
- `test/architecture/KFoldSplitter.ts` - K-fold data splitting, record distribution, cleanup
- `test/architecture/CrossValidation.ts` - End-to-end cross-validation training integration
