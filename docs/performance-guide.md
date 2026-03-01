# Performance Optimisation Guide

This guide captures learnings from systematic performance investigations in
NEAT-AI, including several WASM migration experiments and TypeScript-level
optimisations. The goal is to help contributors identify which optimisation
strategies are likely to succeed and which are not worth pursuing.

All benchmarks were run on Apple M4 Pro, Deno 2.7.x (aarch64-apple-darwin).

## When WASM Migration Works

WASM migration is effective for **tight numerical loops** with high arithmetic
intensity relative to data marshalling cost. The existing WASM coverage in
NEAT-AI is well-targeted:

- **Activation functions** — pure numerical transforms applied per-neuron
- **Forward pass** — batched matrix-style computation
- **Error distribution** — fused gradient arithmetic
  ([#1377](https://github.com/stSoftwareAU/NEAT-AI/issues/1377))
- **Batch accumulation** — weight/bias gradient sums
- **SIMD operations** — leveraging hardware vector instructions in Rust

These operations share a common pattern: the data is already in a compact
numerical format (typed arrays), the computation is CPU-intensive, and the
result is a similarly compact numerical output. The JS↔WASM boundary crossing
cost (~100–500 ns) is negligible relative to the computation time.

## When WASM Migration Does NOT Work

Four systematic investigations
([#1630](https://github.com/stSoftwareAU/NEAT-AI/issues/1630),
[#1631](https://github.com/stSoftwareAU/NEAT-AI/issues/1631),
[#1632](https://github.com/stSoftwareAU/NEAT-AI/issues/1632),
[#1633](https://github.com/stSoftwareAU/NEAT-AI/issues/1633)) explored migrating
remaining TypeScript hotspots to Rust/WASM. All four yielded negative results,
producing valuable learnings.

### Graph-Structure Manipulation (Breeding/Crossover)

**Investigation:** [#1632](https://github.com/stSoftwareAU/NEAT-AI/issues/1632)

The WASM topology computation itself was 300–1,600x faster than TypeScript in
isolation, but serialisation overhead dominated the end-to-end time:

| Size   | WASM Call Only | Serialise + WASM | TS Breed |
| ------ | -------------- | ---------------- | -------- |
| Small  | 1.5 µs         | 264 µs           | 468 µs   |
| Medium | 48 µs          | 23 ms            | 47 ms    |
| Large  | 1.1 ms         | 751 ms           | 1.7 s    |

Converting UUID-keyed `Map<string, Neuron>` objects to flat `Uint32Array` for
WASM consumed 99%+ of end-to-end time. V8's hash tables are already highly
optimised for this workload.

A follow-up investigation
([#1644](https://github.com/stSoftwareAU/NEAT-AI/issues/1644)) confirmed that
even pure TypeScript allocation optimisations (eliminating thousands of
intermediate objects) yielded only ~1–2% improvement, because V8's generational
garbage collector handles short-lived objects efficiently.

### Trivially Fast Operations (Rejection Sampling, Compatibility Scoring)

**Investigations:**
[#1631](https://github.com/stSoftwareAU/NEAT-AI/issues/1631),
[#1633](https://github.com/stSoftwareAU/NEAT-AI/issues/1633)

When the JS computation itself takes only 1–2 µs, the WASM boundary crossing
overhead alone (100–500 ns for argument marshalling) represents a significant
fraction of the total time. Serialising the topology for WASM took ~70 µs — 50x
more than the computation being migrated.

| Metric                     | Time    | Notes                        |
| -------------------------- | ------- | ---------------------------- |
| JS rejection sampling      | 1.4 µs  | The actual computation       |
| WASM call (pre-serialised) | 48 µs   | Just the WASM function       |
| Serialisation overhead     | 70.5 µs | Extracting topology for WASM |

### Cache-Dominated Paths

**Investigation:** [#1633](https://github.com/stSoftwareAU/NEAT-AI/issues/1633)

The LRU distance cache
([#1293](https://github.com/stSoftwareAU/NEAT-AI/issues/1293)) already
eliminates most redundant compatibility scoring work:

| Metric             | Time/iter | Notes                        |
| ------------------ | --------- | ---------------------------- |
| Cache hit          | 66.3 ns   | Already below WASM overhead  |
| Cache miss         | 521.2 ns  | 7.86x slower than hit        |
| Full pairwise warm | 118.9 µs  | ~97 ns/pair for 50 creatures |

Cache hit rates are high: 100% for stable populations, ~64% with 20% population
turnover. At 66 ns per cache hit, migrating to WASM would actually be slower
than the cached TypeScript path.

### Sequential Graph Traversal (Backpropagation Orchestration)

**Investigation:** [#1630](https://github.com/stSoftwareAU/NEAT-AI/issues/1630)

Backpropagation is inherently sequential — each neuron's gradient depends on
downstream neurons. Profiling a medium network (117 neurons, 910 synapses)
showed:

| Component                 | Time   | % of Total |
| ------------------------- | ------ | ---------- |
| Recursive error traversal | 4.3 ms | ~91%       |
| Weight/bias accumulation  | 0.4 ms | ~9%        |
| WASM boundary crossings   | 15 µs  | **~0.3%**  |

The fused error distribution
([#1377](https://github.com/stSoftwareAU/NEAT-AI/issues/1377)) had already
eliminated the largest per-neuron boundary crossing overhead. The remaining 91%
of time is in recursive TypeScript graph traversal that cannot be parallelised
or offloaded without moving the entire creature state into WASM.

## What DOES Work for Optimisation

The most effective optimisations in NEAT-AI have been TypeScript-level
algorithmic improvements.

### Batching Expensive Operations

**PR:** [#1590](https://github.com/stSoftwareAU/NEAT-AI/pull/1590) (from
[#1583](https://github.com/stSoftwareAU/NEAT-AI/issues/1583))

Deferring `fix()` and `validate()` calls until after the full mutation loop
(instead of calling them after every atomic mutation) yielded 33–51%
improvement:

| Benchmark                             | Before   | After   | Speedup |
| ------------------------------------- | -------- | ------- | ------- |
| 50 creatures, mutationAmount=3        | 24.5 ms  | 16.5 ms | **33%** |
| 50 creatures, mutationAmount=5        | 33.9 ms  | 20.6 ms | **39%** |
| 50 creatures, mutationAmount=10       | 61.6 ms  | 31.7 ms | **49%** |
| 20 large creatures, mutationAmount=5  | 91.2 ms  | 52.3 ms | **43%** |
| 20 large creatures, mutationAmount=10 | 162.9 ms | 80.3 ms | **51%** |

**Lesson:** Look for operations that are repeated unnecessarily in loops.
Topology cache rebuilds and graph traversal are expensive; doing them once
instead of N times gives linear speedup.

### Removing Redundant Work

**PR:** [#1591](https://github.com/stSoftwareAU/NEAT-AI/pull/1591) (from
[#1584](https://github.com/stSoftwareAU/NEAT-AI/issues/1584))

Eliminating duplicate `validate()` calls in `AddConnection.mutate()` yielded
8–11% improvement:

| Creature Size | Before   | After    | Improvement |
| ------------- | -------- | -------- | ----------- |
| Sparse        | 128.9 µs | 114.5 µs | **11.2%**   |
| Medium        | 617.0 µs | 555.9 µs | **9.9%**    |
| Large         | 2.4 ms   | 2.2 ms   | **8.3%**    |

**Lesson:** Audit call chains for repeated validation, caching, or
initialisation that could be eliminated.

### Better Cloning Strategies

**PR:** [#1593](https://github.com/stSoftwareAU/NEAT-AI/pull/1593) (from
[#1586](https://github.com/stSoftwareAU/NEAT-AI/issues/1586))

Replacing `Creature.fromJSON(creature.exportJSON())` with `shallowClone()` for
in-process mutation backup yielded 2.4–3.5x improvement:

| Creature Size | JSON Clone | shallowClone | Speedup   |
| ------------- | ---------- | ------------ | --------- |
| Small         | 21.8 µs    | 9.2 µs       | **2.37x** |
| Medium        | 1.0 ms     | 283.6 µs     | **3.54x** |
| Large         | 5.0 ms     | 1.6 ms       | **3.13x** |

**Lesson:** JSON round-tripping is expensive. When data stays in-process,
structured cloning or shallow copies avoid serialisation overhead entirely.

### Better Algorithms

**PR:** [#1594](https://github.com/stSoftwareAU/NEAT-AI/pull/1594) (from
[#1587](https://github.com/stSoftwareAU/NEAT-AI/issues/1587))

Replacing O(N²) enumeration of available connections with rejection sampling
yielded 9–12% improvement:

| Creature Size | Before   | After    | Improvement |
| ------------- | -------- | -------- | ----------- |
| Sparse        | 125.9 µs | 110.4 µs | **12%**     |
| Medium        | 589.8 µs | 537.6 µs | **9%**      |
| Large         | 2.3 ms   | 2.1 ms   | **9%**      |
| Very Large    | 14.6 ms  | 13.2 ms  | **10%**     |

**Lesson:** For sparse networks (the typical NEAT scenario), probabilistic
algorithms that exploit sparsity outperform exhaustive enumeration. The
rejection sampling approach finds valid connections in 1–2 attempts, eliminating
full list construction.

## The Serialisation Wall

The JS↔WASM boundary crossing cost is the primary barrier for migrating
remaining operations. The pattern is consistent across all negative-result
investigations:

1. **Data lives in JS objects** — `Map<string, Neuron>`, UUID-keyed lookups,
   polymorphic objects
2. **Serialisation to WASM** — converting to flat typed arrays takes 50–1,000x
   longer than the computation itself
3. **WASM computation** — typically 300–1,600x faster than JS in isolation
4. **Serialisation back** — reconstructing JS objects from WASM output

The net result is that serialisation overhead cancels out WASM compute gains for
all remaining non-numerical operations.

### Future Directions

Future performance gains from WASM require **architectural changes** rather than
piecemeal migration:

- **WASM-resident creature state** — keeping the neural network topology in WASM
  memory permanently, eliminating per-operation serialisation
- **Batch API design** — grouping multiple operations into single WASM calls to
  amortise boundary crossing cost
- **Typed array topology** — replacing `Map<string, Neuron>` with indexed arrays
  that can be shared directly with WASM via `SharedArrayBuffer`

These are significant architectural changes that would affect the entire
codebase and should be evaluated carefully against the complexity they
introduce.

## Decision Framework

When considering a performance optimisation, use this checklist:

### Try WASM migration when:

- [ ] The operation involves tight numerical loops (activation, gradient, loss)
- [ ] Input/output data is already in typed arrays or can be cheaply converted
- [ ] The computation takes >10 µs per call (to justify boundary crossing)
- [ ] There is no caching layer that already short-circuits the computation

### Try TypeScript-level optimisation when:

- [ ] The operation involves graph structures, Maps, or string-keyed objects
- [ ] There are repeated/redundant calls that could be batched or eliminated
- [ ] Serialisation (JSON, structured clone) could be replaced with lighter
      alternatives
- [ ] An algorithmic improvement (better data structure, probabilistic method)
      could reduce complexity class

### Measure before committing:

- [ ] Create a benchmark that isolates the operation being optimised
- [ ] Measure both the computation and any serialisation/boundary overhead
- [ ] A negative result is a valuable result — document it and move on
