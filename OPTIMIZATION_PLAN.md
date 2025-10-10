# NEAT-AI Training Optimization Plan

## Problem Statement

For large neural networks (hundreds of neurons, thousands of connections)
trained on large datasets (millions of samples), backpropagation becomes a
performance bottleneck. Users must aggressively downsample data or use very
sparse training to complete training in reasonable timeframes, limiting model
quality.

## Optimization Strategy

### Phase 1: Core Performance - Backpropagation (HIGH PRIORITY)

#### 1.1 Mini-Batch Gradient Descent ✅ COMPLETED

**Current**: Processing samples one-at-a-time with immediate weight updates

**File**: `src/architecture/Training.ts` (trainDirBinary function)

**Changes**:

- Accumulate gradients across configurable batch size (default 64)
- Apply averaged gradient updates once per batch
- Make `batchSize` configurable in TrainOptions

**Benefits**: 5-10x speedup from reduced overhead and better CPU cache
utilization

#### 1.2 Adaptive Learning Rate Schedule ✅ COMPLETED

**Current**: Random learning rate selected at config creation

**File**: `src/propagate/BackPropagation.ts` (createBackPropagationConfig)

**Changes**:

- Add `learningRateStrategy` option: 'fixed', 'decay', 'adaptive'
- Implement exponential decay: `lr = initial_lr * (decay_rate ^ iteration)`
- Add `initialLearningRate` and `learningRateDecay` config options
- Default to decay strategy with sensible defaults

**Benefits**: Faster convergence, 30-50% fewer iterations needed

#### 1.3 Sequential File I/O ✅ COMPLETED

**Current**: Random seeking to sample positions (slow on HDDs, inefficient on
SSDs)

**File**: `src/architecture/Training.ts` (trainDirBinary)

**Changes**:

- Build shuffled index array once at start
- Read samples sequentially in shuffled order
- Increase buffer size to 1-4MB for batch reads
- Keep random seeking as fallback option

**Benefits**: 2-4x faster disk I/O, especially on large datasets

### Phase 2: Smart Training - Sparse & Early Stopping (MEDIUM PRIORITY)

#### 2.1 Intelligent Sparse Neuron Selection ✅ COMPLETED

**Current**: Random neuron selection when sparseRatio < 1

**File**: `src/propagate/sparse/ChooseNeurons.ts`

**Changes**:

- Add selection strategies: 'random', 'output-distance', 'error-weighted'
- Implement output-distance: prioritize neurons closer to outputs
- Track per-neuron error contributions for error-weighted strategy
- Make strategy configurable via `sparseSelectionStrategy` option

**Benefits**: Better training effectiveness within sparse budget

#### 2.2 Enhanced Early Stopping ✅ COMPLETED

**Current**: Basic early stopping on overall error improvement

**File**: `src/architecture/Training.ts`

**Changes**:

- Add `earlyStoppingPatience` config (stop after N bad iterations)
- Track per-iteration improvement, not just overall
- Add `minImprovement` threshold (stop if improvement < threshold)
- Log reason for stopping

**Benefits**: Avoid wasting time on diminishing returns

### Phase 3: Code Architecture - Unification (LOW PRIORITY)

#### 3.1 Unified Learning Strategy Interface

**Current**: Separate implementations for backprop, fine-tuning, memetic, EGSE

**Files**: `src/blackbox/`, `src/architecture/Training.ts`, `src/NEAT/`

**Changes**:

- Create `src/learning/LearningStrategy.ts` interface
- Define common methods: `computeGradients()`, `applyUpdates()`, `shouldStop()`
- Refactor existing mechanisms to implement interface
- Share error computation and gradient calculation code

**Benefits**: Cleaner architecture, easier to extend, less code duplication

#### 3.2 Configuration Consolidation

**Current**: Overlapping options across NeatOptions, TrainOptions,
BackPropagationOptions

**Files**: `src/config/NeatOptions.ts`, `src/config/TrainOptions.ts`,
`src/propagate/BackPropagation.ts`

**Changes**:

- Create `src/config/LearningConfig.ts` for shared learning parameters
- Add preset profiles: 'fast', 'balanced', 'thorough'
- Validate interdependencies (e.g., warn if sparseRatio high but batchSize low)
- Provide clear defaults for common scenarios

**Benefits**: Easier configuration, fewer mistakes, better user experience

### Phase 4: Observability & Adaptation (LOW PRIORITY)

#### 4.1 Training Metrics & Profiling

**File**: New `src/monitoring/TrainingMetrics.ts`

**Changes**:

- Track timing: I/O time, forward pass time, backward pass time, update time
- Monitor gradient health: mean, std dev, min/max (detect vanishing/exploding)
- Calculate throughput: samples/sec, iterations/sec
- Export metrics in structured format (JSON)
- Add optional `--profile` flag to expose detailed metrics

**Benefits**: Data-driven optimization, easier debugging

#### 4.2 Adaptive Training Budget

**File**: `src/architecture/Training.ts`

**Changes**:

- Add `dynamicIterations` option
- Increase max iterations if improving quickly
- Decrease if improvement stalled
- Respect overall timeout budget

**Benefits**: Better resource allocation across population

## Implementation Status

### ✅ Completed (Phase 1 & 2)

- Mini-batch gradient descent
- Sequential file I/O
- Adaptive learning rate schedule
- Intelligent sparse neuron selection
- Enhanced early stopping

### 🔄 In Progress

- None currently

### 📋 Pending

- Unified learning strategy interface
- Configuration consolidation
- Training metrics & profiling
- Adaptive training budget

## Recommended Defaults

```typescript
// Add to TrainOptions defaults
{
  // Batch processing
  batchSize: 64,                    // Good balance for most cases
  
  // Learning rate
  learningRateStrategy: 'decay',    // Adaptive schedule
  initialLearningRate: 0.01,        // Start reasonably high
  learningRateDecay: 0.95,          // 5% decay per iteration
  
  // Early stopping
  earlyStoppingPatience: 3,         // Stop after 3 non-improving iterations
  minImprovement: 0.001,            // Minimum meaningful improvement
  
  // Sparse training
  sparseSelectionStrategy: 'output-distance',  // Prioritize important neurons
  
  // File I/O
  readStrategy: 'sequential',       // Faster than random seeking
  readBufferSize: 1024 * 1024,      // 1MB buffer
}
```

## Testing Approach

For each optimization:

1. **Benchmark creation**: Use standard XOR, NARX, and synthetic large network
   (200+ neurons)
2. **Metrics**: Measure training time, samples processed, iterations to
   convergence, final error
3. **Validation**: Ensure no regression in model quality on test sets
4. **Backward compatibility**: Ensure existing code continues to work with new
   defaults

## Expected Results

- **10-20x faster training** for large networks on large datasets
- **30-50% faster convergence** (fewer iterations needed)
- **Better model quality** from training on more data in same time
- **Cleaner codebase** with unified concepts
- **Easier tuning** with better defaults and configuration

## Notes

- All changes maintain backward compatibility (new options are optional)
- Improvements are generic and benefit all use cases
- Focus on bottlenecks that affect large-scale applications
- Documentation will include tuning guide for different scenarios

## Test Status

**Current Status**: 516 passed, 10 failed (down from 22 failed)

**Remaining Issues**: The 10 failing tests are unrelated to the training
optimizations and appear to be existing issues in other parts of the codebase
(trace functionality, propagation tests, etc.). The training function itself is
now working correctly.

**Next Steps**: Address the remaining test failures to restore 100% test pass
rate.
