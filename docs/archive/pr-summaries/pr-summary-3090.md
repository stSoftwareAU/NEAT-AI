# perf: Replace O(n²) parent wire-label scans in forward-only Offspring repair

## Summary

The forward-only Offspring repair routines
(`repairForwardOnlyComputationalInbounds` and `repairOrphanedConstants`)
resolved a parent neuron by its wire label using
`findParentNeuronIndexByWireLabel`, which **rescanned the entire parent neuron
array — recomputing a wire label per entry — on every call**. Because both
repairs run for every forward-only offspring (the default breeding path, since
`feedbackLoop` defaults to `false`), and the scan runs once per orphaned
offspring neuron for **both** parents, the cost was
`O(n_orphan × (n_mother + n_father))` per repair pass.

This PR precomputes a `wire label → parent index` map **once per parent**
(`buildParentWireLabelIndex`) and replaces the linear scan with O(1) map
lookups, turning the per-generation `O(n²)` repair into `O(n)`. The linear-scan
helper is removed.

Repair behaviour is **identical**: the map is keyed by the same
`neuronWireLabelForDiagnostics` labelling and preserves first-match semantics
(the map only records the first index seen per label, mirroring the scan that
returned the first match).

Closes #3090.

## Evidence

This is a backend/algorithmic change — no UI to screenshot.

### Lookup micro-benchmark (`bench/ForwardOnlyRepairPerformance.ts`)

End-to-end `Offspring.breed` is dominated by the WASM compile probe, so the
repair cost is not separately observable there (`bench/BreedPerformance.ts`
confirms **no regression**: Large 520-neuron breed 234.3 ms → 232.3 ms, within
noise). The new benchmark isolates the exact operation that changed — resolving
`M` labels against an `N`-neuron parent using the real
`neuronWireLabelForDiagnostics` labelling:

| N (parent neurons) | Linear scan-per-call | Precomputed map | Speed-up |
| ------------------ | -------------------- | --------------- | -------- |
| 100                | 94.7 µs              | 6.3 µs          | 15.0×    |
| 200                | 352.5 µs             | 13.8 µs         | 25.6×    |
| 400                | 1.4 ms               | 28.2 µs         | 49.3×    |
| 800                | 5.8 ms               | 57.1 µs         | 101.3×   |

The scan's time quadruples when `N` doubles (O(n²)); the map's time merely
doubles (O(n)). The speed-up doubling with each size confirms the asymptotic
improvement.

```mermaid
flowchart LR
    subgraph Before["Before — O(n_orphan × n_parent)"]
        O1[orphan neuron] -->|scan all| P1[parent neurons]
        O2[orphan neuron] -->|scan all| P1
        O3[orphan neuron] -->|scan all| P1
    end
    subgraph After["After — O(n_parent + n_orphan)"]
        B[build map once] --> M[(label → index)]
        Q1[orphan neuron] -->|O(1)| M
        Q2[orphan neuron] -->|O(1)| M
        Q3[orphan neuron] -->|O(1)| M
    end
```

## Test Plan

- **Added** `test/breed/OffspringForwardOnlyRepairWireLabelMap.ts`:
  - `forward-only repair restores connectivity via wire-label map` — breeds
    divergent forward-only parents 400× and asserts every produced child
    validates forward-only and satisfies the repair invariants (every
    hidden/output keeps an inbound, every constant keeps an outbound).
  - `forward-only repair is reproducible under a seeded RNG` — confirms that the
    same seed yields byte-identical offspring, i.e. the O(1) map lookup resolves
    the same parent neuron the linear scan did.
- **Regression coverage**: `test/breed/OffspringOrphanedConstantRepair.ts` and
  `test/breed/OffspringMapLookupOptimisation.ts` continue to pass.
- Full `test/breed/` suite: **333 passed, 0 failed**.
  `test/architecture/Offspring.ts`: **10 passed, 0 failed**.
- `./quality.sh --lint-only` and `./quality.sh --check-only` pass (format, lint,
  bash checks, full type-check).
