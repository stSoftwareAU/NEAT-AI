# Discovery Defaults Analysis - Production Tuning

Date: 23-Nov-2025

## Current Defaults (Before)

| Setting                             | Current Default | Problem                                  |
| ----------------------------------- | --------------- | ---------------------------------------- |
| `discoveryMinImprovementPercentage` | 0.1 (10%)       | ❌ Too high - rejects 1.58% improvements |
| `discoveryAnalysisTimeoutMinutes`   | 3 minutes       | ❌ Too short - hitting deadlines         |
| `discoveryTimeOutMinutes`           | 0 (disabled)    | ⚠️ Must be set by user                   |
| `discoveryMaxNeurons`               | 0 (must set)    | ⚠️ Must be set by user                   |
| `discoverySampleRate`               | 0.05 (5%)       | ✅ OK                                    |
| `discoveryBatchSize`                | 128             | ✅ OK                                    |

## Production Evidence

From your production logs:

- **Best candidate**: 1.58% improvement (0.0158)
- **Rejected because**: Below 10% threshold
- **Analysis timeout**: Hitting deadlines after 10 minutes
- **Rust ranking**: Taking 161 seconds (slow but acceptable)

All 33 candidates failed because:

1. Threshold too high (10%)
2. Analysis timing out (3 min insufficient)
3. Weight initialization issues (separate bug)

## Recommended Defaults (Production-Tested)

Based on your real-world results:

| Setting                             | New Default    | Reason                                                |
| ----------------------------------- | -------------- | ----------------------------------------------------- |
| `discoveryMinImprovementPercentage` | **0.01 (1%)**  | Accept 1%+ improvements (would catch 1.58% candidate) |
| `discoveryAnalysisTimeoutMinutes`   | **10 minutes** | You used 10m in production, avoid timeouts            |
| `discoveryTimeOutMinutes`           | **1 minute**   | Recording phase (1 min sufficient for 50k records)    |
| `discoveryMaxNeurons`               | **6**          | You used 6 in production successfully                 |

## Impact of Changes

### With 10% threshold (current):

- ❌ Rejects candidates with < 10% improvement
- ❌ Your best (1.58%) rejected
- ❌ **0 improvements accepted**

### With 1% threshold (proposed):

- ✅ Accepts candidates with 1%+ improvement
- ✅ Your best (1.58%) would be accepted
- ✅ **More discoveries succeed**

### Threshold Comparison

```
0.1% (0.001) - Too permissive, noise level
1.0% (0.01)  - Recommended: Real improvements ✅
1.58%        - Your best production candidate
10% (0.1)    - Current default ❌ Too restrictive
```

## Other Production Issues to Fix

These are **separate bugs**, not defaults:

1. **Synapse Weight Initialization** 🔴 CRITICAL
   - Predicted: +0.08% improvement
   - Actual: -7.5% degradation
   - This is a bug in weight init, not a defaults issue

2. **Rust Ranking Speed** ⚠️
   - Taking 161 seconds
   - Should investigate but not blocking

3. **Harmful Threshold**
   - Currently: -0.1 (-10%)
   - Could adjust to -0.01 (-1%) to be symmetric
