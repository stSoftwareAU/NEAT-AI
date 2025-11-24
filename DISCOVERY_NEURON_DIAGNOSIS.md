# Discovery Neuron Candidate Diagnosis

Date: 24-Nov-2025

## Issues Identified

### A) Missing Re-scoring Performance in Summary ✅ FIXED

**Status**: Fixed - Re-scoring time is now tracked and logged separately in
DiscoveryRunner.

**Changes Made**:

- Added `reScoringTime` field to `DiscoveryDirResult` interface
- Track re-scoring time during candidate evaluation
- Log re-scoring phase timing when verbose logging is enabled

**Location**: `src/discovery/DiscoveryRunner.ts`

---

### B) Focus Selection Performance (3m 17s)

**Issue**: Focus selection takes 3m 17s, with Rust `rankFocusNeurons` taking
197s (3m 17s).

**Root Cause**: The Rust `rankFocusNeurons` function is already in Rust but is
slow:

- Processing 461 neurons
- Taking ~197 seconds (0.43 seconds per neuron)
- This is unexpectedly slow according to the logs

**Recommendations**:

1. **Profile the Rust code** - The Rust ranking is already implemented, but
   needs optimization
2. **Check if GPU acceleration is available** - Logs show "using CPU fallback"
   might be an issue
3. **Consider batching or parallelization** - If ranking neurons sequentially,
   parallelize
4. **Review the ranking algorithm** - May be doing unnecessary work per neuron

**Note**: The focus selection is already in Rust, so migration isn't needed -
optimization is.

**Location**: Rust discovery library (`rankFocusNeurons` function)

---

### C) All 30 Helpful Neuron Candidates Failing

**Issue**: All 30 neuron candidates show essentially zero improvement:

- `error=0.584667` (same as original)
- `score=0.4151` (same as original)
- `delta=-1.200e-7` (essentially zero, tiny negative)
- `expected +0.00623%` but actual is `0%`
- All show `improved=no`

**Observations from Logs**:

```
[NEAT-AI-Discovery][verbose] Target output-0 best candidate from input-435 improved 0.0001 but remained below threshold 0.0100 (improved 23383, worsened 22606, suggested weight -1.0000).
```

Rust analysis suggests weights like `-1.0000`, but when neurons are added and
evaluated, they don't improve.

**Possible Root Causes**:

1. **Neurons Need Training** ⚠️ MOST LIKELY
   - New neurons are added with initial weights/biases from Rust analysis
   - These are statistical estimates, not trained values
   - Neurons may need training to be effective
   - **Solution**: Consider training new neurons before evaluation, or use a
     more aggressive weight initialization

2. **Weight/Bias Initialization Too Conservative**
   - Rust suggests weights like `-1.0000` or `1.0000`
   - But these might be too small or the bias might prevent firing
   - **Solution**: Scale weights more aggressively, or adjust bias
     initialization

3. **Neuron Not Contributing to Output**
   - Neuron might be added but not actually affecting the output
   - Could be due to activation function or connection topology
   - **Solution**: Verify neurons are actually connected and contributing

4. **Evaluation Without Training**
   - Neurons are evaluated immediately after addition
   - Without training, they may not perform as Rust analysis predicted
   - **Solution**: Add a training step for new neurons before evaluation

**Diagnostic Steps**:

1. **Check actual weight/bias values** in the candidate files:
   - Location:
     `~/src/GRQ/.discovery/candidates/ae2f0467/2025-11-24T01-50-26-671Z/`
   - Files: `candidate-add-neurons.json`, `candidate-add-neurons-2.json`, etc.
   - Look for `synapses` array and check `weight` values
   - Look for `neurons` array and check `bias` values

2. **Compare Rust suggested weights vs actual weights**:
   - Rust log shows: `suggested weight -1.0000`
   - Check if this matches what's in the JSON files

3. **Check if neurons are actually firing**:
   - Add diagnostic logging to show neuron activations
   - Verify neurons are contributing to output

4. **Consider weight scaling**:
   - If weights are too small, try scaling them (e.g., 2x or 5x)
   - Or use a more aggressive initialization strategy

**Recommended Fixes**:

1. **Immediate**: Add diagnostic logging to show weight/bias values when neurons
   fail
2. **Short-term**: Try scaling suggested weights by a factor (e.g., 2x-5x)
3. **Long-term**: Consider training new neurons before evaluation, or use a more
   sophisticated initialization strategy

**Code Locations**:

- Neuron addition:
  `src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts:3819-3919`
- Weight/bias assignment: Lines 3857, 3875, 3883
- Candidate building: `src/discovery/DiscoveryCandidates.ts:497-525`

---

## Next Steps

1. ✅ Re-scoring performance tracking - **COMPLETE**
2. ⏳ Profile Rust `rankFocusNeurons` for optimization
3. ⏳ Investigate neuron weight/bias initialization - check candidate JSON files
4. ⏳ Consider weight scaling or training strategy for new neurons
