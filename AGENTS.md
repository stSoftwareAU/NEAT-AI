# 🤖 AGENTS.md - Coding Guidelines for NEAT-AI

This file is the single source of truth for coding conventions, project
terminology, and development workflows in the NEAT-AI repository. All
contributors (human and AI) should follow these guidelines.

> [!NOTE]
> This document is intended for both human contributors and AI coding agents.
> When in doubt, follow the conventions described here rather than assuming
> defaults from other projects.

## 📖 Terminology

We keep the tone playful, but every nickname maps to a mainstream
machine-learning idea:

- **Creatures** are individual neural networks/genomes inside a NEAT population,
  as described in the original NEAT paper by
  [Stanley & Miikkulainen (2002)](http://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf).
- **Memetic evolution** refers to the well-studied combination of evolutionary
  search plus local gradient descent, also called a
  [memetic algorithm](https://en.wikipedia.org/wiki/Memetic_algorithm).
- **CRISPR injections** describe targeted gene edits inspired by the real-world
  [CRISPR gene editing technique](https://www.nature.com/scitable/topicpage/crispr-cas9-a-precise-tool-for-33169884/);
  in practice we add hand-crafted synapses/neurons.
- **Grafting** is crossover between incompatibly shaped genomes, similar to the
  [island-model speciation strategies](https://en.wikipedia.org/wiki/Island_model)
  used in evolutionary algorithms.
- **Squash** is our term for activation functions applied to neurons.
- **Discovery** is the error-guided structural evolution process that uses the
  Rust FFI extension to propose structural improvements.
- **Intelligent Design** is a technique for systematically testing different
  squash functions for each hidden neuron.
- **Synthetic synapses** are temporary zero-weight connections added between
  adjacent topological layers before backpropagation. They give gradient descent
  a richer search space — similar to
  [layer densification](https://en.wikipedia.org/wiki/Dense_layer) in
  conventional deep learning — and are pruned back to only the useful ones after
  training.
- **Layer assignment** is the topological ordering of neurons into discrete
  layers based on longest-path distance from input neurons, used by synthetic
  synapse generation to determine which neuron pairs are in adjacent layers.

If you spot another fun label, expect it to be backed by a reference to the
standard term the first time it appears.

## 🏗️ Project Architecture

### ⚙️ Technology Stack

- **TypeScript** on **Deno 2.x** for the core library
- **WASM** (required) for activation/scoring - initialised automatically, no
  manual init needed
- **Rust** FFI extension
  ([NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery)) for
  GPU-accelerated structural analysis
- **wgpu** for cross-platform GPU compute shaders (Metal on macOS, Vulkan on
  Linux, DX12 on Windows) with CPU fallback

### 📂 Directory Structure

```
src/                    # Source code
  architecture/         # Core neural network architecture (Creature, Neuron, Synapse)
  blackbox/             # Black-box evaluation utilities
  breed/                # Crossover and breeding algorithms
  compact/              # Network compaction and optimisation
  config/               # Configuration and options (NeatOptions, NeatConfig)
  costs/                # Cost/fitness functions
  creature/             # Creature behaviour modules (activation, mutation, serialisation, training)
  deprecated/           # Deprecated activation functions (HYPOT, HYPOTv2, MEAN)
  discovery/            # Discovery integration (Rust FFI bridge)
  errors/               # Error types
  intelligentDesign/    # Intelligent Design squash optimisation
  methods/              # Activation functions (squash implementations)
  multithreading/       # Worker thread utilities
  mutate/               # Mutation operators
  NEAT/                 # Core NEAT algorithm (selection, speciation)
  optimize/             # Optimisation passes
  propagate/            # Backpropagation (elastic distribution)
  reconstruct/          # Network reconstruction utilities
  upgrade/              # Version migration
  utils/                # Shared utilities
  wasm/                 # WASM activation bridge
test/                   # Tests (mirrors src/ structure)
bench/                  # Benchmarks
docs/                   # Extended documentation
wasm_activation/        # WASM activation module (Rust source + pkg)
scripts/                # Utility scripts
```

### 🗝️ Key Files

- `mod.ts` - Public API entry point
- `deno.json` - Deno configuration, dependencies, lint rules
- `quality.sh` - Pre-commit quality gate (lint, format, type-check, test)

### Neuron identity: wire UUID vs runtime integer `id` (Issue #1958)

- **Stable identity** (anything that crosses generations, disks, or species
  boundaries): use **UUID strings only** — `neuron.uuid` for hidden/constant,
  canonical `input-N` / `output-N` in synapse endpoints. `creature.exportJSON()`
  is the canonical **external** export: UUID-only, no numeric `id` / `fromId` /
  `toId` (Issue #2054). `exportSnapshotJSON()` is equivalent. **Genetic
  compatibility** uses `getHiddenNeuronWireKeys()` (wire labels), not integer
  ids.

- **Runtime integer `id`** (`src/architecture/NeuronId.ts`): allowed **only
  in-memory** for hot paths (WASM, `Map<number, …>`, internal breeding
  traversal) where **profiling** shows a material win. Internal code that needs
  integer IDs in serialised form should use `exportInternalJSON()` from
  `CreatureSerialization.ts`. Do **not** introduce new integer-keyed surfaces
  for lineage, export, or user-visible JSON without a benchmark in `bench/` and
  a short note in the PR.

- **Discovery/cache/FFI wire contract:** any JSON that crosses a library, app,
  worker/cache boundary, or Rust FFI boundary must use **UUIDs only** for neuron
  and synapse identity. This includes discovery candidates, success/failure
  cache `rustRequest` payloads, diagnostics written to disk, and replay inputs.
  Do **not** persist or emit `neuronId`, `fromNeuronId`, `toNeuronId`,
  `insertBeforeNeuronId`, `fromId`, or `toId` in these wire payloads. Resolve
  UUIDs to runtime integers only at the last internal application step.

- **No legacy fallback on wire formats:** when reading discovery cache or other
  persisted wire payloads, reject or skip numeric-id-only entries instead of
  silently accepting them. Backward compatibility must not reintroduce runtime
  ids into external contracts.

- **Reference benchmarks** (evidence for keeping internal integer maps):
  `bench/ParallelBreeding.ts`, `bench/GeneticCompatibilitySetIntersection.ts`,
  and WASM activation/serialisation paths tied to Issue #1958.

- **Serialisation hot path:** `exportJSON` must not run full `creatureValidate`
  on every call in production — only when `creature.DEBUG` is true.
  `Creature.fromJSON` / `loadFrom` default to `validate: false` for the same
  reason. Invariants belong in mutation/breed/discovery and in targeted tests;
  adding unconditional validation to export/import is a performance regression
  (see `test/creature/CreatureSerializationPolicy.ts`).

- **Grafting / `createCompatibleFather`**: Hidden and constant neurons are
  aligned to the mother’s id scheme **by matching stable wire `uuid` first**,
  then by a connectivity fingerprint (integer neighbour ids) for any remaining
  neurons. **Cross-machine**: the same saved genome should carry the same uuids;
  alignment does not depend on neuron array position. When genetic compatibility
  is below threshold, `editParentByIndex` may still reassign ids by **scan
  order** — that path is a deliberate fallback for badly mismatched topologies.

## 📝 Coding Conventions

### 🌏 Language

Use **Australian English** spelling throughout code, comments, and
documentation:

- colour, behaviour, organisation, favour, metre, centre
- optimise, normalise, analyse, summarise
- licence (noun), license (verb)

> [!TIP]
> If you are unsure whether a spelling is Australian English, prefer the `-ise`
> suffix over `-ize`, and `-our` over `-or` (e.g., `optimise`, `colour`).

### 🎨 Style

- Follow the Deno lint rules configured in `deno.json` (recommended + jsr tags)
- Use `deno fmt` for formatting
- Prefer `camelCase` for variables and functions
- Prefer explicit types where they aid readability
- Follow KISS, DRY, and the Boy Scout Rule
- Prefer smaller, focused files over large monolithic ones (Single
  Responsibility Principle)

### 🧪 Testing

#### Unit Tests vs Benchmarks

- **Unit tests** (`test/`) verify **what** the code does — correct outputs,
  correct errors, correct state changes. They must never measure timing or
  performance.
- **Benchmarks** (`bench/`) measure **how fast** the code runs. Use
  `Deno.bench()` or `performance.now()` here, never in unit tests.
- Tests run in parallel; timing in unit tests is inherently unreliable. Do not
  use `performance.now()`, `performance.mark()`, `Date.now()`, or any timing API
  in test files.
- Do not reduce iteration counts to make "performance tests" faster — move them
  to `bench/` instead.

> [!WARNING]
> Using timing APIs (`performance.now()`, `Date.now()`) inside `test/` files
> will cause flaky, unreliable results because tests run in parallel. Move any
> performance-sensitive checks to `bench/`.

#### ✅ "What" Tests (Good) vs ❌ "How" Tests (Bad)

Every test should be a **"what" test**: it exercises real code with test data
and asserts on the **outcome** (return values, side effects, error conditions).

A **"how" test** checks implementation details rather than outcomes. Examples of
"how" tests to avoid:

- Asserting that a specific internal method was called
- Checking that a particular algorithm or data structure is used
- Grepping source files for patterns, keywords, or headings
- Inspecting function bodies, line counts, or documentation content
- Verifying that one function calls another

"How" tests break when implementation changes even though behaviour is
identical. For example, switching from quicksort to mergesort should not break
any unit test — the result is the same. If you need to verify performance
characteristics (e.g., that a cache makes things faster), write a benchmark.

> [!NOTE]
> A good rule of thumb: if your test would still pass after a complete internal
> rewrite that produces the same outputs, it is a "what" test. If it would
> break, it is a "how" test — reconsider it.

#### 📋 Conventions

- Tests use `Deno.test()` with `@std/assert` imports
- Test files live under `test/` and are included via `deno.json`
- Name test files after the functionality they verify, not after performance
  characteristics (avoid "Benchmark" or "Performance" in test file names)

### ⚠️ Error Handling

- Use typed errors from `src/errors/`
- Fail fast on configuration errors
- Use `ValidationError` for structural validation

## 🔧 Quality Gate

Before committing, run:

```bash
./quality.sh
```

> [!TIP]
> Run `./quality.sh` before every commit. It covers linting, formatting,
> type-checking, WASM build, and all tests in one step — no need to run them
> individually.

This script runs the following steps by default:

1. Updates dependencies (`deno outdated --update --latest`)
2. Formats code (`deno fmt`)
3. Lints and auto-fixes (`deno lint --fix`)
4. Checks bash script syntax
5. Type-checks (`deno check`)
6. Builds the Rust discovery library (if `../NEAT-AI-Discovery` exists)
7. Builds the WASM activation module (Rust build + tests)
8. Runs all tests in parallel with leak detection

### 🚩 Optional Flags

```bash
./quality.sh --help            # Show usage and step descriptions
./quality.sh --skip-tests      # Skip test execution
./quality.sh --skip-discovery  # Skip discovery library build and verification
./quality.sh --skip-wasm       # Skip WASM activation module build
./quality.sh --lint-only       # Only run formatting + linting (includes bash check)
./quality.sh --check-only      # Only run type-checking (deno check)
./quality.sh --dry-run         # Show which steps would run without executing them
```

Flags can be combined, e.g. `./quality.sh --skip-tests --skip-discovery`.

### 🚀 Deployment Checklist

1. Run `./quality.sh` in both NEAT-AI and NEAT-AI-Discovery repositories
2. Increment version in `deno.json` (NEAT-AI) or `Cargo.toml`
   (NEAT-AI-Discovery)
3. Verify all tests pass before committing

## ⚡ Activation / WASM

Activation uses WASM (required). The library initialises the WASM backend
automatically; callers do not need to call any init function or set environment
variables. This works transparently in both the main thread and Deno Worker
contexts. If WASM cannot be loaded, activation/scoring fails fast with an
actionable error.

> [!NOTE]
> No manual WASM initialisation is required. The library handles this
> automatically in all supported contexts.

## 🦀 Rust Discovery Module

The Rust FFI extension shipped via
[NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery) provides
GPU-accelerated structural hints used by `discoveryDir()`.

### 🛠️ Setup

1. Clone and build:

   ```bash
   git clone https://github.com/stSoftwareAU/NEAT-AI-Discovery.git
   ../NEAT-AI-Discovery/scripts/runlib.sh
   ```

2. Or set an explicit path:

   ```bash
   export NEAT_AI_DISCOVERY_LIB_PATH="/absolute/path/to/libneat_ai_discovery.dylib"
   ```

3. Validate:

   ```bash
   deno run --allow-env --allow-ffi --allow-read scripts/check_discovery.ts
   ```

4. Guard discovery calls with `isRustDiscoveryEnabled()` so controllers fail
   fast when the module is unavailable.

> [!NOTE]
> Discovery is always optional. When the library cannot be resolved, tests are
> skipped gracefully and discovery is disabled — no environment variable is
> required.

## 🔄 Feed-forward vs Recurrent Connections

NEAT-AI supports two topology styles:

- **Feed-forward (forward-only)**: No self-loops or backward connections. Each
  activation depends only on the current input and upstream neuron activations.
- **Recurrent (feedback-enabled)**: Self-loops and backward connections allowed,
  useful for time-series behaviours.

In our production workloads, the default is feed-forward/forward-only.

## 📚 Documentation Layout

- **README.md** - Human-readable project overview, features, and quick start
- **CONTRIBUTING.md** - First-time contributor guide with development setup and
  workflow
- **AGENTS.md** (this file) - Coding guidelines and development reference
- **COMPARISON.md** - Comparison with other AI approaches
- **docs/API_REFERENCE.md** - Comprehensive public API reference
- **docs/DISCOVERY_GUIDE.md** - Complete discovery workflow guide
- **docs/DISCOVERY_ARCHITECTURE.md** - Discovery pipeline internal architecture
- **docs/DISCOVERY_DIR.md** - Technical API reference for `discoveryDir()`
- **docs/GPU_ACCELERATION.md** - GPU acceleration details
- **docs/CONFIGURATION_GUIDE.md** - Complete configuration options reference
- **docs/PERFORMANCE_TUNING.md** - Performance tuning guide for large-scale
  training
- **docs/PERFORMANCE_RESEARCH.md** - Performance research with WASM migration
  learnings
- **docs/ACTIVATION_FUNCTIONS.md** - Activation function selection guide
- **docs/BACKPROP_ELASTICITY.md** - Elastic backpropagation explanation
- **docs/INTELLIGENT_DESIGN.md** - Intelligent Design squash optimisation guide
- **docs/PREDICTIVE_CODING.md** - Predictive Coding architecture design
- **docs/TS_RUST_MIGRATION.md** - TypeScript to Rust migration milestone roadmap
- **docs/TROUBLESHOOTING.md** - Common issues and solutions
- **docs/archive/pr-summaries/** - Archived PR summary files (historical)
- **src/methods/activations/README.md** - Activation function strategy reference
