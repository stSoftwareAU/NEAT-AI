# 🔲 WASM-Resident Creature Topology: Feasibility Analysis

Investigation for [#1642](https://github.com/stSoftwareAU/NEAT-AI/issues/1642),
part of the WASM performance optimisation series (#1639).

## 📋 Executive Summary

**Recommendation: Defer.**

A WASM-resident creature topology would not deliver meaningful end-to-end
performance gains given the current architecture. The fundamental obstacle is
not serialisation frequency but rather that topology operations are
**data-structure-bound** (Map lookups, UUID resolution, object allocation), not
**compute-bound**. Persisting topology in WASM linear memory would shift the
bottleneck from serialisation to synchronisation without eliminating it, while
introducing significant architectural complexity.

> [!NOTE]
> This analysis is scoped to the current TypeScript/Rust architecture. If the
> underlying topology representation changes (e.g., typed array topology per
> Section 5.2), the trade-offs should be re-evaluated.

---

## 🏗️ 1. Current Topology Usage Patterns

### 1.1 How Topology Is Structured

Creatures store topology as:

- `neurons[]` — Array of neuron objects (input, hidden, output, constant)
- `synapses[]` — Sorted array of connections (`from`, `to`, `weight`, `type`)
- `TopologyCaches` — Lazy-built indices for O(log n) inward lookups, connection
  existence checks, and hidden neuron UUID sets

### 1.2 How Often Topology Is Created, Modified, and Read

In a typical generation with population size **P**, mutation rate **R**, and
mutation amount **A**:

| Operation                     | Frequency per Generation              | Nature                                        |
| ----------------------------- | ------------------------------------- | --------------------------------------------- |
| **Activation** (forward pass) | P × samples (hundreds–thousands)      | Read-only, already in WASM                    |
| **Mutation** (structural)     | P × R × A × topology_weight (~10–25%) | Write (topology change)                       |
| **Mutation** (parameter)      | P × R × A × (1 − topology_weight)     | Write (weights/bias only)                     |
| **Breeding** (crossover)      | P − elitists                          | Read both parents, write offspring            |
| **Compatibility scoring**     | O(P²) worst case, cached via LRU      | Read-only                                     |
| **Speciation**                | P                                     | Read-only (neuron count, squash distribution) |
| **Validation/fix**            | Once after all mutations per creature | Read + write                                  |

**Key observation:** Activation already uses WASM via `CompiledNetwork` and
dominates the read-only usage. The remaining topology operations are
predominantly **write-heavy** (mutations, breeding) or **already cached**
(compatibility scoring at 66 ns per hit).

### 1.3 Operations That Could Benefit from Persistent WASM Storage

| Operation             | Current Bottleneck                      | WASM-Resident Benefit                           |
| --------------------- | --------------------------------------- | ----------------------------------------------- |
| Breeding crossover    | UUID-to-index mapping, Map allocation   | Avoid re-serialisation if both parents resident |
| AddConnection         | Rejection sampling (1.4 µs in JS)       | Negligible — JS is already trivially fast       |
| Compatibility scoring | LRU cache hit at 66 ns                  | None — cache is faster than any WASM path       |
| Backpropagation       | Recursive graph traversal (91% of time) | None — traversal is inherently sequential       |
| Batch activation      | Already compiled to WASM                | None — already optimised                        |

---

## ⚡ 2. Amortisation Potential

### 2.1 The CompiledNetwork Pattern

The existing `CompiledNetwork` succeeds because:

1. **Compile once** — Topology is serialised into a compact binary format
2. **Activate many** — The same compiled network processes hundreds of input
   samples
3. **High ratio** — Amortisation ratio is typically 100–10,000:1 (activations
   per compilation)

### 2.2 Would This Extend to Mutable Topology?

The critical difference: `CompiledNetwork` is **immutable after compilation**.
Mutable topology breaks this assumption:

| Property           | CompiledNetwork             | Proposed Resident Topology            |
| ------------------ | --------------------------- | ------------------------------------- |
| Mutability         | Immutable                   | Mutable (8 structural operators)      |
| Amortisation ratio | 100–10,000:1                | ~3–10:1 (see below)                   |
| Invalidation       | Never (recompile on change) | Every structural mutation             |
| Memory layout      | Compact, cache-friendly     | Must accommodate insertions/deletions |

### 2.3 Estimated Amortisation Ratio

For a typical training run (population 150, mutation rate 0.3, mutation amount
3, 75% parameter mutations for medium creatures):

- **Structural mutations per creature per generation:** 3 × 0.3 × 0.25 ≈ 0.23
- **Breeding events per generation:** ~120 (population minus elitists)
- **Compatibility checks per generation:** ~150 × 5 ≈ 750 (species assignment),
  but 64–100% cached
- **Activations per creature per generation:** Already in WASM

Between topology changes (structural mutations or breeding), a creature's
topology is used for:

- 0–2 compatibility checks (mostly cached)
- 1 speciation classification
- Many activations (already compiled separately)

**Amortisation ratio: ~3–5:1** — far below the 100:1+ needed to justify
compilation overhead.

### 2.4 Break-Even Analysis

Based on breeding benchmarks (#1632), serialisation cost for a medium creature
(200 neurons, 8,500 synapses) is ~23 ms. If a WASM-resident topology eliminated
this:

- **Savings per breed:** 23 ms serialisation avoided
- **Cost of residency:** Initial build (~23 ms) + synchronisation overhead per
  mutation + memory management
- **Break-even:** Need ~2+ breed operations per topology build without
  intervening structural mutations

In practice, creatures are bred once (as offspring) and then mutated before the
next generation. The topology changes between uses, resetting any amortisation.

> [!WARNING]
> Even in best-case scenarios the amortisation ratio of ~3–5:1 is an order of
> magnitude below the 100:1+ threshold where `CompiledNetwork` becomes
> worthwhile. Attempting to close this gap with micro-optimisations risks
> significant engineering effort for marginal returns.

---

## 🔧 3. Architectural Challenges

### 3.1 Synchronisation Between JS and WASM

The most significant challenge. Currently, TypeScript objects are the source of
truth:

- `Neuron` objects carry UUIDs, squash functions, bias values, and type metadata
- `Synapse` objects carry from/to indices, weights, and synapse types
- `TopologyCaches` provide O(1) connection existence checks and O(log n) inward
  lookups

A WASM-resident topology would require **dual-state synchronisation**:

```
JS Creature ←→ WASM Topology (linear memory)
```

Every mutation would need to:

1. Update the WASM linear memory (topology change)
2. Update the JS object graph (for UUID resolution, compatibility, speciation)
3. Invalidate affected caches on both sides

This introduces a **consistency hazard**: if either side gets out of sync, the
creature is corrupted. The current architecture avoids this by having a single
source of truth (JS objects) with one-way compilation to WASM when needed.

### 3.2 UUID-Based Identity

NEAT-AI uses UUIDs as neuron identifiers for:

- Genetic compatibility scoring
- Parent-offspring lineage tracking
- Breeding crossover (matching neurons between parents)

UUIDs are strings, not integers. WASM linear memory works with fixed-size
numeric types. Bridging this requires either:

- **UUID→index mapping tables** maintained on both sides (the same serialisation
  cost we are trying to eliminate)
- **Replacing UUIDs with integer IDs** — a fundamental architectural change
  affecting nearly every module

### 3.3 Dynamic Memory Management in WASM

Structural mutations (AddNeuron, SubNeuron, AddConnection, SubConnection) change
array sizes. In WASM linear memory:

- Adding a neuron requires shifting all subsequent neuron data and updating
  synapse indices
- Removing a neuron requires compaction and index rewriting
- The current Rust `CompiledNetwork` uses `Vec<NeuronData>` and
  `Vec<SynapseData>` — these are fixed after construction

Options:

1. **Over-allocate with capacity headroom** — Wastes memory, still needs
   compaction on removal
2. **Recompile on structural change** — Defeats the purpose of residency
3. **Use a WASM allocator** (e.g., `wee_alloc`) — Adds GC complexity, potential
   fragmentation

### 3.4 Garbage Collection Interaction

JavaScript's GC manages `Creature` lifetimes. WASM linear memory is manually
managed. Currently, `WasmCreatureActivation` handles this with:

- `free()` / `[Symbol.dispose]()` for explicit cleanup
- LRU eviction under memory pressure
- `WeakRef` for GC-friendly caching

A WASM-resident topology would require extending this lifecycle management to
topology data, doubling the memory management surface area.

### 3.5 Thread Safety

NEAT-AI uses Deno Workers for parallel evaluation. Each worker would need its
own WASM memory for creature topology, or a shared memory model would be needed.
The current `CompiledNetwork` is compiled per-worker, which works because
activation is read-only. Mutable topology in shared memory would require
synchronisation primitives (locks, atomics) that WASM does not natively support
well.

---

## 📊 4. Implementation Effort Estimate

### 4.1 Modules Requiring Modification

| Module                              | Changes Required                                  | Effort |
| ----------------------------------- | ------------------------------------------------- | ------ |
| `wasm_activation/src/network.rs`    | Add mutable topology representation               | High   |
| `src/wasm/CompileToWasm.ts`         | Bidirectional sync instead of one-way compilation | High   |
| `src/mutate/*` (8 operators)        | Dual-update (JS + WASM) for each mutation         | High   |
| `src/architecture/Offspring.ts`     | WASM-resident breeding                            | High   |
| `src/creature/CreatureTopology.ts`  | Cache invalidation coordination                   | Medium |
| `src/Creature.ts`                   | Lifecycle management for resident topology        | Medium |
| `src/breed/GeneticCompatibility.ts` | Read from WASM or maintain JS copy                | Low    |
| `src/NEAT/Species.ts`               | Read from WASM or maintain JS copy                | Low    |
| `src/wasm/WasmCompilationCache.ts`  | Extend to topology residency                      | Medium |

**Estimated total effort: 4–6 weeks** for a senior developer, with high risk of
introducing subtle synchronisation bugs.

### 4.2 Risk Assessment

- **Correctness risk: High** — Dual-state synchronisation is notoriously
  error-prone
- **Performance risk: Medium** — Synchronisation overhead may negate
  serialisation savings
- **Maintenance risk: High** — Every new mutation operator or topology feature
  must update both sides
- **Rollback risk: Low** — Could be feature-flagged behind a config option

---

## 🔀 5. Alternative Approaches

### 5.1 Continue TypeScript-Level Optimisations (Recommended)

The #1639 series demonstrated that algorithmic TypeScript improvements
consistently deliver better results than WASM migration for graph-structure
operations:

| Optimisation                          | Improvement                   | Effort |
| ------------------------------------- | ----------------------------- | ------ |
| Batching fix/validate (#1583)         | 33–51% faster                 | Days   |
| Removing redundant validation (#1584) | 8–11% faster                  | Days   |
| shallowClone vs JSON (#1586)          | 2.4–3.5x faster               | Days   |
| Rejection sampling (#1587)            | 9–12% faster                  | Days   |
| Deferred connections (#1644)          | Reduced Map/object allocation | Days   |
| Topological ordering (#1641)          | Reduced recursive traversal   | Days   |

> [!TIP]
> TypeScript-level algorithmic improvements have consistently delivered 10–50%+
> gains with only days of effort. Before investing in WASM residency, exhaust
> the remaining opportunities in the #1639 series — particularly typed array
> topology (Section 5.2), which offers a lower-risk path to reduced
> serialisation cost.

### 5.2 Typed Array Topology (Intermediate Step)

Rather than WASM residency, replace JS object topology with typed arrays on the
JS side:

- `Float64Array` for weights and biases
- `Uint32Array` for connectivity (from/to indices)
- `Uint8Array` for squash types and synapse types

This would:

- Reduce GC pressure (fewer small objects)
- Make serialisation to WASM a `memcpy` instead of field-by-field marshalling
- Keep a single source of truth (JS typed arrays)
- Be incrementally adoptable

**Estimated effort: 2–3 weeks**, lower risk than full WASM residency.

### 5.3 Selective WASM Residency (Implemented — #1959)

With typed array topology in place (#1957), three read-heavy topology operations
have been migrated to WASM/Rust:

- **Topology validation** (`validate_topology`) — Forward-only checks: synapse
  sorting, self-connection detection, backward connection detection
- **Connection availability scanning** (`scan_available_connections`) — Finds
  all forward-only connection slots not yet occupied
- **Neuron dependency analysis** (`compute_reverse_topological_order`) — Kahn's
  algorithm for reverse topological order (backpropagation ordering)

These operations accept typed arrays directly from `TypedTopology` via
wasm-bindgen slice passing — no custom binary serialisation required. Each
function has a TypeScript fallback so the system works without WASM.

Convenience methods on `TypedTopology`:

- `validateForwardOnly()` — WASM-accelerated forward-only validation
- `scanAvailableConnections()` — WASM-accelerated connection scanning
- `computeReverseTopologicalOrder()` — WASM-accelerated topological ordering

Implementation files:

- `wasm_activation/src/topology_ops.rs` — Rust WASM functions
- `src/wasm/WasmTopologyOps.ts` — TypeScript wrappers with fallbacks
- `test/wasm/WasmTopologyOps.ts` — 21 tests verifying WASM/TS equivalence

---

## 🏁 6. Conclusion

### Key Findings

1. **The CompiledNetwork pattern does not extend well to mutable topology.**
   CompiledNetwork succeeds because of its high amortisation ratio (100–10,000
   activations per compilation). Mutable topology has a ratio of only ~3–5:1.

2. **Topology changes cannot be efficiently applied in WASM memory without full
   re-serialisation.** Structural mutations (add/remove neurons and connections)
   require index rewriting, array resizing, and cache invalidation — operations
   that are as expensive as recompilation.

3. **The expected break-even point is ~2+ operations per topology build**, but
   in practice creatures are mutated between uses, resetting the amortisation
   window.

4. **Synchronisation complexity is the dominant risk.** Maintaining consistent
   state between JS objects (needed for UUID-based operations) and WASM linear
   memory (needed for fast computation) introduces a large surface area for
   bugs.

### Recommendation

**Defer** WASM-resident topology. Instead:

1. **Continue TypeScript-level algorithmic improvements** — these have
   consistently delivered 10–50%+ gains with days of effort and low risk.
2. **Consider typed array topology** (Section 5.2) as an intermediate step that
   would reduce serialisation cost without the synchronisation hazard.
3. **Revisit WASM residency** if typed array topology proves successful and
   profiling shows serialisation is still the dominant bottleneck.

---

## 📚 References

- #1630 — Backpropagation gradient computation WASM investigation
- #1631 — AddConnection mutation validation WASM investigation
- #1632 — Breeding crossover topology WASM investigation
- #1633 — Genetic compatibility scoring WASM investigation
- #1639 — Parent tracking issue for WASM performance series
- #1641 — Topological ordering optimisation
- #1644 — Breeding crossover allocation reduction
- #1957 — Typed array topology implementation
- #1959 — Selective WASM residency for read-heavy topology operations
- `docs/PERFORMANCE_RESEARCH.md` — Performance research with WASM migration
  learnings
