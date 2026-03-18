## Summary

Implements foundational transfer learning support for NEAT-AI, enabling trained
creatures to be exported as checkpoints and imported for different but related
tasks. Closes #1861.

### What was added

1. **Creature checkpoint export** — `exportCheckpoint()` saves a trained
   creature (topology + weights + metadata) as a reusable checkpoint including
   source task info, training history, fitness, and input/output UUIDs for
   mapping.

2. **Creature import with fine-tuning** — `importCheckpoint()` loads a
   pre-trained checkpoint and creates a creature for a new task. Handles UUID
   mapping when source and target tasks have different input/output
   configurations by remapping neurons and synapses.

3. **Freeze/unfreeze layers** — Added `frozen` flag to both `Neuron` and
   `Synapse` classes. When frozen:
   - Backpropagation skips weight/bias updates for frozen synapses/neurons
   - `ModWeight` mutation skips frozen synapses
   - `ModBias` mutation skips frozen neurons
   - Flags survive JSON export/import and `shallowClone()`

4. **Population seeding** — `createSeededPopulation()` creates an initial
   population mixing pre-trained creatures with randomly initialised ones.

### Files changed

- **New:** `src/transfer/` — CheckpointInterface, Checkpoint, PopulationSeeding,
  mod.ts
- **New:** `test/transfer/` — Checkpoint.ts, PopulationSeeding.ts (24 tests)
- **Modified:** SynapseInterfaces, NeuronInterfaces — added `frozen?` field
- **Modified:** Synapse, Neuron — added `frozen` property and serialisation
- **Modified:** CreatureSerialization — preserves frozen flags in
  loadFrom/shallowClone
- **Modified:** NeuronSerialization — preserves frozen flags in export/import
- **Modified:** Weight.ts, Bias.ts — respects frozen flags during
  backpropagation
- **Modified:** ModWeight, ModBias — skips frozen synapses/neurons during
  mutation
- **Modified:** Creature.ts — added setNeuronFrozen, setSynapseFrozen,
  freezeHiddenLayers, unfreezeAll
- **Modified:** mod.ts — exports transfer learning API

## Evidence

All 4553 tests pass (including 24 new transfer learning tests). The `quality.sh`
gate passes cleanly.

## Test Plan

- `test/transfer/Checkpoint.ts` (18 tests):
  - Export checkpoint with metadata verification
  - Import with same/different input/output counts
  - UUID mapping (positional and explicit)
  - Freeze hidden layers on import
  - Frozen flag round-trip through JSON and shallowClone
  - Frozen weights/biases preserved during backpropagation
  - Transfer learning end-to-end: train task A, freeze hidden, fine-tune task B
- `test/transfer/PopulationSeeding.ts` (6 tests):
  - Seeds included in population
  - Random creatures fill remaining slots
  - Seed count capped at population size
  - Empty seeds produces all random population
  - Layer configuration for random creatures
  - All seeded population creatures can be activated
