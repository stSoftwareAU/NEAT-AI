# Discovery Production Issues Analysis

Date: 23-Nov-2025  
Discovery ID: 429a0b38

## Critical Issues

###  A) Duplicate Logging

**Finding**: Discovery evaluation results are logged twice:
1. `[DiscoveryRunner] Discovery 429a0b38 evaluation summary:` - from NEAT-AI library
2. `Discovery evaluation summary:` - from application code (not in library)

**Resolution**: The second log is coming from your application code, not from NEAT-AI. Check your application's discovery integration for duplicate logging. The NEAT-AI library logs only once with the `[DiscoveryRunner]` prefix.

### B) Prediction vs Actual Mismatch - CRITICAL ⚠️

**Finding**: ALL 33 candidates failed - predictions were completely wrong:

| Candidate Type | Expected | Actual | Result |
|----------------|----------|--------|--------|
| Add neurons (30) | +0.00144% | -0.000000000...% (tiny decline) | FAILED |
| Add synapses (2) | +0.000821% | -7.511% (major decline!) | FAILED |
| Change squash (1) | +0.0000...% | -0.236% | FAILED |

**Root Causes to Investigate**:

1. **Weight Initialization**: When adding new synapses/neurons, the initial weights may be initialized incorrectly
   - Rust predicts improvement with optimal weights
   - But actual creature uses default/random initialization
   - This mismatch causes failures

2. **Synapse Candidates Show Largest Mismatch**:
   - Expected: +0.000821% improvement
   - Actual: -7.511% decline
   - This is catastrophic - adding synapses makes things MUCH worse
   - Suggests weight initialization or connection issues

3. **Rust Analysis Reaching Deadlines**:
   ```
   [NEAT-AI-Discovery][verbose] analyse_neurons reached analysis deadline
   [NEAT-AI-Discovery][verbose] analyse_synapses reached analysis deadline
   ```
   - Analysis is timing out, returning partial/incomplete results
   - May not have fully optimized the candidates

4. **Candidates Below Threshold**:
   ```
   Target 6d61d884 best candidate improved 0.0002 but remained below threshold 0.1000
   Target location-error-00001 improved 0.0158 but remained below threshold 0.1000  
   Target 3313ad81 improved 0.0001 but remained below threshold 0.1000
   ```
   - All candidates are below the 10% improvement threshold
   - This threshold may be too high for incremental improvements

**Recommendations**:

1. **Increase Analysis Timeout**: The analysis is hitting deadlines. Increase `discoveryAnalysisTimeoutMinutes`.

2. **Lower Improvement Threshold**: Try `discoveryMinImprovementPercentage: 0.01` (1%) instead of 0.1 (10%).

3. **Investigate Weight Initialization**: Check how initial weights are set when adding synapses/neurons.

4. **Test Synapse Addition Separately**: The synapse candidates are causing the worst degradation - this needs immediate investigation.

### C) No Successful Discoveries

**Finding**: No improvements in production runs for a while.

**Contributing Factors**:
1. Prediction mismatch (issue B above)
2. Possibly too high improvement threshold (10%)
3. Analysis timeouts causing incomplete analysis
4. All candidates to same target neuron (`3f2ad02f`) - may indicate focus selection issue

### D) Neuron List JSON Export Location

**Finding**: The neuron list JSON **IS being exported**, but you're looking in the wrong directory!

**Correct Location**: 
```
.discovery/focus-analysis/429a0b38/2025-11-23T00-36-32-763Z-focus-selection.json
```

**Not Here** (this is for candidate creatures):
```
.discovery/candidates/429a0b38/2025-11-23T00-55-17-954Z/
```

The `focus-selection.json` file contains:
- All 64 candidate neurons ranked by `potentialErrorReduction` (descending)
- Each neuron's `totalError`, `impact`, `weightedScore`
- Which 6 were selected for analysis
- Low-impact neurons below cost-of-growth threshold

## Timing Analysis (from Performance Summary)

- **Focus Selection**: 2m 41s 780ms (161s 768ms for Rust ranking - seems very slow!)
- **Rust Combined Analysis**: (blank - was not being measured, now fixed)
- **Squash Analysis**: 51s 819ms
- **Total Analysis**: 10m 57s 42ms

**Issue**: Rust focus ranking took 161 seconds (2m 41s), which is unexpectedly slow. This needs investigation.

## Configuration Recommendations

Try these settings in your `NeatOptions`:

```typescript
{
  discoveryMinImprovementPercentage: 0.01,  // Lower from 0.1 to 0.01 (1%)
  discoveryAnalysisTimeoutMinutes: 15,      // Increase from current timeout
  discoveryTimeOutMinutes: 2,               // Recording phase
  costOfGrowth: 0.001,                      // Lower growth cost threshold
}
```

## Next Steps

1. ✅ CSV fallback code removed
2. ⏳ Export neuron list JSON
3. ⏳ Investigate weight initialization for new synapses/neurons
4. ⏳ Investigate why Rust ranking is so slow (161 seconds)
5. ⏳ Review synapse candidate weight initialization (causing -7.5% degradation)
6. ⏳ Consider lowering improvement threshold to 1%

