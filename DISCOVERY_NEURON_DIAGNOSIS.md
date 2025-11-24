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

### B) Focus Selection Performance (2m 35s)

**Issue**: Focus selection takes 2m 35s, with Rust `rankFocusNeurons` taking
155s. The `listViableNeurons` function accounts for the entire 155s delay.

**Root Cause**: The Rust `rankFocusNeurons` function is taking 155 seconds when
it should take < 1 second (expected: ~300ms for 460 neurons with 45,000
records).

- Processing 460 neurons with ~45,000 records
- Taking ~155 seconds (0.34 seconds per neuron)
- Expected time: < 1 second total
- **578x slower than expected**

**Most Likely Causes** (based on RANK_FOCUS_NEURONS_SPEC.md):

1. **Reading Parquet File Multiple Times** - The Rust code may be reading the
   parquet file once per neuron (460 file reads!) instead of reading it once and
   processing all neurons. This would explain the ~0.34s per neuron timing.

2. **Recalculating Impact Per Neuron** - The Rust code may be doing a full graph
   traversal for each neuron (460 traversals) instead of a single backward pass
   that calculates impact for all neurons at once.

3. **Allocating Inside Loops** - The Rust code may be creating new
   vectors/arrays inside hot loops, causing millions of unnecessary allocations.

4. **Not Using Vectorized Operations** - The Rust code may be using loops
   instead of Polars/Arrow vectorized operations for aggregations.

**Diagnostics Added**:

Enhanced logging now includes:

- Parquet file size
- Number of neurons and synapses
- Per-neuron timing breakdown
- Reference to optimization guidelines

**Recommendations**:

1. **Profile the Rust code** - Use `cargo flamegraph` or `perf` to identify the
   exact bottleneck
2. **Check RANK_FOCUS_NEURONS_SPEC.md** - Follow the optimization guidelines
   (read parquet once, single backward pass, vectorized operations)
3. **Verify release build** - Ensure the Rust library is built in release mode
   (`cargo build --release`)
4. **Review Rust implementation** - Check the NEAT-AI-Discovery Rust library for
   the common performance pitfalls listed in the spec

**Note**: The focus selection is already in Rust, so migration isn't needed -
optimization is. The TypeScript code correctly calls the Rust function after
merging parquet files.

**Location**:

- TypeScript:
  `src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts:2936-3023`
- Rust: NEAT-AI-Discovery library (`rank_focus_neurons` function)
- Spec: `RANK_FOCUS_NEURONS_SPEC.md`

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
