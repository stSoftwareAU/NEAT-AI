## Summary

Implement subgraph transplantation as a horizontal gene transfer breeding
strategy for inter-species breeding. When two creatures have very low genetic
compatibility, the system now randomly selects between input-weight crossover
(Issue #2175) and subgraph transplantation, falling back to the other if the
first strategy fails. Closes #2177.

Subgraph transplantation extracts small, self-contained clusters of 2-5
connected hidden neurons from a donor creature and transplants them (with new
UUIDs) into the recipient's topology. This is inspired by horizontal gene
transfer in prokaryotes and subtree crossover in genetic programming.

### Algorithm

1. **Extract subgraphs** from the donor: identify clusters of connected hidden
   neurons, scored by modularity (internal vs external connections)
2. **Select best subgraph** with slight randomisation among top candidates
3. **Transplant** into the mother's topology with new UUIDs, preserving internal
   connection weights
4. **Connect boundaries**: link donor's input sources to transplanted entry
   neurons; link transplanted exit neurons to mother's output neurons
5. **Validate** with `creatureValidate` (including forward-only constraint)
6. **Tag** transplanted neurons with `approach: "transplant"` for tracking

### Files Changed

- **New**: `src/breed/SubgraphTransplant.ts` — subgraph identification,
  extraction, scoring, and transplantation logic
- **New**: `test/breed/SubgraphTransplant.ts` — 12 unit tests
- **Modified**: `src/architecture/Offspring.ts` — integrated as alternative
  inter-species breeding path alongside input-weight crossover

## Evidence

All 5325 tests pass (0 failures, 3 ignored). The new module integrates
seamlessly with the existing breeding pipeline without requiring new
configuration options.

## Test Plan

- `extractSubgraphs finds connected hidden neuron clusters`
- `extractSubgraphs returns subgraphs with internal connections`
- `subgraphTransplant produces valid offspring`
- `subgraphTransplant produces valid forward-only offspring`
- `subgraphTransplant tags transplanted neurons with approach: transplant`
- `subgraphTransplant gives new UUIDs to transplanted neurons`
- `subgraphTransplant preserves mother's input/output structure`
- `subgraphTransplant offspring has more hidden neurons than mother`
- `subgraphTransplant works with incompatible parents`
- `Offspring.breed can use subgraph transplant for very low compatibility`
- `subgraphTransplant with single hidden neuron donor returns undefined`
- `subgraphTransplant with larger networks`
